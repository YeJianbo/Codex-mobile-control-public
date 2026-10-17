import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionManager} from '../dist/services/sessionManager.js';
import {historyToolPresentation} from '../dist/services/codexSessions.js';
import {FollowupQueue} from '../dist/services/followupQueue.js';

test('resume skips full history and preserves the active turn from its metadata page',async()=>{
 const codex=new EventEmitter(),events=[],calls=[],threads=[];
 codex.request=async(method,params)=>{calls.push({method,params});return {thread:{id:'t',status:{type:'active'},turns:[]},initialTurnsPage:{data:[{id:'active',status:'inProgress',items:[]}]}};};
 const sessions=new SessionManager(codex,{publish:e=>events.push(e)},{threads,approvals:[],upsertThread:async thread=>{threads.push(thread);return thread}});
 await sessions.resumeThread('t');
 assert.equal(calls[0].params.excludeTurns,true);
 assert.deepEqual(calls[0].params.initialTurnsPage,{limit:1,sortDirection:'desc',itemsView:'notLoaded'});
 assert.equal(sessions.canSteer('t'),true);assert.equal(threads.at(-1).status,'running');
 await sessions.interrupt('t');assert.equal(calls.at(-1).params.turnId,'active');
});

test('resume does not resurrect a persisted inProgress turn on an idle backend',async()=>{
 const codex=new EventEmitter(),threads=[],events=[];
 codex.request=async()=>({thread:{id:'t',status:{type:'idle'}},initialTurnsPage:{data:[{id:'before-crash',status:'inProgress'}]}});
 const sessions=new SessionManager(codex,{publish:e=>events.push(e)},{threads,approvals:[],upsertThread:async thread=>{threads.push(thread);return thread}});
 await sessions.resumeThread('t');
 assert.equal(sessions.canSteer('t'),false);
 assert.equal(sessions.ownsThread('t'),false);
 assert.equal(threads.at(-1).status,'idle');
});

function staleDesktopFixture(read){
 const codex=new EventEmitter(),stored=[],threads=[{id:'t',status:'running'}],published=[];
 const history=[{type:'turn.started',threadId:'t',turnId:'before-crash',createdAt:'2026-10-02T05:00:00Z'}];
 codex.request=read;
 const store={threads,approvals:[],eventsForThread:()=>stored,upsertThread:async value=>{Object.assign(threads[0],value);return threads[0]}};
 const sessions=new SessionManager(codex,{publish:e=>{const event={...e,createdAt:new Date().toISOString()};stored.push(event);published.push(event);}},store);
 return {codex,sessions,history,stored,threads,published};
}

test('history status snapshot never waits for backend and does not end a running turn',async()=>{
 let calls=0;
 const f=staleDesktopFixture(()=>{calls++;return new Promise(()=>{});});
 assert.equal(await f.sessions.currentThreadStatus('t',f.history,false),'running');
 assert.equal(calls,0);assert.equal(f.published.length,0);
 const completed={type:'turn.completed',threadId:'t',status:'completed',createdAt:'2026-10-02T05:01:00Z'};
 assert.equal(await f.sessions.currentThreadStatus('t',[...f.history,completed],false),'completed');
 assert.equal(calls,0);
});

test('crash recovery persists one interruption and preserves conversation content',async()=>{
 const f=staleDesktopFixture(async(method,params)=>{assert.equal(method,'thread/read');assert.deepEqual(params,{threadId:'t',includeTurns:false});return {thread:{status:{type:'notLoaded'}}};});
 const answer={type:'message.delta',threadId:'t',text:'已产生的正文',createdAt:'2026-10-02T05:00:01Z'};f.stored.push(answer);
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'interrupted');
 assert.equal(f.threads[0].status,'interrupted');
 assert.equal(f.published.at(-1).turnId,'before-crash');
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'interrupted');
 assert.equal(f.published.length,1);assert.equal(f.stored[0],answer);
});

