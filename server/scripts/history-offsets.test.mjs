import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {HistoryOffsetIndex} from '../src/services/historyOffsets.ts';

test('sparse newline offsets survive restart and append; truncation and same-size rewrites invalidate them',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'history-offsets-'));
  try{
    const file=path.join(directory,'rollout.jsonl'),cache=path.join(directory,'cache');
    const block=Buffer.from(('x'.repeat(1023)+'\n').repeat(8192));
    await fs.writeFile(file,Buffer.concat([block,block]));
    const initial=await fs.stat(file),index=await HistoryOffsetIndex.open(file,initial,cache);
    index.record(block.length,8192);await index.save();
    assert.deepEqual((await HistoryOffsetIndex.open(file,initial,cache)).before(block.length+99),{offset:block.length,line:8192});
    assert.deepEqual(index.before(block.length-1),{offset:0,line:0});
    await fs.appendFile(file,'tail\n');
    assert.equal((await HistoryOffsetIndex.open(file,await fs.stat(file),cache)).before(block.length).line,8192);
    await fs.utimes(file,new Date(),new Date(initial.mtimeMs+5000));
    // An append is valid, but an equal-size file with a changed timestamp is not.
    const appended=await fs.stat(file),next=await HistoryOffsetIndex.open(file,appended,cache);
    next.record(block.length*2,16384);await next.save();
    await fs.utimes(file,new Date(),new Date(appended.mtimeMs+5000));
    assert.equal((await HistoryOffsetIndex.open(file,await fs.stat(file),cache)).before(block.length).offset,0);
    await fs.truncate(file,100);
    assert.equal((await HistoryOffsetIndex.open(file,await fs.stat(file),cache)).before(block.length).offset,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('a new reader reuses offsets inside a large multibyte line without changing physical event IDs',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'history-offset-ids-'));
  try{
    const sessions=path.join(directory,'sessions');await fs.mkdir(sessions);
    const id='offset-fixture',file=path.join(sessions,`rollout-${id}.jsonl`);
    const rows=[{type:'world_state',payload:{data:'界'.repeat(6*1024*1024)}}];
    for(let turn=0;turn<12;turn++)rows.push(
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`question ${turn}`}] }},
      {type:'event_msg',payload:{type:'task_complete',turn_id:`turn-${turn}`}},
    );
    await fs.writeFile(file,rows.map(JSON.stringify).join('\n')+'\n');
    const code=`const {readCodexConversationEvents}=await import(${JSON.stringify(new URL('../src/services/codexSessions.ts',import.meta.url).href)});console.log(JSON.stringify((await readCodexConversationEvents('offset-fixture',10)).map(e=>({id:e.eventId,type:e.type,text:e.text}))));`;
    const read=async()=>JSON.parse((await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{
      cwd:new URL('..',import.meta.url),env:{...process.env,CODEX_HOME:directory,CODEX_MOBILE_CONTROL_HOME:directory},
    })).stdout);
    const first=await read(),second=await read();assert.deepEqual(second,first);
    assert.equal(first.filter(e=>e.type==='user.message').length,11);
    assert.equal(first[0].text,'question 1');assert(first[0].id.endsWith(':4'));
    const index=JSON.parse(await fs.readFile(path.join(directory,'history-offsets',path.basename(file)+'.offsets.json'),'utf8'));
    assert(index.points.length>=2);assert.equal(index.points[0].line,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
