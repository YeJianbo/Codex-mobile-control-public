import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {desktopSidebar,desktopPinnedThreads,PINNED_SECTION_ID} from '../src/services/desktopSidebar.ts';
import {listThreadsWithCodexHistory} from '../src/services/codexSessions.ts';

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
