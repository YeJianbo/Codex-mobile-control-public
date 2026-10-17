import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';

test('completion reads stop at the latest lifecycle and preserve chunk, cache and window boundaries',async()=>{
  const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'completion-tail-')),previous=process.env.CODEX_HOME;
  process.env.CODEX_HOME=home;
  const {readCodexThreadCompletion}=await import('../dist/services/codexSessions.js');
  const directory=path.join(home,'sessions');await fs.mkdir(directory);
  const lifecycle=(at,type,extra={})=>JSON.stringify({timestamp:new Date(at).toISOString(),type:'event_msg',payload:{type,...extra}});
  const largeBody=JSON.stringify({type:'response_item',payload:{text:'content'.repeat(180000)}});
  const cases=[
    {body:largeBody+'\n'+lifecycle(2000,'task_complete')+'\n',expected:2000,fast:true},
    {body:largeBody+'\n'+lifecycle(3000,'task_completed'),expected:3000,fast:true},
    {body:lifecycle(2000,'task_complete')+'\r\n'+lifecycle(4000,'task_started')+'\r\n',expected:0},
    {body:lifecycle(2000,'task_complete')+'\n'+lifecycle(5000,'task_completed',{note:'字🙂'.repeat(40000)})+'\n',expected:5000},
    {body:lifecycle(6000,'task_complete')+'\n'+JSON.stringify({type:'response_item',payload:{type:'task_completed'}})+'\n{"type":"event_msg","payload":',expected:6000},
    {body:lifecycle(2000,'task_complete')+'\n'+JSON.stringify({type:'response_item',payload:{text:'x'.repeat(2*1024*1024+1000)}})+'\n',expected:0,capped:true},
    {body:lifecycle(7000,'task_complete'),expected:7000},
  ];
  for(const item of cases){item.id=randomUUID();item.file=path.join(directory,`rollout-${item.id}.jsonl`);await fs.writeFile(item.file,item.body)}
  const original=fs.open;let bytes=0;
  fs.open=async function(file,...args){
    const handle=await original.call(this,file,...args);
    if(path.resolve(String(file)).startsWith(directory+path.sep)){
      const read=handle.read;handle.read=async function(...values){const result=await read.apply(this,values);bytes+=result.bytesRead;return result};
    }
    return handle;
  };
  try{
    for(const item of cases){
      bytes=0;assert.equal(await readCodexThreadCompletion(item.id),item.expected);
      assert(bytes<=2*1024*1024);
      if(item.fast)assert(bytes<=64*1024,'recent lifecycle must not read the whole tail');
      if(item.capped)assert.equal(bytes,2*1024*1024,'completion outside the original window stays excluded');
    }
    const selected=cases[0];bytes=0;
    assert.equal(await readCodexThreadCompletion(selected.id),2000);assert.equal(bytes,0,'unchanged files reuse completion');
    await fs.appendFile(selected.file,lifecycle(8000,'task_started')+'\n');assert.equal(await readCodexThreadCompletion(selected.id),0);
    await fs.appendFile(selected.file,lifecycle(9000,'task_completed')+'\n');assert.equal(await readCodexThreadCompletion(selected.id),9000);
  }finally{fs.open=original;if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;assert(path.resolve(home).startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true})}
});
