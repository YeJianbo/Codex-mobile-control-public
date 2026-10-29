import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionManager} from '../src/services/sessionManager.ts';
import {CommandReceipts} from '../src/services/commandReceipts.ts';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-goal-execution-'));
let sequence=0;const managers=[];
after(async()=>{for(const manager of managers){manager.closeCapacityRetries();manager.receipts.close();}await fs.rm(home,{recursive:true,force:true});});
function fixture(){
 const codex=new EventEmitter(),calls=[],events=[],threads=[{id:'goal-thread',status:'interrupted'}];
 const goal={objective:'推进课题',status:'active',tokensUsed:42,timeUsedSeconds:15001};let backend='notLoaded';
 let settings={model:'old-model',effort:'low'};const continuations=[];
 codex.request=async(method,p)=>{
  calls.push({method,p});
  if(method==='thread/read')return {thread:{status:{type:backend}}};
  if(method==='thread/start'){backend='idle';return {thread:{id:'goal-thread'}};}
  if(method==='thread/resume'){if(backend==='notLoaded')backend='idle';return {thread:{id:p.threadId,status:{type:backend}}};}
  if(method==='thread/settings/update'){settings={...settings,...p};return {};}
  if(method==='thread/goal/set'){
   Object.assign(goal,p);
   if(p.status==='active'){backend='active';continuations.push({...settings});}
   return {goal:{...goal}};
  }
  if(method==='model/list')return {data:[{model:'gpt-6-astra',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
  if(method==='turn/start'){backend='active';return {turn:{id:'continued-turn'}};}
  return {};
 };
 const store={threads,approvals:[],recentEventsForThread:()=>events,async upsertThread(row){Object.assign(threads[0],Object.fromEntries(Object.entries(row).filter(([,value])=>value!==undefined)));return threads[0]}};
 const manager=new SessionManager(codex,{publish:e=>events.push(e)},store,()=>new Map([['goal-thread',goal]]));
 managers.push(manager);manager.receipts=new CommandReceipts(path.join(home,`receipt-${++sequence}.json`));
 return {manager,codex,calls,events,threads,goal,continuations,setBackend:value=>backend=value};
}
const command=id=>({type:'turn.start',requestId:id,threadId:'goal-thread',continueGoal:true,text:'',model:'gpt-6-astra',effort:'medium',mode:'default',permission:'full',fast:true});
test('confirmed interruption persists paused once without sending a continuation',async()=>{
 const f=fixture();await Promise.all([f.manager.pauseInterruptedGoal('goal-thread','interrupted'),f.manager.pauseInterruptedGoal('goal-thread','interrupted')]);
 assert.equal(f.goal.status,'paused');assert.equal(f.goal.objective,'推进课题');assert.equal(f.goal.timeUsedSeconds,15001);
 assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
});
test('a disconnected client never pauses a goal whose backend is still active',async()=>{
 const f=fixture();f.setBackend('active');await f.manager.pauseInterruptedGoal('goal-thread','interrupted');assert.equal(f.goal.status,'active');
 await f.manager.pauseInterruptedGoal('goal-thread','completed');assert.equal(f.calls.filter(c=>c.method==='thread/goal/set').length,0);
});
test('explicit stop pauses the goal before interrupting the current turn',async()=>{
 const f=fixture();f.setBackend('active');f.codex.emit('notification',{method:'turn/started',params:{threadId:'goal-thread',turn:{id:'stopped-turn'}}});
 await f.manager.interrupt('goal-thread');
 assert.equal(f.goal.status,'paused');assert(f.calls.findIndex(c=>c.method==='thread/goal/set')<f.calls.findIndex(c=>c.method==='turn/interrupt'));
 assert.equal(f.threads[0].status,'interrupted');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
});
test('continue saves settings before the scheduler runs without a user message; receipt replay does not restart',async()=>{
 const f=fixture();f.goal.status='paused';const c=command('continue-once');
 await Promise.all([f.manager.handleClientCommand(c),f.manager.handleClientCommand(c)]);await f.manager.handleClientCommand(c);
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);assert.equal(f.goal.status,'active');
 assert.equal(f.continuations.length,1);const effective=f.continuations[0];
 assert.equal(effective.model,'gpt-6-astra');assert.equal(effective.effort,'medium');assert.equal(effective.approvalPolicy,'never');assert.equal(effective.serviceTier,'fast');
 assert.equal(effective.collaborationMode.settings.model,'gpt-6-astra');assert.equal(effective.collaborationMode.settings.reasoning_effort,'medium');
 assert.equal(f.events.filter(e=>e.type==='user.message').length,0);assert.equal(f.threads[0].status,'running');
 assert(f.calls.findIndex(c=>c.method==='thread/settings/update')<f.calls.findIndex(c=>c.method==='thread/goal/set'));
});
test('two different continue requests activate the goal at most once',async()=>{
 const f=fixture();f.goal.status='paused';const results=await Promise.allSettled(['a','b'].map(id=>f.manager.handleClientCommand(command('different-'+id))));
 assert(results.some(r=>r.status==='fulfilled'));assert.equal(f.continuations.length,1);
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
});

test('blocked and usage limited goals can continue, while exhausted budget stays explicit',async()=>{
 for(const status of ['blocked','usage_limited']){
  const f=fixture();f.goal.status=status;
  await f.manager.handleClientCommand(command('resume-'+status));
  assert.equal(f.continuations.length,1);assert.equal(f.goal.status,'active');
 }
 const f=fixture();f.goal.status='budget_limited';
 await assert.rejects(f.manager.handleClientCommand(command('budget')),/预算已用完/);
 assert.equal(f.continuations.length,0);assert.equal(f.goal.status,'budget_limited');
});

test('continuation reconciles a tracked turn after the backend has become idle',async()=>{
 const f=fixture();
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'goal-thread',turn:{id:'lost-end'}}});
 f.goal.status='blocked';f.setBackend('idle');
 await f.manager.handleClientCommand(command('recover-lost-end'));
 assert.equal(f.continuations.length,1);assert.equal(f.goal.status,'active');
});
test('activation rejection leaves goal paused; ambiguous timeout is not replayed',async()=>{
 for(const error of ['invalid request','RPC timeout']){
  const f=fixture();f.goal.status='paused';const request=f.codex.request;
  f.codex.request=async(method,p)=>{if(method==='thread/goal/set'&&p.status==='active'){f.calls.push({method,p});if(error==='RPC timeout'){f.setBackend('active');f.goal.status='active';}throw Error(error);}return request(method,p);};
  const c=command('failure-'+error);await assert.rejects(f.manager.handleClientCommand(c));await assert.rejects(f.manager.handleClientCommand(c));
  assert.equal(f.calls.filter(c=>c.method==='thread/goal/set'&&c.p.status==='active').length,1);assert.equal(f.goal.status,error==='RPC timeout'?'active':'paused');
  assert.equal((await f.manager.receipts.get(c.requestId)).state,error==='RPC timeout'?'uncertain':'failed');
 }
});
test('continue waits for pending pause and a stale status query cannot pause its new turn',async()=>{
 const f=fixture();const request=f.codex.request;let release;const delay=new Promise(resolve=>release=resolve);
 f.codex.request=async(method,p)=>{if(method==='thread/goal/set'&&p.status==='paused')await delay;return request(method,p);};
 const pause=f.manager.pauseInterruptedGoal('goal-thread','interrupted');await new Promise(resolve=>setTimeout(resolve,5));
 const resume=f.manager.handleClientCommand(command('race'));release();await Promise.all([pause,resume]);
 await f.manager.pauseInterruptedGoal('goal-thread','interrupted');assert.equal(f.goal.status,'active');assert.equal(f.continuations.length,1);
});
test('an externally running thread can resume the goal without submitting another turn',async()=>{
 const f=fixture();f.setBackend('active');f.goal.status='paused';f.threads[0].status='running';
 await f.manager.handleClientCommand(command('already-running'));
 assert.equal(f.goal.status,'active');assert.equal(f.threads[0].status,'running');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,0);
 assert.equal(f.calls.filter(c=>c.method==='thread/goal/set'&&c.p.status==='active').length,1);
 assert.equal(f.events.filter(e=>e.type==='user.message').length,0);
});