test('gateway reconnect preserves a turn that is still active in the backend',async()=>{
 const f=staleDesktopFixture(async()=>({thread:{status:{type:'active'}}}));
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'running');
 assert.equal(f.published.length,0);
});

test('slow status checks share the real RPC and return the local running state within the action budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let resolve,calls=0;const pending=new Promise(done=>{resolve=done;});
 const f=staleDesktopFixture(()=>{calls++;return pending;});
 const first=f.sessions.currentThreadStatus('t',f.history),second=f.sessions.currentThreadStatus('t',f.history);
 assert.equal(calls,1);t.mock.timers.tick(1500);
 assert.deepEqual(await Promise.all([first,second]),['running','running']);
 assert.equal(f.published.length,0);
 resolve({thread:{status:{type:'active'}}});await new Promise(setImmediate);
});

test('failed or unrecognized status reads do not end a running turn',async()=>{
 for(const read of [async()=>{throw Error('disconnected')},async()=>({thread:{status:{type:'systemError'}}})]){
  const f=staleDesktopFixture(read);
  assert.equal(await f.sessions.currentThreadStatus('t',f.history),'running');assert.equal(f.published.length,0);
 }
});

test('new turn notification during recovery prevents ending the new turn',async()=>{
 const f=staleDesktopFixture(async()=>{
  f.codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'after-reconnect',status:'inProgress'}}});
  return {thread:{status:{type:'idle'}}};
 });
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'running');
 assert.equal(f.sessions.canSteer('t'),true);assert.equal(f.published.some(e=>e.type==='turn.completed'),false);
});

test('concurrent recovery reads publish only one terminal event',async()=>{
 const f=staleDesktopFixture(async()=>{await new Promise(resolve=>setTimeout(resolve,10));return {thread:{status:{type:'idle'}}};});
 assert.deepEqual(await Promise.all([f.sessions.currentThreadStatus('t',f.history),f.sessions.currentThreadStatus('t',f.history)]),['interrupted','interrupted']);
 assert.equal(f.published.length,1);
});

test('recovery also clears a stale turn tracked by this gateway',async()=>{
 const f=staleDesktopFixture(async()=>({thread:{status:{type:'notLoaded'}}}));
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'before-crash'}}});
 assert.equal(f.sessions.canSteer('t'),true);
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'interrupted');
 assert.equal(f.sessions.canSteer('t'),false);
});

test('evicted recovery events do not revive a persisted interrupted turn on a failed read',async()=>{
 const f=staleDesktopFixture(async()=>{throw Error('disconnected')});
 Object.assign(f.threads[0],{status:'interrupted',updatedAt:'2026-10-03T01:00:00Z'});
 assert.equal(await f.sessions.currentThreadStatus('t',f.history),'interrupted');
 assert.equal(f.published.length,0);
});

test('notLoaded notifications invalidate the tracked turn immediately',async()=>{
 const f=staleDesktopFixture(async()=>({}));
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'old'}}});
 f.codex.emit('notification',{method:'thread/status/changed',params:{threadId:'t',status:{type:'notLoaded'}}});
 assert.equal(f.sessions.canSteer('t'),false);assert.equal(f.threads[0].status,'interrupted');
 assert.equal(f.published.at(-2).type,'turn.completed');
});

test('unknown live status preserves a tracked new turn over an older completion',async()=>{
 const f=staleDesktopFixture(async()=>({}));
 const completed={type:'turn.completed',threadId:'t',turnId:'before-crash',status:'completed',createdAt:'2026-10-02T05:00:01Z'};
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'new'}}});
 assert.equal(await f.sessions.currentThreadStatus('t',[...f.history,completed]),'running');
 assert.equal(f.sessions.canSteer('t'),true);
});

