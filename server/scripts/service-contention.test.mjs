import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FollowupQueue} from '../src/services/followupQueue.ts';
import {UsageReader} from '../src/services/usage.ts';

const store=()=>({readFollowups:()=>[],writeFollowup:()=>{},writeFollowupOrder:()=>{}});
const entry=(id)=>({id,threadId:id,text:id,images:[],files:[]});
const bounded=async promise=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation blocked by unrelated service')),2000);})]);}
  finally{clearTimeout(timer);}
};

test('a pending status lookup blocks neither another queue nor an explicit steer',async()=>{
  let resolveStatus,resolveSent;const sent=[],steered=[];
  const slow=new Promise(resolve=>{resolveStatus=resolve;}),otherSent=new Promise(resolve=>{resolveSent=resolve;});
  const queue=new FollowupQueue(store(),{canSteer:()=>true,steer:async id=>{steered.push(id);}},id=>id==='slow'?slow:Promise.resolve('completed'),async e=>{sent.push(e.id);resolveSent();});
  let tick;
  try{
    queue.add(entry('slow'));queue.add(entry('other'));tick=queue.tick();
    await bounded(otherSent);assert.deepEqual(sent,['other']);
    await queue.steer('slow','slow','turn');assert.deepEqual(steered,['slow']);
    resolveStatus('completed');await tick;assert.deepEqual(sent,['other']);
  }finally{resolveStatus('running');await tick;queue.close();}
});

test('an uncertain steer result stays retained and is never automatically submitted as a new turn',async()=>{
  let sends=0;
  const queue=new FollowupQueue(store(),{canSteer:()=>true,steer:async()=>{throw Error('Codex app-server 请求超时：turn/steer');}},async()=>'completed',async()=>{sends++;});
  try{
    queue.add(entry('uncertain'));await assert.rejects(queue.steer('uncertain','uncertain','turn'),/超时/);
    assert.equal(queue.list('uncertain')[0].status,'failed');await queue.tick();assert.equal(sends,0);
  }finally{queue.close();}
});

test('quota reads return while the backend is pending and reuse one real RPC',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'quota-contention-'));
  const previous={CODEX_HOME:process.env.CODEX_HOME,CODEX_MOBILE_CONTROL_HOME:process.env.CODEX_MOBILE_CONTROL_HOME};
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  let resolveRpc,calls=0;const rpc=new Promise(resolve=>{resolveRpc=resolve;});
  const reader=new UsageReader({request:()=>{calls++;return rpc;}});
  try{
    const first=await bounded(reader.read()),second=await bounded(reader.read());
    assert.equal(first.quota.stale,true);assert.equal(second.quota.stale,true);assert.equal(calls,1);
    resolveRpc({rateLimits:{primary:{usedPercent:25,windowDurationMins:300}}});await new Promise(setImmediate);
    const updated=await reader.read();assert.equal(updated.quota.stale,false);assert.equal(updated.quota.windows[0].remainingPercent,75);assert.equal(calls,1);
  }finally{
    resolveRpc({});reader.close();
    for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await fs.rm(home,{recursive:true,force:true});
  }
});
