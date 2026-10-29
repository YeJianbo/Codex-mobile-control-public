import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionManager} from '../dist/services/sessionManager.js';

const overloaded={message:'Selected model is at capacity',codexErrorInfo:'serverOverloaded'};
function fixture(t,withGoal=false){
  const codex=new EventEmitter(),events=[],calls=[],threads=[{id:'t',status:'running'}];let backend='active';
  codex.connectionState=()=>({initialized:false,shared:true,generation:0});
  const goal=withGoal?{objective:'继续原目标',status:'active',goalId:'goal-1',tokensUsed:123,timeUsedSeconds:42}:null;
  const store={threads,approvals:[],recentEventsForThread:()=>events,async upsertThread(row){Object.assign(threads[0],row);return threads[0];}};
  codex.request=async(method,p)=>{
    calls.push({method,p});
    if(method==='thread/read')return {thread:{status:{type:backend}}};
    if(method==='thread/goal/set'){goal.status=p.status;if(p.status==='active'){backend='active';started('retry-'+calls.length);}return {goal};}
    if(method==='turn/start'){backend='active';const id='retry-'+calls.length;started(id);return {turn:{id}};}
    return {};
  };
  const manager=new SessionManager(codex,{publish:e=>events.push(e)},store,()=>new Map(goal?[['t',goal]]:[]));
  t.after(()=>manager.closeCapacityRetries());
  function started(id){codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id}}});}
  function failed(id,error=overloaded){backend='idle';codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{id,status:'failed',error}}});}
  async function fire(){const e=manager.capacityRetries.get('t');assert(e);clearTimeout(e.timer);e.timer=undefined;await manager.retryCapacityTurn('t',e);}
  return {manager,codex,events,calls,goal,threads,started,failed,fire,setBackend:v=>backend=v};
}

test('capacity retry preserves goal accounting and never publishes another user message',async t=>{
  const f=fixture(t,true);f.manager.setCapacityAutoRetry(true);f.started('original');f.goal.status='paused';f.failed('original');
  await f.manager.pauseInterruptedGoal('t','error');assert.equal(await f.manager.currentThreadStatus('t',[]),'running');
  assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,0);
  await f.fire();assert.equal(f.goal.status,'active');assert.equal(f.goal.tokensUsed,123);assert.equal(f.goal.timeUsedSeconds,42);
  assert.deepEqual(f.calls.find(c=>c.method==='thread/goal/set').p,{threadId:'t',status:'active'});
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);assert.equal(f.events.filter(e=>e.type==='user.message').length,0);
  assert.equal(f.manager.startingTurns.size,0);
});

test('ordinary retries supply a real capacity observation instead of duplicating user input',async t=>{
  const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('first');f.failed('first');await f.fire();
  const start=f.calls.find(c=>c.method==='turn/start');assert.deepEqual(start.p.input,[]);assert.equal(start.p.toolOutput.name,'gateway_capacity_retry');
  assert.equal(JSON.parse(start.p.toolOutput.output).failedTurnId,'first');assert.equal(f.events.filter(e=>e.type==='user.message').length,0);
  assert.equal(f.events.filter(e=>e.type==='turn.completed').length,0);assert.equal(f.threads[0].status,'running');
});

test('an unloaded or temporarily unavailable desktop session stays in recovery instead of stopping retry',async t=>{
 const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('unloaded');f.failed('unloaded');f.setBackend('notLoaded');
 await f.fire();assert(f.calls.some(call=>call.method==='thread/resume'));assert(f.manager.isCapacityRetryPending('t'));
 assert(!f.events.some(event=>event.title==='自动重试已停止'));assert(f.events.some(event=>event.title==='等待会话恢复'));
 assert(f.manager.capacityRetries.get('t').timer._idleTimeout<=8800);
 assert.equal(f.calls.filter(call=>call.method==='turn/start').length,0);
 f.setBackend('idle');await f.fire();assert.equal(f.calls.filter(call=>call.method==='turn/start').length,1);
});

test('a failed systemError session accepts retry without waiting for idle',async t=>{
 for(const withGoal of [false,true]){
  const f=fixture(t,withGoal);f.manager.setCapacityAutoRetry(true);f.started('failed');f.failed('failed');f.setBackend('systemError');
  await f.fire();assert.equal(f.calls.filter(call=>call.method===(withGoal?'thread/goal/set':'turn/start')).length,1);
  assert.equal(f.calls.filter(call=>call.method==='thread/resume').length,0);
  assert(!f.events.some(event=>event.title==='等待会话恢复'));
 }
});

test('reattaching an unloaded session may retain the previous systemError',async t=>{
 const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('failed');f.failed('failed');f.setBackend('notLoaded');
 const request=f.codex.request;
 f.codex.request=async(method,p)=>{if(method==='thread/resume')f.setBackend('systemError');return request(method,p);};
 await f.fire();assert.equal(f.calls.filter(call=>call.method==='thread/resume').length,1);
 assert.equal(f.calls.filter(call=>call.method==='turn/start').length,1);
 assert(!f.events.some(event=>event.title==='等待会话恢复'));
});

