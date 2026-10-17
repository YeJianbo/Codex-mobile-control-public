import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('thread writes touch only their row, roll back memory with SQL, and survive reopening',async()=>{
 const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'thread-metadata-'));
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');
 const store=new StateStore();let inspect;
 try{
  await store.load();
  const current=await store.upsertThread({id:'a',title:'original',source:'localCodex'});
  await store.upsertThread({id:'b',title:'untouched',source:'localCodex'});
  await store.rememberDevice({name:'fixture',token:'local-fixture'});await store.createPairing();
  await store.addApproval({id:'fixture',rpcId:1,method:'fixture',threadId:'a',approvalType:'command',title:'fixture'});
  await store.appendEvent({type:'user.message',threadId:'a',eventId:'fixture-event',text:'unchanged history'});
  inspect=new DatabaseSync(path.join(home,'state.sqlite'));
  const unrelated=()=>Object.fromEntries(['devices','pairings','approvals','events'].map(table=>[table,inspect.prepare(`SELECT * FROM ${table}`).all()]));
  const original=unrelated(),other=structuredClone(store.threads.find(row=>row.id==='b'));
  for(const table of ['devices','pairings','approvals','events'])for(const operation of ['INSERT','UPDATE','DELETE']){
   inspect.exec(`CREATE TRIGGER forbid_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'unrelated metadata write'); END`);
  }
  inspect.exec(`CREATE TRIGGER forbid_thread_delete BEFORE DELETE ON threads BEGIN SELECT RAISE(ABORT,'deleted thread metadata'); END;
   CREATE TRIGGER forbid_other_thread_insert BEFORE INSERT ON threads WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'rewrote other thread'); END;
   CREATE TRIGGER forbid_other_thread_update BEFORE UPDATE ON threads WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'updated other thread'); END;
   CREATE TRIGGER forbid_other_source BEFORE INSERT ON thread_sources WHEN NEW.thread_id='b' BEGIN SELECT RAISE(ABORT,'rewrote other source'); END`);
  assert.equal(await store.upsertThread({id:'a',status:'running',projectPath:'F:/fixture'}),current);
  const createdAt=current.createdAt;
  assert.equal(await store.updateThread('a',{title:'  renamed  '}),current);
  assert.equal(current.title,'renamed');assert.equal(current.createdAt,createdAt);assert.equal(current.status,'running');
  await store.upsertThread({id:'new',title:'new thread',source:'localCodex'});
  assert.deepEqual(store.threads.find(row=>row.id==='b'),other);assert.deepEqual(unrelated(),original);
  const stable=structuredClone(current),disk=inspect.prepare("SELECT * FROM threads WHERE id='a'").get();
  inspect.exec("CREATE TRIGGER reject_source BEFORE INSERT ON thread_sources WHEN NEW.source='cloudCodex' BEGIN SELECT RAISE(ABORT,'source rejected'); END");
  await assert.rejects(store.upsertThread({id:'a',title:'must roll back',source:'cloudCodex'}),/source rejected/);
  assert.deepEqual(current,stable);assert.deepEqual(inspect.prepare("SELECT * FROM threads WHERE id='a'").get(),disk);
  assert.equal(inspect.prepare("SELECT source FROM thread_sources WHERE thread_id='a'").get().source,'localCodex');
  await assert.rejects(store.upsertThread({id:'failed-new',source:'cloudCodex'}),/source rejected/);
  assert(!store.threads.some(row=>row.id==='failed-new'));assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM threads WHERE id='failed-new'").get().n,0);
  inspect.exec("CREATE TRIGGER reject_rename BEFORE UPDATE ON threads WHEN NEW.id='a' BEGIN SELECT RAISE(ABORT,'rename rejected'); END");
  await assert.rejects(store.updateThread('a',{title:'must not appear'}),/rename rejected/);assert.deepEqual(current,stable);
  inspect.exec('DROP TRIGGER reject_source; DROP TRIGGER reject_rename');
  await store.upsertThread({id:'a',title:'recovered'});
  store.close();await store.load();
  assert.equal(store.threads.find(row=>row.id==='a').title,'recovered');assert.equal(store.threads.find(row=>row.id==='a').source,'localCodex');
  assert.equal(store.threads.find(row=>row.id==='new').title,'new thread');assert.deepEqual(store.threads.find(row=>row.id==='b'),other);
  await store.upsertThread({id:'a',status:'idle'});assert.equal(inspect.prepare("SELECT status FROM threads WHERE id='a'").get().status,'idle');
  assert.deepEqual(unrelated(),original);
 }finally{inspect?.close();store.close();assert(path.resolve(home).startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true})}
});
