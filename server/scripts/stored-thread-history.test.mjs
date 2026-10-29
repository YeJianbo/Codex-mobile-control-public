import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';

test('worker reads preserve messages, defer operation bodies and invalidate pruned prefixes',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'stored-thread-history-'));
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');
 const {closeHistoryWorkers}=await import('../dist/services/historyWorkers.js');
 const store=new StateStore();let db;
 try{
   await store.load();
   const put=event=>store.appendEvent({threadId:'t',...event});
   await put({type:'turn.started',eventId:'start',turnId:'one'});
   await put({type:'message.delta',eventId:'answer',itemId:'reply',text:'complete answer'});
   await put({type:'reasoning.summary',eventId:'reason',text:'full reasoning'});
   await put({type:'tool.completed',eventId:'operation',title:'Run command',detail:'large output '.repeat(2000)});
   await put({type:'diff.updated',eventId:'old-diff',turnId:'one',diff:'old patch'});
   await put({type:'diff.updated',eventId:'new-diff',turnId:'one',diff:'+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new'});
   await put({type:'tool.completed',eventId:'internal',detail:'codex_internal_context'});
   const original=await store.readThreadEvents('t');
   assert.deepEqual(original,store.eventsForThread('t'));
   const preview=await store.readThreadEvents('t',true);
   assert.equal(preview.some(e=>e.eventId==='internal'),false);
   assert.equal(preview.find(e=>e.eventId==='answer').text,'complete answer');
   assert.equal(preview.find(e=>e.eventId==='operation').detailsDeferred,true);
   assert.equal(preview.find(e=>e.eventId==='operation').detail,undefined);
   assert.deepEqual(preview.find(e=>e.eventId==='new-diff').fileChanges,[{path:'test.ts',added:1,removed:1}]);
   assert.equal(store.eventsForIds('t',['old-diff'])[0].diff,'old patch');
   assert.equal(store.eventsForIds('t',['operation'])[0].detail,'large output '.repeat(2000));
   const live=await store.readThreadEvents('t','live');
   assert.equal(live.find(e=>e.eventId==='reason').text,'full reasoning');
   await put({type:'message.delta',eventId:'appended',text:'new text'});
   assert.equal((await store.readThreadEvents('t')).at(-1).eventId,'appended');
   // Evict the main replay ring before cutting the disk prefix.
   for(let i=0;i<1001;i++)await store.appendEvent({threadId:'other',type:'message.delta',eventId:`other-${i}`,text:'x'});
   db=new DatabaseSync(path.join(home,'state.sqlite'));
   db.prepare("DELETE FROM codex_live_events WHERE thread_id='t' AND seq<(SELECT seq FROM codex_live_events WHERE event_key='appended')").run();
   assert.deepEqual((await store.readThreadEvents('t')).map(e=>e.eventId),['appended']);
   await store.appendEvent({threadId:'antigravity-test',type:'message.delta',eventId:'external',text:'external complete answer'});
   assert.equal((await store.readThreadEvents('antigravity-test'))[0].text,'external complete answer');
 }finally{
   db?.close();store.close();await closeHistoryWorkers();await rm(home,{recursive:true,force:true});
 }
});