test('capacity-aborted turns and blocked goals retry without reviving a manual stop',async t=>{
 const f=fixture(t,true);f.manager.setCapacityAutoRetry(true);f.started('capacity-abort');f.goal.status='blocked';f.setBackend('idle');
 f.codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{id:'capacity-abort',status:'interrupted',error:overloaded}}});
 assert(f.manager.isCapacityRetryPending('t'));await f.fire();assert.equal(f.goal.status,'active');assert.equal(f.goal.tokensUsed,123);
 const stopped=fixture(t);stopped.manager.setCapacityAutoRetry(true);stopped.started('manual-stop');await stopped.manager.interrupt('t');
 stopped.codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{id:'manual-stop',status:'interrupted',error:overloaded}}});
 assert.equal(stopped.manager.isCapacityRetryPending('t'),false);
 const transient=fixture(t);transient.manager.setCapacityAutoRetry(true);transient.started('transient');
 transient.codex.emit('notification',{method:'error',params:{threadId:'t',turnId:'transient',error:overloaded,willRetry:true}});
 transient.codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{id:'transient',status:'interrupted'}}});
 assert.equal(transient.manager.isCapacityRetryPending('t'),false);
});

test('a terminal capacity notification schedules retry even when completion never arrives',async t=>{
 const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('terminal-error');f.setBackend('idle');
 f.codex.emit('notification',{method:'error',params:{threadId:'t',turnId:'terminal-error',error:overloaded,willRetry:false}});
 assert(f.manager.isCapacityRetryPending('t'));assert.equal(f.manager.capacityRetries.get('t').attempt,1);
 f.failed('terminal-error');assert.equal(f.manager.capacityRetries.get('t').attempt,1);
 await f.fire();assert.equal(f.calls.filter(call=>call.method==='turn/start').length,1);
});

test('a missing completion turn ID falls back to the recorded capacity turn',t=>{
 const f=fixture(t);f.manager.setCapacityAutoRetry(true);
 f.codex.emit('notification',{method:'error',params:{threadId:'t',turnId:'recorded-turn',error:overloaded,willRetry:true}});
 assert.equal(f.manager.isCapacityRetryPending('t'),false);
 f.codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{status:'failed'}}});
 assert.equal(f.manager.capacityRetries.get('t').turnId,'recorded-turn');
});

test('disabled setting and non-capacity failures keep normal terminal behavior',t=>{
  for(const error of [overloaded,{message:'quota exhausted',codexErrorInfo:'usageLimitExceeded'},{message:'connection timed out'}]){
    const f=fixture(t);f.manager.setCapacityAutoRetry(error!==overloaded);f.started('x');f.failed('x',error);
    assert.equal(f.manager.capacityRetries.size,0);assert.equal(f.threads[0].status,'error');assert(f.events.some(e=>e.type==='turn.completed'));
  }
});

test('manual stop, disabling, and a newer turn cancel waiting retries',async t=>{
  const f=fixture(t,true);f.manager.setCapacityAutoRetry(true);f.started('x');f.failed('x');await f.manager.interrupt('t');
  assert.equal(f.manager.capacityRetries.size,0);assert.equal(f.goal.status,'paused');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
  const g=fixture(t);g.manager.setCapacityAutoRetry(true);g.started('x');g.failed('x');g.manager.setCapacityAutoRetry(false);
  assert.equal(g.manager.capacityRetries.size,0);
  const h=fixture(t);h.manager.setCapacityAutoRetry(true);h.started('x');h.failed('x');h.started('manual');assert.equal(h.manager.capacityRetries.size,0);
});

test('a completed or budget-limited goal is not reactivated',async t=>{
  for(const status of ['complete','budget_limited']){
    const f=fixture(t,true);f.manager.setCapacityAutoRetry(true);f.started('x');f.failed('x');f.goal.status=status;await f.fire();
    assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,0);assert.equal(f.goal.status,status);assert.equal(f.manager.capacityRetries.size,0);
  }
});

test('duplicate failures do not double retry and capacity waiting continues past eight attempts',async t=>{
  const f=fixture(t);f.manager.setCapacityAutoRetry(true);let id='initial';f.started(id);
  for(let attempt=1;attempt<=12;attempt++){
    f.failed(id);f.failed(id);assert.equal(f.manager.capacityRetries.get('t').attempt,attempt);await f.fire();
    id=f.manager.activeTurns.get('t');
  }
  f.failed(id);assert.equal(f.manager.capacityRetries.get('t').attempt,13);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,12);
  f.manager.setCapacityAutoRetry(false);assert.equal(f.manager.capacityRetries.size,0);
});

test('an ambiguous retry RPC timeout is never replayed and releases the start lock',async t=>{
  const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('x');f.failed('x');const request=f.codex.request;
  f.codex.request=async(method,p)=>{if(method==='turn/start'){f.calls.push({method,p});throw Error('RPC timeout');}return request(method,p);};
  await f.fire();assert.equal(f.manager.capacityRetries.size,0);assert.equal(f.manager.startingTurns.size,0);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
});

test('stop waits for an in-flight retry and interrupts the accepted turn',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);f.manager.setCapacityAutoRetry(true);f.started('x');const request=f.codex.request;
  let release;const gate=new Promise(resolve=>release=resolve);
  f.codex.request=async(method,p)=>{if(method==='turn/start')await gate;return request(method,p);};
  f.failed('x');t.mock.timers.tick(17000);await new Promise(setImmediate);
  assert(f.manager.startingTurns.has('t'));let stopped=false;
  const stop=f.manager.interrupt('t').then(()=>stopped=true);await new Promise(setImmediate);assert.equal(stopped,false);
  release();await stop;assert.equal(f.manager.capacityRetries.size,0);assert.equal(f.threads[0].status,'interrupted');
  assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);
});
