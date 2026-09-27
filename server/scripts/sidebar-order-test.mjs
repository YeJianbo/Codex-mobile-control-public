import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {desktopSidebar} from '../src/services/desktopSidebar.ts';
import {listThreadsWithCodexHistory} from '../src/services/codexSessions.ts';
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-sidebar-'));
const original=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
try {
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec(`CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER);
  INSERT INTO threads VALUES('old','C:/old','Older conversation','',1000,9000,500,1,0,0),('new','C:/new','Newer conversation','',2000,4000,500,0,NULL,0),('archived','C:/old','Hidden','',9999,9999,500,0,NULL,1);
  CREATE TABLE projects(id TEXT,name TEXT,position INTEGER); CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT);
  INSERT INTO projects VALUES('a','A',0),('b','B',1);INSERT INTO project_roots VALUES('a',0,'C:/a'),('b',0,'C:/b');`);
  db.close();
  await fs.writeFile(path.join(home,'.codex-global-state.json'),JSON.stringify({'pinned-thread-ids':['old'],'project-order':['b','a']}));
  const threads=await listThreadsWithCodexHistory([]);
  assert.deepEqual(threads.map(t=>t.id),['new','old']);
  assert.equal(threads[1].pinnedIndex,1);
  assert.deepEqual((await desktopSidebar()).projects.map(p=>p.id),['b','a']);
  console.log('Desktop sidebar: recency ordering, pin order, project order and archive filtering passed.');
} finally {if(original===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=original;}
