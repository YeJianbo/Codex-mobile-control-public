import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('a rejected event leaves neither history nor replay and can be retried',async()=>{
 const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'event-atomicity-'));
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');
 const store=new StateStore();let inspect;
 try{
  await store.load();inspect=new DatabaseSync(path.join(home,'state.sqlite'));
  for(const [threadId,id,table] of [['codex-fixture','codex-event','codex_live_events'],['opencode-fixture','opencode-event','agent_history']]){
   const event={type:'message.delta',threadId,eventId:id,text:'retained only after commit'};
   inspect.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'isolated write failure'); END");
   await assert.rejects(store.appendEvent(event),/isolated write failure/);
   assert(!store.events.some(row=>row.eventId===id));
   assert.equal(inspect.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_key=?`).get(id).n,0);
   assert.equal(inspect.prepare('SELECT COUNT(*) AS n FROM codex_live_windows WHERE thread_id=?').get(threadId).n,0);
   assert.deepEqual(store.eventsForThread(threadId),[]);
   inspect.exec('DROP TRIGGER reject_fixture');
   await store.appendEvent(event);
   assert.deepEqual(store.eventsForThread(threadId),[event]);
   assert.equal(store.events.filter(row=>row.eventId===id).length,1);
  }
  store.close();await store.load();
  assert.equal(store.events.length,2);
  await store.appendEvent({type:'message.delta',threadId:'codex-fixture',eventId:'after-reopen',text:'still writable'});
  assert.equal(store.events.at(-1).eventId,'after-reopen');
 }finally{inspect?.close();store.close();assert(home.startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true})}
});