test('backend loss ends the tracked new turn without accepting an older completion',async()=>{
 const f=staleDesktopFixture(async()=>({thread:{status:{type:'notLoaded'}}}));
 const completed={type:'turn.completed',threadId:'t',turnId:'before-crash',status:'completed',createdAt:'2026-10-02T05:00:01Z'};
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'new'}}});
 assert.equal(await f.sessions.currentThreadStatus('t',[...f.history,completed]),'interrupted');
 assert.equal(f.published.at(-1).turnId,'new');assert.equal(f.sessions.canSteer('t'),false);
});

test('desktop turn can be interrupted before it is tracked by this gateway',async()=>{
 const codex=new EventEmitter(),events=[],calls=[],threads=[];
 codex.request=async(method,params)=>{calls.push({method,params});return {}};
 const store={threads,approvals:[],upsertThread:async thread=>{threads.push(thread);return thread}};
 const sessions=new SessionManager(codex,{publish:e=>events.push(e)},store);
 assert.equal(sessions.ownsThread('desktop'),false);
 await sessions.interrupt('desktop','desktop-active-turn','phone-stop');
 assert.deepEqual(calls,[{method:'turn/interrupt',params:{threadId:'desktop',turnId:'desktop-active-turn'}}]);
 assert.equal(events.at(-1).type,'turn.completed');
 assert.equal(events.at(-1).requestId,'phone-stop');
 assert.equal(threads.at(-1).status,'interrupted');
 codex.request=async()=>{throw Error('network failure')};
 await assert.rejects(sessions.interrupt('desktop','another-turn'),/network failure/);
 assert.equal(events.length,1);
});

test('interrupt reply cannot clear a newer running turn',async()=>{
 const codex=new EventEmitter(),events=[],threads=[];
 const sessions=new SessionManager(codex,{publish:e=>events.push(e)},{threads,approvals:[],upsertThread:async thread=>{threads.push(thread);return thread}});
 codex.request=async()=>{codex.emit('notification',{method:'turn/started',params:{threadId:'t',turn:{id:'next',status:'inProgress'}}});return {}};
 await sessions.interrupt('t','old');
 assert.equal(sessions.canSteer('t'),true);
 assert.equal(events.some(e=>e.type==='turn.completed'),false);
 assert.equal(threads.at(-1).status,'running');
});

test('imageView forwards the path on both lifecycle events',()=>{
 const codex=new EventEmitter(),events=[];
 new SessionManager(codex,{publish:e=>events.push(e)},{threads:[],approvals:[]});
 for(const method of ['item/started','item/completed'])codex.emit('notification',{method,params:{threadId:'t',item:{id:'image',type:'imageView',path:'F:/project/image.png'}}});
 assert.equal(events.length,2);
 for(const event of events)assert.match(event.detail,/!\[查看图片\]\(<F:\/project\/image.png>\)/);
 assert.match(historyToolPresentation('imageView',JSON.stringify({path:'F:/project/image.png'})).detail,/image.png/);
});
test('queue order survives reload and failed persistence leaves memory unchanged',()=>{
 const saved=new Map(),store={readFollowups:()=>[...saved.values()].map(e=>({...e})),writeFollowup:(id,e)=>saved.set(id,{...e}),writeFollowupOrder:entries=>entries.forEach(e=>saved.set(e.id,{...e}))};
 const sessions={canSteer:()=>false};
 let q=new FollowupQueue(store,sessions,async()=> 'running',async()=>{});
 try{
  for(const id of ['a','b','c'])q.add({id,threadId:'t',text:id,images:[],files:[]});
  q.move('c','t','up');assert.deepEqual(q.list('t').map(e=>e.id),['a','c','b']);
  q.close();q=new FollowupQueue(store,sessions,async()=> 'running',async()=>{});
  assert.deepEqual(q.list('t').map(e=>e.id),['a','c','b']);
  store.writeFollowupOrder=()=>{throw Error('disk error')};
  assert.throws(()=>q.move('c','t','up'),/disk error/);
  assert.deepEqual(q.list('t').map(e=>e.id),['a','c','b']);
  assert.throws(()=>q.move('c','other','up'),/消息已发送或取消/);
 }finally{q.close();}
});
