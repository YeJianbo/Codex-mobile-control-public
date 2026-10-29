import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionTokenLedger} from '../src/services/sessionTokenLedger.ts';
import {UsageReader} from '../src/services/usage.ts';

test('family totals count each descendant once and leave parent context unchanged',()=>{
  const db=new DatabaseSync(':memory:'),ledger=new SessionTokenLedger(db);
  try{
    ledger.relate('child','root','审查');ledger.relate('grandchild','child','检查');
    ledger.record('child',{input:40,cached:20,output:10,reasoning:5,total:50},'2026-10-23T00:00:01Z');
    ledger.record('grandchild',{input:20,cached:10,output:5,total:25},'2026-10-23T00:00:01Z');
    const main={input:80,cached:40,output:20,reasoning:10,total:100,context:10,contextWindow:100,updatedAt:'2026-10-23T00:00:01Z'};
    const first=ledger.combine('root',main),second=ledger.combine('root',main);
    assert.equal(first.total,175);assert.equal(second.total,175);assert.equal(first.self.total,100);
    assert.equal(first.subagents.total,75);assert.equal(first.subagents.count,2);
    assert.equal(first.input,140);assert.equal(first.cached,70);assert.equal(first.output,35);
    assert.equal(first.context,10);assert.equal(first.contextWindow,100);assert.equal(first.partial,false);
    assert.equal(ledger.combine('child',null).total,75);
    ledger.record('child',{total:1},'2026-10-22T00:00:01Z');
    assert.equal(ledger.combine('root',main).total,175,'late replay cannot replace newer usage');
  }finally{db.close();}
});

test('missing child usage stays unknown and has a separate partial marker',()=>{
  const db=new DatabaseSync(':memory:'),ledger=new SessionTokenLedger(db);
  try{
    ledger.relate('pending','root');
    const value=ledger.combine('root',{total:100});
    assert.equal(value.total,100);assert.equal(value.subagents.total,null);
    assert.equal(value.subagents.knownCount,0);assert.equal(value.partial,true);
    assert.equal(value.subagents.threads[0].total,null);
    ledger.record('pending',{total:50},new Date().toISOString());
    const knownTotal=ledger.combine('root',{input:90,cached:80,output:10,total:100});
    assert.equal(knownTotal.total,150);assert.equal(knownTotal.input,null);assert.equal(knownTotal.cached,null);
  }finally{db.close();}
});

test('archived children survive native deletion, repeated reads and ledger restart',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-family-usage-'));
  const oldHome=process.env.CODEX_HOME,oldApp=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  let native,db,reader;
  const backend=()=>Object.assign(new EventEmitter(),{request:async()=>({rateLimits:{}})});
  const file=(id,archived=false)=>path.join(home,archived?'archived_sessions':'sessions',`rollout-${id}.jsonl`);
  const snapshot=total=>JSON.stringify({type:'event_msg',timestamp:'2026-10-23T00:00:00Z',payload:{type:'token_count',info:{
    total_token_usage:{input_tokens:total-10,output_tokens:10,total_tokens:total},
    last_token_usage:{total_tokens:10},model_context_window:100}}})+'\n';
  try{
    await fs.mkdir(path.join(home,'sessions'));await fs.mkdir(path.join(home,'archived_sessions'));
    await fs.writeFile(file('root'),snapshot(100));await fs.writeFile(file('child',true),snapshot(50));
    native=new DatabaseSync(path.join(home,'state_5.sqlite'));
    native.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,source TEXT,rollout_path TEXT,archived INTEGER,title TEXT)');
    native.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('child',JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'root'}}}),file('child',true),1,'已归档子代理');
    db=new DatabaseSync(path.join(home,'ledger.sqlite'));const ledger=new SessionTokenLedger(db),codex=backend();
    reader=new UsageReader(codex,()=>{},ledger);
    codex.emit('notification',{method:'thread/started',params:{thread:{id:'live-child',source:{subAgent:{threadSpawn:{parentThreadId:'live-parent'}}}}}});
    assert.deepEqual(ledger.ancestors('live-child'),['live-parent']);
    let result=await reader.read('root');assert.equal(result.tokens.total,150);assert.equal(result.tokens.subagents.total,50);
    assert.equal(result.tokens.context,10);
    // A native live event updates the same cumulative row, rather than adding
    // its cumulative value again; it also invalidates the parent's UI cache.
    const invalidated=[];reader.close();reader=new UsageReader(codex,id=>invalidated.push(id),ledger);
    codex.emit('notification',{method:'thread/tokenUsage/updated',params:{threadId:'child',tokenUsage:{total:{inputTokens:50,outputTokens:10,totalTokens:60}}}});
    assert(invalidated.includes('root'));assert.equal((await reader.read('root')).tokens.total,160);
    native.prepare('DELETE FROM threads WHERE id=?').run('child');await fs.rm(file('child',true));
    reader.close();db.close();db=new DatabaseSync(path.join(home,'ledger.sqlite'));
    reader=new UsageReader(backend(),()=>{},new SessionTokenLedger(db));
    result=await reader.read('root');assert.equal(result.tokens.total,160);assert.equal(result.tokens.subagents.total,60);
    assert.equal(result.tokens.subagents.threads[0].name,'已归档子代理');
    assert.equal((await reader.read('root')).tokens.total,160);
  }finally{
    reader?.close();db?.close();native?.close();
    if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;
    if(oldApp===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=oldApp;
    await fs.rm(home,{recursive:true,force:true});
  }
});
