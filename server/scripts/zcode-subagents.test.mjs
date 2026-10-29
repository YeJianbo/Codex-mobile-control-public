import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ZcodeSubagents} from '../src/services/zcodeSubagents.ts';
import {zcodeNativeSessions} from '../src/services/zcodeNativeSessions.ts';
import {readZcodeSessionTokens,registerZcodeModelWindows} from '../src/services/zcodeUsage.ts';

test('stop cancels only the selected native subagent; legacy runtimes are never resumed',async t=>{
  const original=zcodeNativeSessions.list;t.after(()=>zcodeNativeSessions.list=original);
  const parent={sessionId:'sess_parent',thread:{id:'zcode-parent',projectPath:'/workspace'}};
  const child={sessionId:'sess_subagent_agent_fixture',thread:{id:'zcode-child',status:'running',subagent:{parentThreadId:'zcode-parent'}}};
  zcodeNativeSessions.list=async()=>[parent,child];
  const calls=[];let stopped=false;
  const service=new ZcodeSubagents(async(cwd,operation)=>{
    assert.equal(cwd,'/workspace');return operation(async(method,params)=>{
      calls.push({method,params});
      if(method==='session/subagents')return stopped?{running:[],ended:{items:[{childSessionId:child.sessionId,status:'cancelled'}]}}:{running:[{childSessionId:child.sessionId,agentId:'agent_fixture',status:'running'}]};
      if(method==='session/cancelBackgroundTask'){assert.deepEqual(params,{sessionId:parent.sessionId,taskId:'agent_fixture'});stopped=true;return {cancelled:true};}
      throw Error('Unexpected method '+method);
    });
  });
  assert.equal((await service.preview(child.thread.id)).running,true);
  await service.stopTree(child.thread.id);
  const ended=await service.preview(child.thread.id);assert.equal(ended.running,false);assert.equal(ended.canArchive,true);
  assert.equal(ended.thread.status,'interrupted');assert(!calls.some(row=>row.method==='session/stop'||row.method==='session/resume'));
  await assert.rejects(new ZcodeSubagents(async()=>null).stop(child.thread.id),/旧 ZCode 后端/);
});

test('context is the last request rather than summed tokens, and compaction clears stale context',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zcode-context-')),previous=process.env.ZCODE_STORAGE_DIR;
  process.env.ZCODE_STORAGE_DIR=root;fs.mkdirSync(path.join(root,'db'));
  const db=new DatabaseSync(path.join(root,'db','db.sqlite'));
  t.after(()=>{db.close();if(previous===undefined)delete process.env.ZCODE_STORAGE_DIR;else process.env.ZCODE_STORAGE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});});
  db.exec(`CREATE TABLE model_usage(id TEXT,session_id TEXT,provider_id TEXT,model_id TEXT,input_tokens INTEGER,output_tokens INTEGER,
    reasoning_tokens INTEGER,cache_read_input_tokens INTEGER,started_at INTEGER,completed_at INTEGER);
    CREATE TABLE message(session_id TEXT,time_updated INTEGER,data TEXT);`);
  const insert=db.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('a','s','account','GLM-5.3',100,10,5,80,10,15);insert.run('b','s','account','GLM-5.3',200,20,10,160,20,25);
  registerZcodeModelWindows([{ref:{providerId:'account',modelId:'GLM-5.3'},contextWindow:1000000}]);
  const tokens=readZcodeSessionTokens('s',{context:999,last:330});
  assert.equal(tokens.total,330);assert.equal(tokens.context,220);assert.equal(tokens.contextWindow,1000000);assert.equal(tokens.last,null);
  db.prepare('INSERT INTO message VALUES(?,?,?)').run('s',30,JSON.stringify({semantics:{kind:'compact_summary'}}));
  const compacted=readZcodeSessionTokens('s',{context:220,last:330});
  assert.equal(compacted.context,null);assert.equal(compacted.last,null);assert.equal(compacted.contextState,'awaiting_usage');assert.equal(compacted.total,330);
});