test('a tracked running turn does not prevent resuming the paused goal',async()=>{
 const f=fixture();f.setBackend('active');f.goal.status='paused';
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'goal-thread',turn:{id:'still-running'}}});
 await f.manager.handleClientCommand(command('tracked-running'));
 assert.equal(f.goal.status,'active');assert.equal(f.manager.canSteer('goal-thread'),true);
 assert.equal(f.calls.filter(c=>c.method==='turn/start'||c.method==='turn/interrupt').length,0);
 assert.equal(f.events.filter(e=>e.type==='user.message').length,0);
});

test('settings failure keeps the goal paused and never launches work',async()=>{
 const f=fixture();f.goal.status='paused';const request=f.codex.request;
 f.codex.request=async(method,p)=>{if(method==='thread/settings/update')throw Error('settings rejected');return request(method,p);};
 await assert.rejects(f.manager.handleClientCommand(command('settings-rejected')),/settings rejected/);
 assert.equal(f.goal.status,'paused');assert.equal(f.continuations.length,0);
 assert.equal(f.calls.filter(c=>c.method==='thread/goal/set'||c.method==='turn/start').length,0);
 assert.equal(f.events.filter(e=>e.type==='user.message'||e.type==='turn.completed').length,0);
});

test('a new inline goal creates one thread and activates with the submitted settings',async()=>{
 const f=fixture();const objective='完成新会话的目标';
 const c={...command('new-inline-goal'),type:'thread.start',initialText:'/goal '+objective};delete c.threadId;delete c.text;delete c.continueGoal;
 await f.manager.handleClientCommand(c);await f.manager.handleClientCommand(c);
 assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);
 assert.equal(f.calls.filter(call=>call.method==='turn/start').length,0);
 assert.equal(f.events.filter(event=>event.type==='user.message').length,0);
 assert.equal(f.goal.objective,objective);assert.equal(f.goal.status,'active');assert.equal(f.threads[0].title,objective);
 assert.equal(f.continuations.length,1);assert.equal(f.continuations[0].model,'gpt-6-astra');assert.equal(f.continuations[0].effort,'medium');
 const settings=f.calls.findIndex(call=>call.method==='thread/settings/update');
 assert(settings>f.calls.findIndex(call=>call.method==='thread/goal/set'&&call.p.status==='paused'));
 assert(settings<f.calls.findIndex(call=>call.method==='thread/goal/set'&&call.p.status==='active'));
 assert.equal((await f.manager.receipts.get(c.requestId)).threadId,'goal-thread');
});

for(const failure of ['settings rejected','RPC timeout'])test('a partially created goal retries before activation without a duplicate: '+failure,async()=>{
 const f=fixture();const original=f.codex.request;
 f.codex.request=async(method,p)=>{if(method==='thread/settings/update')throw Error(failure);return original(method,p);};
 const c={type:'thread.start',requestId:'new-goal-settings-failure',initialText:'/goal 保留未完成设置的目标',model:'gpt-6-astra',effort:'medium'};
 await assert.rejects(f.manager.handleClientCommand(c),new RegExp(failure));
 await assert.rejects(f.manager.handleClientCommand(c),new RegExp(failure));
 assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);
 assert.equal(f.goal.status,'paused');assert.equal(f.continuations.length,0);
 assert.equal((await f.manager.receipts.get(c.requestId)).threadId,'goal-thread');
 const receipt=await f.manager.receipts.get(c.requestId);assert.equal(receipt.state,'failed');assert.equal(receipt.retryAllowed,true);
 f.codex.request=original;await f.manager.handleClientCommand(c);
 assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);assert.equal(f.continuations.length,1);
 assert.equal(f.goal.status,'active');assert.equal((await f.manager.receipts.get(c.requestId)).state,'accepted');
});
