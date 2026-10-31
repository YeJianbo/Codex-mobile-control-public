import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CommandReceipts} from '../src/services/commandReceipts.ts';
import {EventHub} from '../src/services/eventHub.ts';
import {modelAgent} from '../src/services/agentProtocol.ts';
import {isWriterOccupied,submissionFailureKind,SubmissionFailure} from '../src/services/submissionErrors.ts';
import {modelHarness,modelDisplayName,compactModelName} from '../public/model-identity.js';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-structure-'));
const previousHome=process.env.CODEX_MOBILE_CONTROL_HOME;
process.env.CODEX_MOBILE_CONTROL_HOME=home;
const {loadServerConfig,updateServerConfig}=await import('../src/services/configStore.ts');
const opened=[];
const ledger=file=>{const value=new CommandReceipts(file);opened.push(value);return value;};
after(async()=>{
  for(const value of opened)value.close();
  if(previousHome===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousHome;
  await fs.rm(home,{recursive:true,force:true});
});

test('corrupt config is retained; concurrent updates merge; failed writes leave live settings intact',async()=>{
  const file=path.join(home,'server.json');
  await fs.writeFile(file,'{broken');await assert.rejects(loadServerConfig(),SyntaxError);
  assert.equal(await fs.readFile(file,'utf8'),'{broken');await fs.rm(file);
  const config=await loadServerConfig();
  await Promise.all([
    updateServerConfig(config,draft=>{draft.capacityAutoRetry=true;}),
    updateServerConfig(config,draft=>{draft.projectRoots.push('C:/fixture');}),
    updateServerConfig(config,draft=>{draft.publicAgents={claude:false};}),
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),config);
  assert.equal(config.capacityAutoRetry,true);assert.deepEqual(config.projectRoots,['C:/fixture']);assert.equal(config.publicAgents.claude,false);
  const before=structuredClone(config);
  await fs.rename(file,file+'.saved');await fs.mkdir(file);
  await assert.rejects(updateServerConfig(config,draft=>{draft.capacityAutoRetry=false;}));assert.deepEqual(config,before);
  await fs.rmdir(file);await fs.rename(file+'.saved',file);
});

test('cross-brand names are preserved and client relay routing agrees with the server',()=>{
  for(const id of ['relay::gpt-6.1-sol','claude::grok-4.6','opencode::openrouter/deepseek-v4.1'])assert.equal(modelHarness(id),modelAgent(id));
  assert.equal(modelDisplayName({model:'gpt-6.1-sol',displayName:'GPT-6.1-Sol'}),'6.1 Sol');
  assert.equal(modelDisplayName({model:'claude::grok-4.6',displayName:'Claude Code · grok-4.6'}),'Grok 4.6');
  assert.equal(modelDisplayName({model:'opencode::openrouter/deepseek-v4.1-flash',displayName:'OpenCode · openrouter/deepseek-v4.1-flash',providerId:'openrouter'}),'DeepSeek v4.1 Flash');
  assert.equal(compactModelName('claude-opus-4.8'),'Claude Opus 4.8');
  assert.equal(compactModelName('opus-4.8'),'Opus 4.8');
  assert.equal(compactModelName('team/route::custom · model'),'team/route::custom · model');
});

test('migration passes the old 10000 limit, keeps deduplication and supports rollback export',async()=>{
  const file=path.join(home,'legacy.json'),at=new Date().toISOString();
  const rows=Array.from({length:10001},(_,i)=>({requestId:'old-'+i,fingerprint:'fixture',type:'turn.start',state:i===0?'starting':'accepted',updatedAt:at}));
  await fs.writeFile(file,JSON.stringify(rows));const receipts=ledger(file);
  assert.equal((await receipts.get('old-0')).state,'uncertain');
  let calls=0;const command={type:'turn.start',threadId:'t',requestId:'new',text:'body'};
  await receipts.run(command,async()=>{calls++;},()=>{});await receipts.run(command,async()=>{calls++;},()=>{});assert.equal(calls,1);
  for(let i=0;i<700;i++)await receipts.get('old-'+i);
  assert(receipts.rows.size<=512);assert.equal((await receipts.get('old-10000')).state,'accepted');
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).length,10001);
  const exported=path.join(home,'rollback.json');await receipts.exportJson(exported);
  assert.equal(JSON.parse(await fs.readFile(exported,'utf8')).length,10002);
  receipts.close();const restarted=ledger(file);
  await restarted.run(command,async()=>{calls++;},()=>{});assert.equal(calls,1);
  restarted.close();
  const rollbackRows=JSON.parse(await fs.readFile(exported,'utf8'));
  rollbackRows.push({requestId:'written-by-old-gateway',fingerprint:'old',type:'turn.start',state:'accepted',updatedAt:new Date().toISOString()});
  await fs.writeFile(file,JSON.stringify(rollbackRows));
  assert.equal((await ledger(file).get('written-by-old-gateway')).state,'accepted');
});

test('writer classification survives text changes and unknown timeouts cannot run twice',async()=>{
  const receipts=ledger(path.join(home,'errors.json')),command={type:'turn.start',threadId:'t',requestId:'writer'};
  await assert.rejects(receipts.run(command,async()=>{throw new SubmissionFailure('writer_occupied','任意展示文案');},()=>{}),isWriterOccupied);
  assert.equal((await receipts.get('writer')).retryAllowed,true);
  await receipts.markQueued('writer','t');assert.equal((await receipts.get('writer')).state,'accepted');
  const unknown={...command,requestId:'unknown'};let calls=0;
  await assert.rejects(receipts.run(unknown,async()=>{calls++;throw Error('RPC timeout');},()=>{}));
  await assert.rejects(receipts.run(unknown,async()=>{calls++;},()=>{}));assert.equal(calls,1);
});

test('plain Error from agent host keeps queueable writer classification across the process boundary',async()=>{
  const receipts=ledger(path.join(home,'queued.json')),command={type:'turn.start',threadId:'t',requestId:'queued'};
  const plain=Error('任务仍在运行，请将消息加入队列');
  assert.equal(submissionFailureKind(plain),'writer_occupied');assert(isWriterOccupied(plain));
  await assert.rejects(receipts.run(command,async()=>{throw plain;},()=>{}),isWriterOccupied);
  assert.equal((await receipts.get('queued')).retryAllowed,true);
  await receipts.markQueued('queued','t');assert.equal((await receipts.get('queued')).state,'accepted');
});

test('history failure warns once without stopping the live stream and clears after recovery',async()=>{
  let fail=true;const events=[],hub=new EventHub({appendEvent:async()=>{if(fail)throw Error('isolated disk failure');},events:[]});
  const unsubscribe=hub.subscribe(event=>events.push(event)),log=console.error;console.error=()=>{};
  try{
    hub.publish({type:'message.delta',threadId:'t',text:'first'});hub.publish({type:'message.delta',threadId:'t',text:'second'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(events.filter(event=>event.type==='warning').length,1);assert.equal(events.filter(event=>event.type==='message.delta').length,2);
    assert.equal(hub.persistenceStatus().ok,false);
    fail=false;hub.publish({type:'message.delta',threadId:'t',text:'recovered'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(hub.persistenceStatus().ok,true);
  }finally{console.error=log;unsubscribe();clearInterval(hub.heartbeatTimer);}
});
