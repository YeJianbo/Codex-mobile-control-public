import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {listThreadsWithCodexHistory} from '../dist/services/codexSessions.js';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-empty-sidebar-'));
const previous=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
try{
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER,source TEXT,has_user_event INTEGER,first_user_message TEXT,tokens_used INTEGER)');
  const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,1000,1000,1000,?,0,0,?,?,?,?)');
  insert.run('empty','C:/test',null,'',0,'vscode',0,'',0);
  insert.run('active','C:/test',null,'',0,'vscode',0,'',0);
  insert.run('pinned','C:/test',null,'',1,'vscode',0,'',0);
  insert.run('named','C:/test','My draft','',0,'vscode',0,'',0);
  insert.run('conversation','C:/test',null,'',0,'vscode',1,'Hello',0);
  insert.run('agent','C:/test',null,'',0,JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'conversation',agent_nickname:'Worker'}}}),0,'',0);
  db.close();
  await fs.writeFile(path.join(home,'session_index.jsonl'),JSON.stringify({id:'empty',thread_name:'Cached empty',updated_at:new Date().toISOString()})+'\n');
  const stored=[{id:'empty',title:'Cached empty',source:'localCodex',status:'idle',updatedAt:new Date().toISOString()}];
  const result=await listThreadsWithCodexHistory(stored,true,['active']);
  assert.deepEqual(new Set(result.map(row=>row.id)),new Set(['active','pinned','named','conversation','agent']));
  console.log('Empty placeholders are hidden across merged sources; active, pinned, named and real conversations remain');
}finally{
  if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
  if(path.dirname(home)===os.tmpdir())await fs.rm(home,{recursive:true,force:true});
}
