import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {listThreadsWithCodexHistory} from '../src/services/codexSessions.ts';

test('desktop deletion removes cached threads without losing new, active or external sessions',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-deletion-')),previous=process.env.CODEX_HOME;
  process.env.CODEX_HOME=home;
  const id='11111111-1111-1111-1111-111111111111',old='2025-01-01T00:00:00.000Z';
  const deleted={id,title:'deleted',status:'completed',createdAt:old,updatedAt:old};
  const external={...deleted,id:'antigravity-123'};
  const fresh={...deleted,id:'22222222-2222-2222-2222-222222222222',createdAt:new Date().toISOString()};
  const file=path.join(home,'state_5.sqlite');
  try{
    assert((await listThreadsWithCodexHistory([deleted],true)).some(t=>t.id===id),'unavailable database must not remove cached threads');
    const db=new DatabaseSync(file);
    db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER)');
    db.close();
    await fs.writeFile(path.join(home,'session_index.jsonl'),JSON.stringify({id,thread_name:'stale index',updated_at:old}));
    const result=await listThreadsWithCodexHistory([deleted,external,fresh],true);
    assert(!result.some(t=>t.id===id));assert(result.some(t=>t.id===external.id));assert(result.some(t=>t.id===fresh.id));
    assert((await listThreadsWithCodexHistory([deleted],true,[id])).some(t=>t.id===id));
  }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
