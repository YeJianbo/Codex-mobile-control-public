import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {CloudSnapshots,assertControllableThread} from '../src/services/cloudSnapshots.ts';
import {CommandReceipts} from '../src/services/commandReceipts.ts';
import {SessionManager} from '../src/services/sessionManager.ts';
import {randomUUID} from 'node:crypto';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-remote-unit-'));
process.env.CODEX_MOBILE_CONTROL_HOME=home;
process.env.CODEX_HOME=path.join(home,'codex');
await fs.mkdir(process.env.CODEX_HOME);
const opened=[],managers=[];
function openLedger(file){const value=new CommandReceipts(file);opened.push(value);return value;}
after(async()=>{for(const manager of managers){manager.closeCapacityRetries();manager.receipts.close();}for(const value of opened)value.close();await fs.rm(home,{recursive:true,force:true});});
const fixture=(externalId='sample',updatedAt=new Date(Date.now()-600000).toISOString())=>({externalId,title:'任务摘要',updatedAt,status:'running',messages:[{role:'user',text:'用户请求'},{role:'assistant',text:'可见进展'}]});
const input=(rows)=>({schemaVersion:1,snapshots:rows});

test('snapshots persist source, fixed capture time, stale marker and distinct message IDs',async()=>{
 const file=path.join(home,'snapshots-1.json');const store=new CloudSnapshots(file);const row=fixture();await store.import(input([row]));
 const threads=await new CloudSnapshots(file).list();assert.equal(threads[0].source,'cloudSnapshot');assert.equal(threads[0].readOnly,true);assert.equal(threads[0].snapshotStale,true);assert.equal(threads[0].status,'idle');assert.equal(threads[0].snapshotStatus,'running');assert.equal(threads[0].updatedAt,row.updatedAt);
 const read=await store.read(threads[0].id);assert.deepEqual(read.events.map(e=>e.type),['user.message','message.delta']);assert.equal(new Set(read.events.map(e=>e.eventId)).size,2);assert.throws(()=>assertControllableThread(threads[0].id),/仅供查看/);assert.doesNotThrow(()=>assertControllableThread(row.externalId));
});
test('snapshots reject internal roles, raw unknown fields, credentials and future timestamps',async()=>{
 const store=new CloudSnapshots(path.join(home,'snapshots-2.json'));
 for(const bad of [{...fixture(),messages:[{role:'system',text:'internal'}]},{...fixture(),rawTools:{}},{...fixture(),messages:[{role:'assistant',text:'sk-'+ 'a'.repeat(40)}]},{...fixture(),updatedAt:new Date(Date.now()+3600000).toISOString()}])await assert.rejects(store.import(input([bad])));
 assert.deepEqual(await store.list(),[]);
});
test('snapshot import deduplicates IDs across batches, rejects duplicates/older versions atomically and paginates',async()=>{
 const store=new CloudSnapshots(path.join(home,'snapshots-3.json'));let row=fixture('same');await store.import(input([row]));
 await assert.rejects(store.import(input([row,row])),/重复/);
 await assert.rejects(store.import(input([fixture('new'),fixture('same',new Date(Date.now()-3600000).toISOString())])),/更旧/);assert.equal((await store.list()).length,1);
 row={...row,updatedAt:new Date().toISOString(),messages:Array.from({length:35},(_,i)=>({role:i%2?'assistant':'user',text:`message ${i}`}))};await store.import(input([row]));assert.equal((await store.list()).length,1);const page=await store.read('cloud-snapshot:same',20);assert.equal(page.events.length,20);assert.equal(page.hasMore,true);assert.equal(page.events[0].text,'message 15');
});
test('stored snapshots may span several valid import batches',async()=>{
 const file=path.join(home,'snapshots-many.json');const store=new CloudSnapshots(file);
 await store.import(input(Array.from({length:50},(_,i)=>fixture('a'+i))));await store.import(input([fixture('b')]));assert.equal((await new CloudSnapshots(file).list()).length,51);
});
test('curated summaries are explicitly distinguished from message exports',async()=>{
 const store=new CloudSnapshots(path.join(home,'snapshot-kind.json'));
 await store.import(input([fixture('summary'),{...fixture('export'),contentKind:'messages'}]));
 const rows=await store.list();assert.equal(rows.find(r=>r.id.endsWith(':summary')).snapshotContentKind,'summary');assert.equal(rows.find(r=>r.id.endsWith(':export')).snapshotContentKind,'messages');
 await assert.rejects(store.import(input([{...fixture(),messages:[{role:'assistant',text:'<developer>private instructions</developer>'}]}])));
});
test('explicit writer rejection allows a retry while coalescing new parallel retries',async()=>{
 const receipts=openLedger(path.join(home,'receipts-retry.json'));let calls=0;
 const command={type:'turn.start',requestId:'retry-known',threadId:'local'};
 await assert.rejects(receipts.run(command,async()=>{calls++;throw new Error('thread already has an active writer');},()=>{}));
 assert.equal((await receipts.get(command.requestId)).state,'failed');
 const work=async()=>{calls++;await new Promise(r=>setTimeout(r,10));};
 await Promise.all([receipts.run(command,work,()=>{}),receipts.run(command,work,()=>{})]);assert.equal(calls,2);
});
test('same request ID coalesces parallel calls and survives restart without executing twice',async()=>{
 const file=path.join(home,'receipts-1.json');const receipts=openLedger(file);let calls=0;let release;const deferred=new Promise(r=>release=r);const command={type:'thread.start',requestId:'same',initialText:'task',images:[{id:'image-a',name:'a'}]};
 const work=async()=>{calls++;await receipts.noteThread('same','local-id');await deferred;};
 const first=receipts.run(command,work,()=>{});await new Promise(r=>setTimeout(r,10));const second=receipts.run({...command},work,()=>{});release();await Promise.all([first,second]);assert.equal(calls,1);
 await openLedger(file).run(command,async()=>{calls++;},()=>{});assert.equal(calls,1);assert.equal((await receipts.get('same')).threadId,'local-id');assert.equal((await receipts.get('same')).fingerprint,undefined);
 await assert.rejects(receipts.run({...command,images:[{id:'image-b',name:'a'}]},work,()=>{}),/不同内容/);
});
test('timeouts and interrupted receipts cannot silently re-execute',async()=>{
 const file=path.join(home,'receipts-2.json');const receipts=openLedger(file);let calls=0;const cmd={type:'turn.start',requestId:'unknown',threadId:'t'};
 await assert.rejects(receipts.run(cmd,async()=>{calls++;throw new Error('RPC timeout');},()=>{}));assert.equal((await receipts.get('unknown')).state,'uncertain');
 await assert.rejects(openLedger(file).run(cmd,async()=>{calls++;},()=>{}));assert.equal(calls,1);
 const interrupted=path.join(home,'interrupted.json');await fs.writeFile(interrupted,JSON.stringify([{requestId:'unknown',fingerprint:'legacy',type:'turn.start',state:'starting',updatedAt:new Date().toISOString()}]));const recovered=openLedger(interrupted);assert.equal((await recovered.get('unknown')).state,'uncertain');recovered.close();
});
function sessionFixture(){
 const codex=new EventEmitter(),calls=[],threads=[],events=[];let count=0;
 codex.request=async(method,p)=>{calls.push({method,p});if(method==='thread/start')return {thread:{id:'local-'+(++count)}};if(method==='thread/resume')return {thread:{id:p.threadId,turns:[]}};if(method==='model/list')return {data:['gpt-6-sol','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,supportedReasoningEfforts:['medium','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium'}))};if(method==='turn/start'){await new Promise(r=>setTimeout(r,10));return {turn:{id:'turn-1'}};}return {};};
 const store={threads,approvals:[],readAgentMeta(){},async upsertThread(row){let previous=threads.find(t=>t.id===row.id);if(previous)Object.assign(previous,row);else threads.push(previous={...row});return previous;}};
 const manager=new SessionManager(codex,{publish:e=>events.push(e)},store);managers.push(manager);return {manager,codex,calls,threads,events};
}

test('Codex start and steer preserve more than eight uploaded images as local inputs',async()=>{
 const directory=path.join(home,'uploads');await fs.mkdir(directory,{recursive:true});
 const bytes=Buffer.from('89504e470d0a1a0a','hex');
 const images=Array.from({length:9},(_,i)=>({id:randomUUID()+'.png',name:'image-'+i+'.png'}));
 try{
  for(const image of images)await fs.writeFile(path.join(directory,image.id),bytes);
  const f=sessionFixture();
  await f.manager.handleClientCommand({type:'thread.start',requestId:'nine-images',initialText:'九张图片',images});
  await f.manager.steer('local-1','继续检查',images,[],'image-turn');
  for(const method of ['turn/start','turn/steer']){
   const input=f.calls.find(call=>call.method===method).p.input;
   assert.deepEqual(input.filter(item=>item.type==='localImage'),images.map(image=>({type:'localImage',path:path.join(directory,image.id)})));
   assert.equal(input.some(item=>'url' in item),false);
   for(const item of input.filter(item=>item.type==='localImage'))assert.deepEqual(await fs.readFile(item.path),bytes);
  }
 }finally{for(const image of images)await fs.rm(path.join(directory,image.id),{force:true});}
});

test('completion arriving before start response must not hold subsequent queued messages',async()=>{
 const f=sessionFixture(),request=f.codex.request;
 f.codex.request=async(method,p)=>{
   const result=await request(method,p);
   if(method==='turn/start'){
     f.codex.emit('notification',{method:'turn/started',params:{threadId:p.threadId,turn:{id:result.turn.id}}});
     f.codex.emit('notification',{method:'turn/completed',params:{threadId:p.threadId,turn:{id:result.turn.id,status:'completed'}}});
   }
   return result;
 };
 await f.manager.handleClientCommand({type:'turn.start',threadId:'early-completion',text:'first',model:'gpt-6.1-sol'});
 assert.equal(f.manager.canSteer('early-completion'),false);
 assert.equal(f.manager.ownsThread('early-completion'),false);
 assert.equal(f.events.findLast(event=>event.type==='user.message').status,'completed');
 await f.manager.handleClientCommand({type:'turn.start',threadId:'early-completion',text:'second',model:'gpt-6.1-sol'});
 assert.equal(f.calls.filter(c=>c.method==='turn/start').length,2);
});

test('a late completion from an old turn cannot clear the next active turn',async()=>{
 const f=sessionFixture();
 f.codex.emit('notification',{method:'turn/started',params:{threadId:'late',turn:{id:'new'}}});
 f.codex.emit('notification',{method:'turn/completed',params:{threadId:'late',turn:{id:'old',status:'completed'}}});
 assert.equal(f.manager.canSteer('late'),true);
 assert.equal(f.threads.find(t=>t.id==='late').status,'running');
 f.codex.emit('notification',{method:'turn/completed',params:{threadId:'late',turn:{id:'new',status:'completed'}}});
 assert.equal(f.manager.canSteer('late'),false);
});
test('local Codex defaults, one creation for repeated clicks, receipt replay and read-only boundaries',async()=>{
 const f=sessionFixture();const cmd={type:'thread.start',requestId:'local-default',model:'gpt-6.1-sol',initialText:'task'};await Promise.all([f.manager.handleClientCommand({...cmd}),f.manager.handleClientCommand({...cmd})]);
 assert.equal(f.calls.filter(c=>c.method==='thread/start').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.calls.find(c=>c.method==='turn/start').p.model,'gpt-6.1-sol');assert.equal(f.calls.find(c=>c.method==='turn/start').p.effort,'high');assert.equal(f.threads[0].source,'localCodex');
 await f.manager.handleClientCommand({...cmd});assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 await assert.rejects(f.manager.handleClientCommand({type:'turn.start',threadId:'cloud-snapshot:sample',text:'cannot send'}),/仅供查看/);
 await assert.rejects(f.manager.resumeThread('cloud-snapshot:sample'),/仅供查看/);
 const astra=sessionFixture();await astra.manager.handleClientCommand({type:'thread.start',requestId:'astra-default',model:'gpt-6-astra',initialText:'task'});assert.equal(astra.calls.find(c=>c.method==='turn/start').p.effort,'medium');
});
test('different concurrent sends to one local thread cannot start two turns',async()=>{
 const f=sessionFixture();await f.manager.resumeThread('concurrent');const results=await Promise.allSettled(['a','b'].map(requestId=>f.manager.handleClientCommand({type:'turn.start',requestId:'concurrent-'+requestId,threadId:'concurrent',text:requestId,model:'gpt-6.1-sol'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
});

test('a desktop thread notification does not replace this client resuming the thread',async()=>{
 const f=sessionFixture();f.codex.emit('notification',{method:'thread/started',params:{thread:{id:'desktop',status:{type:'idle'}}}});
 await f.manager.handleClientCommand({type:'turn.start',threadId:'desktop',text:'continue'});
 assert.equal(f.calls.filter(call=>call.method==='thread/resume').length,1);
});

test('explicit missing-thread rejection resumes once with the same turn input',async()=>{
 const f=sessionFixture(),request=f.codex.request;let attempt=0;
 f.codex.request=async(method,p)=>{if(method==='turn/start'&&++attempt===1){f.calls.push({method,p});throw Error('thread not found: stale connection');}return request(method,p)};
 await f.manager.handleClientCommand({type:'turn.start',threadId:'lost',text:'continue',mode:'plan',fast:true});
 assert.equal(f.calls.filter(call=>call.method==='thread/resume').length,2);
 const starts=f.calls.filter(call=>call.method==='turn/start');assert.equal(starts.length,2);assert.deepEqual(starts[0].p,starts[1].p);
 assert.equal(f.events.filter(e=>e.type==='user.message').length,1);assert.equal(f.events.some(e=>e.type==='error'),false);
});

test('explicit Fast choice survives turn completion instead of reverting to the old thread tier',async()=>{
 for(const status of ['completed','interrupted']){
  const f=sessionFixture(),request=f.codex.request;let tier='fast';
  f.codex.request=async(method,p)=>{
   if(method==='turn/start'&&p.serviceTier!==undefined)tier=p.serviceTier;
   return request(method,p);
  };
  await f.manager.handleClientCommand({type:'turn.start',threadId:'fast-'+status,text:'fixture',fast:false});
  f.codex.emit('notification',{method:'turn/completed',params:{threadId:'fast-'+status,turn:{id:'turn-1',status}}});
  assert.equal(tier,'default');
  await f.manager.handleClientCommand({type:'turn.start',threadId:'fast-'+status,text:'next fixture'});
  assert.equal(tier,'default');
  const starts=f.calls.filter(call=>call.method==='turn/start');
  assert.equal(Object.hasOwn(starts[0].p,'serviceTierForTurn'),false);
  assert.equal(Object.hasOwn(starts[1].p,'serviceTier'),false);
 }
});

test('timeout does not resume or replay an ambiguously accepted turn',async()=>{
 const f=sessionFixture(),request=f.codex.request;
 f.codex.request=async(method,p)=>{if(method==='turn/start'){f.calls.push({method,p});throw Error('RPC timeout');}return request(method,p)};
 await assert.rejects(f.manager.handleClientCommand({type:'turn.start',threadId:'uncertain',text:'continue'}),/timeout/);
 assert.equal(f.calls.filter(call=>call.method==='turn/start').length,1);
 assert.equal(f.calls.filter(call=>call.method==='thread/resume').length,1);
});


test('new socket task chooses Sol high without changing explicit Astra effort',async()=>{
 const f=sessionFixture();await f.manager.handleClientCommand({type:'thread.start',requestId:'socket-default',initialText:'new task'});
 const p=f.calls.find(c=>c.method==='turn/start').p;assert.equal(p.model,'gpt-6-sol');assert.equal(p.effort,'high');
 await assert.rejects(f.manager.handleClientCommand({type:'thread.start',requestId:'socket-default',initialText:'new task',model:'gpt-6-sol',effort:'high'}),/不同内容/);
 const explicit=sessionFixture();await explicit.manager.handleClientCommand({type:'thread.start',requestId:'astra-explicit',initialText:'new task',model:'gpt-6-astra',effort:'high'});
 assert.equal(explicit.calls.find(c=>c.method==='turn/start').p.effort,'high');
});
