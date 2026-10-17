import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {desktopSidebar,desktopPinnedThreads,PINNED_SECTION_ID} from '../src/services/desktopSidebar.ts';
import {listThreadsWithCodexHistory} from '../src/services/codexSessions.ts';
import {StateStore} from '../src/services/stateStore.ts';

test('Harness pins persist across reload and survive authoritative desktop pin merging',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-harness-pins-'));
 const previous=process.env.CODEX_HOME,previousGateway=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=path.join(home,'gateway');
 let store;
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
 try{
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER,thread_section_id TEXT)');
  store=new StateStore();await store.load();
  for(const id of ['claude-test','opencode-test'])await store.upsertThread({id,projectPath:home,title:id,status:'idle'});
  store.setThreadPinned('claude-test',true);store.setThreadPinned('opencode-test',true);
  store.setThreadPinned('claude-test',true);
  assert.equal(store.threads.find(row=>row.id==='claude-test').pinnedIndex,1);
  store.close();store=new StateStore();await store.load();
  const merged=await listThreadsWithCodexHistory(store.threads);
  assert.equal(merged.find(row=>row.id==='claude-test').pinnedIndex,1);
  assert.equal(merged.find(row=>row.id==='opencode-test').pinnedIndex,2);
  store.setThreadPinned('claude-test',false);store.close();store=new StateStore();await store.load();
  assert.equal(store.threads.find(row=>row.id==='claude-test').pinnedIndex,undefined);
  assert.equal(store.threads.find(row=>row.id==='opencode-test').pinnedIndex,1);
 }finally{
  store?.close();db.close();
  if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
  if(previousGateway===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousGateway;
  await fs.rm(home,{recursive:true,force:true});
 }
});

test('section pin and unpin survive stale desktop JSON and cached thread metadata',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-pins-')),previous=process.env.CODEX_HOME;
 process.env.CODEX_HOME=home;
 const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
 try{
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER,thread_section_id TEXT)');
  const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('a','X:/test','A','',1000,1000,1000,0,null,0,null);
  insert.run('b','X:/test','B','',1000,1000,1000,0,1,0,PINNED_SECTION_ID);
  insert.run('custom','X:/test','Custom','',1000,1000,1000,0,0,0,'custom-section');
  await fs.writeFile(path.join(home,'.codex-global-state.json'),JSON.stringify({'pinned-thread-ids':['a'], 'electron-persisted-atom-state':{'app-server-pinned-thread-order-v1':['a']}}));
  assert.deepEqual((await desktopSidebar()).pinned,['b']);
  assert.deepEqual(await desktopPinnedThreads(),['b']);
  db.prepare('UPDATE threads SET thread_section_id=?,section_position=0 WHERE id=?').run(PINNED_SECTION_ID,'a');
  const pinned=await listThreadsWithCodexHistory([]);
  assert.equal(pinned.find(t=>t.id==='a').pinnedIndex,1);
  assert.deepEqual(await desktopPinnedThreads(),['a','b']);
  assert.equal(pinned.find(t=>t.id==='b').pinnedIndex,2);
  assert.equal(pinned.find(t=>t.id==='custom').pinnedIndex,undefined);
  db.prepare('UPDATE threads SET thread_section_id=NULL,section_position=NULL WHERE id=?').run('a');
  const unpinned=await listThreadsWithCodexHistory(pinned);
  assert.equal(unpinned.find(t=>t.id==='a').pinnedIndex,undefined);
  assert.equal(unpinned.find(t=>t.id==='b').pinnedIndex,1);
  assert.deepEqual((await desktopSidebar()).pinned,['b']);
  assert.deepEqual(await desktopPinnedThreads(),['b']);
 }finally{db.close();if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('legacy desktop installations still expose JSON pins when section storage is unavailable',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-pins-legacy-')),previous=process.env.CODEX_HOME;
 process.env.CODEX_HOME=home;
 try{
  await fs.writeFile(path.join(home,'.codex-global-state.json'),JSON.stringify({'pinned-thread-ids':['legacy']}));
  const sidebar=await desktopSidebar();assert.deepEqual(sidebar.pinned,['legacy']);assert.equal(sidebar.pinsAuthoritative,false);
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
