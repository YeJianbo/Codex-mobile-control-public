import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {zstdCompressSync} from 'node:zlib';
import {readTokenSnapshot} from '../src/services/codexTokenUsage.ts';
import {readCodexThreadUsage,readCodexThreadEvents,readCodexThreadEventById} from '../src/services/codexSessions.ts';
import {tokenCounts,UsageReader} from '../src/services/usage.ts';
import {ThreadEventCache} from '../public/thread-cache.js';
import {compressedRolloutTail} from '../src/services/rolloutReader.ts';

const info=(last=30920)=>({total_token_usage:{input_tokens:1712825353,cached_input_tokens:1684242176,output_tokens:4051077,reasoning_output_tokens:1580606,total_tokens:1716876430},last_token_usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:last},model_context_window:380000});
const row=(type,payload,at='2026-10-03T00:00:00Z')=>JSON.stringify({type,payload,timestamp:at})+'\n';
test('post-compaction context estimate is separate from lifetime consumption and request tokens',()=>{
 const counts=tokenCounts(info());assert.equal(counts.total,1716876430);assert.equal(counts.context,30920);assert.equal(counts.last,null);assert.equal(counts.contextState,'compacted');assert(Math.abs(counts.contextPercent-8.1368)<0.001);
 assert.equal(tokenCounts(info(),true).context,null);assert.equal(tokenCounts(info(),true).contextState,'awaiting_usage');
});
test('compressed rollout preserves tokens, visible history and stable activity IDs; plain copy takes precedence',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-compressed-')),previous=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
 try{
  const dir=path.join(home,'sessions');await fs.mkdir(dir);const id='compressed-fixture',plain=path.join(dir,'rollout-'+id+'.jsonl'),compressed=plain+'.zst';
  const text=row('session_meta',{id,cwd:home})+row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'保留的用户消息'}]})+row('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'保留的压缩会话正文'}]})+row('event_msg',{type:'token_count',info:info()});
  await fs.writeFile(compressed,zstdCompressSync(Buffer.from(text)));
  assert.equal(tokenCounts((await readCodexThreadUsage(id)).info).context,30920);
  const events=await readCodexThreadEvents(id);assert(events.some(e=>e.text==='保留的压缩会话正文'));
  const user=events.find(e=>e.type==='user.message');assert(user.eventId.includes('.jsonl:2'));assert(!user.eventId.includes('.zst:'));
  assert.equal((await readCodexThreadEventById(id,user.eventId)).text,'保留的用户消息');
  await fs.writeFile(plain,text);const reread=await readCodexThreadEvents(id);assert.equal(reread.filter(e=>e.text==='保留的压缩会话正文').length,1);
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
test('compression marker without a newer token snapshot does not claim the old context size is current',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-token-tail-')),file=path.join(dir,'rollout.jsonl');
 try{
  const original=row('event_msg',{type:'token_count',info:info(288272)});
  await fs.writeFile(file,original+row('compacted',{message:'压缩完成'},'2026-10-03T00:00:01Z'));
  let snapshot=await readTokenSnapshot(file);assert(snapshot.contextPending);assert.equal(tokenCounts(snapshot.info,snapshot.contextPending).context,null);
  await fs.appendFile(file,row('event_msg',{type:'token_count',info:info()},'2026-10-03T00:00:02Z'));snapshot=await readTokenSnapshot(file);assert.equal(snapshot.contextPending,undefined);assert.equal(tokenCounts(snapshot.info).context,30920);
  await fs.appendFile(file,row('event_msg',{type:'token_count',info:info(1)}).slice(0,-4));assert.equal(tokenCounts((await readTokenSnapshot(file)).info).context,30920);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('truncated compressed logs are rejected instead of publishing partial counters',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-truncated-token-')),file=path.join(dir,'rollout.jsonl.zst');
 try{const full=zstdCompressSync(Buffer.from(row('event_msg',{type:'token_count',info:info()})));await fs.writeFile(file,full.subarray(0,full.length-1));await assert.rejects(readTokenSnapshot(file),/不完整|unexpected|error/i);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('context_compaction in a compressed rollout invalidates old context until the next snapshot',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-compaction-marker-')),file=path.join(dir,'rollout.jsonl.zst');
 try{
  const previous=info(288272);
  const compacted=row('event_msg',{type:'token_count',info:previous})+
   row('event_msg',{type:'context_compaction'},'2026-10-03T00:00:01Z');
  await fs.writeFile(file,zstdCompressSync(Buffer.from(compacted)));
  const pending=await readTokenSnapshot(file),pendingCounts=tokenCounts(pending.info,pending.contextPending);
  assert.equal(pending.contextPending,true);
  assert.equal(pendingCounts.context,null);
  assert.equal(pendingCounts.contextState,'awaiting_usage');
  assert.equal(pendingCounts.total,previous.total_token_usage.total_tokens);
  await fs.writeFile(file,zstdCompressSync(Buffer.from(compacted+
   row('event_msg',{type:'token_count',info:info()},'2026-10-03T00:00:02Z'))));
  const current=await readTokenSnapshot(file),counts=tokenCounts(current.info,current.contextPending);
  assert.equal(current.contextPending,undefined);
  assert.equal(counts.context,30920);
  assert.equal(counts.contextState,'compacted');
  assert.equal(counts.total,previous.total_token_usage.total_tokens);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('compressed tail stays within its byte budget, preserves absolute line IDs and is reused',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-large-compressed-')),file=path.join(dir,'rollout.jsonl.zst');
 try{
  const text=row('session_meta',{id:'large'})+row('unused',{padding:'x'.repeat(5*1024*1024)})+row('response_item',{type:'message',role:'assistant',content:[{text:'尾部正文'}]})+row('event_msg',{type:'token_count',info:info()});
  await fs.writeFile(file,zstdCompressSync(Buffer.from(text)));
  const first=await compressedRolloutTail(file),second=await compressedRolloutTail(file);assert.strictEqual(first,second);assert(first.buffer.length<=4*1024*1024);assert.equal(first.startLine,2);assert.equal(first.totalLines,4);assert(first.buffer.toString().includes('尾部正文'));
  assert.equal(tokenCounts((await readTokenSnapshot(file)).info).context,30920);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('live usage snapshot updates without summing; completion order retains post-compaction count',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-live-usage-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const codex=new EventEmitter();codex.request=async()=>({rateLimits:{}});let updates=0;const reader=new UsageReader(codex,()=>updates++);
 try{
  const update={method:'thread/tokenUsage/updated',params:{threadId:'not-a-disk-thread',tokenUsage:{total:{inputTokens:100,outputTokens:20,totalTokens:120},last:{inputTokens:0,outputTokens:0,totalTokens:30},modelContextWindow:380000}}};
  codex.emit('notification',update);codex.emit('notification',update);codex.emit('notification',{method:'item/completed',params:{threadId:'not-a-disk-thread',item:{type:'contextCompaction',id:'c'}}});
  const result=await reader.read('not-a-disk-thread');assert.equal(result.tokens.total,120);assert.equal(result.tokens.context,30);assert.equal(result.tokens.last,null);assert.equal(updates,2);
 }finally{reader.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}assert.equal(codex.listenerCount('notification'),0);
});
test('delayed compaction completion selects the current disk estimate but rejects it for the next compaction',async(t)=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-usage-order-'));
 const previousCodex=process.env.CODEX_HOME,previousMobile=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=path.join(home,'mobile');
 const at=Date.parse('2026-10-05T00:00:00Z');t.mock.timers.enable({apis:['Date'],now:at});
 const codex=new EventEmitter();codex.request=async()=>({rateLimits:{}});const reader=new UsageReader(codex);
 const id='compaction-order',notify=(method,itemId)=>codex.emit('notification',{method,params:{threadId:id,item:{type:'contextCompaction',id:itemId}}});
 try{
  await fs.mkdir(path.join(home,'sessions'));
  const file=path.join(home,'sessions','rollout-'+id+'.jsonl');
  await fs.writeFile(file,row('session_meta',{id})+row('event_msg',{type:'token_count',info:info(288272)},new Date(at).toISOString()));
  t.mock.timers.setTime(at+1000);notify('item/started','first');
  await fs.appendFile(file,row('event_msg',{type:'token_count',info:info()},new Date(at+2000).toISOString()));
  t.mock.timers.setTime(at+3000);notify('item/completed','first');
  assert.equal((await reader.read(id)).tokens.context,30920);
  t.mock.timers.setTime(at+4000);notify('item/started','second');
  t.mock.timers.setTime(at+5000);notify('item/completed','second');
  const pending=await reader.read(id);assert.equal(pending.tokens.context,null);assert.equal(pending.tokens.contextState,'awaiting_usage');
  await fs.appendFile(file,row('event_msg',{type:'token_count',info:info(20000)},new Date(at+6000).toISOString()));
  const current=await reader.read(id);assert.equal(current.tokens.context,20000);assert.equal(current.tokens.total,1716876430);
 }finally{
  reader.close();t.mock.timers.reset();
  if(previousCodex===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousCodex;
  if(previousMobile===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousMobile;
  await fs.rm(home,{recursive:true,force:true});
 }
});
test('Web inactive conversation cache evicts by count and capacity while retaining active content',()=>{
 let active='a';const cache=new ThreadEventCache(()=>active,2,3000);cache.set('a',[{text:'x'.repeat(3000)}]);cache.set('b',[{text:'b'}]);cache.set('c',[{text:'c'}]);cache.get('b');cache.set('d',[{text:'d'}]);assert(cache.has('a'));assert(cache.has('b'));assert(!cache.has('c'));
 cache.set('huge',[{text:'x'.repeat(2000)}]);assert(!cache.has('huge'));assert(cache.has('a'));
 active='d';cache.prune();assert(!cache.has('a'));assert(cache.has('d'));
 let reads=0;const measured=new ThreadEventCache(()=>'active',2,3000);const weight=measured.weight.bind(measured);measured.weight=events=>{reads++;return weight(events)};
 measured.set('inactive',[{text:'history'}]);const before=reads;for(let i=0;i<100;i++)measured.set('active',[{text:'stream '+i}]);assert.equal(reads,before,'streaming should not rescan inactive histories');
 measured.clear();assert.equal(measured.size,0);assert.equal(measured.weights.size,0);
 active='big';const leaving=new ThreadEventCache(()=>active,2,3000);leaving.set('one',[{text:'one'}]);leaving.set('two',[{text:'two'}]);leaving.set('big',[{text:'x'.repeat(3000)}]);active='next';leaving.set('next',[{text:'next'}]);assert(!leaving.has('big'));assert(leaving.has('one'));assert(leaving.has('two'));
});
