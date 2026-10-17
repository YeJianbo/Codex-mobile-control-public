import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CommandReceipts} from '../src/services/commandReceipts.ts';
import {MessageSubmissions} from '../src/services/messageSubmissions.ts';
import {CloudSnapshots} from '../src/services/cloudSnapshots.ts';
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-merged-receipts-'));
const ledger=(name)=>new CommandReceipts(path.join(home,name+'.json'));

test('mobile confirmation uses the same durable receipt and blocks unknown timeout retry',async()=>{
 const receipts=ledger('facade'),submissions=new MessageSubmissions();
 const command={type:'turn.start',requestId:'timeout',threadId:'t',text:'body',permission:'ask',files:[{id:'file',name:'x',mime:'text/plain',size:4}]};let calls=0;
 await assert.rejects(receipts.run(command,async()=>{calls++;throw Error('RPC timeout');},()=>{}));
 assert.equal((await submissions.persistentStatus('timeout',[],receipts,'t')).state,'uncertain');
 await assert.rejects(receipts.run({...command,permission:'full'},async()=>{calls++;},()=>{}),/不同内容/);
 await assert.rejects(receipts.run(command,async()=>{calls++;},()=>{}));assert.equal(calls,1);
 const restarted=new CommandReceipts(path.join(home,'facade.json'));
 assert.equal((await submissions.persistentStatus('timeout',[],restarted,'t')).state,'uncertain');
 const accepted={type:'user.message',threadId:'t',requestId:'timeout',eventId:'a',text:'body'};
 assert.equal((await submissions.persistentStatus('timeout',[accepted],restarted,'t')).state,'accepted');
});

test('accepted queued receipt replays clicks but only its internal consumer executes it',async()=>{
 const receipts=ledger('queue');let calls=0,replays=0;const cmd={type:'turn.start',threadId:'t',requestId:'queue',text:'body',model:'gpt-6-sol'};
 await assert.rejects(receipts.run(cmd,async()=>{throw Error('thread already has an active writer');},()=>{}));
 assert.equal((await receipts.get('queue')).retryAllowed,true);
 await receipts.markQueued('queue','t');
 await receipts.run(cmd,async()=>{calls++;},()=>{replays++;});assert.equal(calls,0);assert.equal(replays,1);
 await receipts.run({...cmd,projectPath:'fixture',effort:'high'},async()=>{calls++;},()=>{},true);
 assert.equal(calls,1);assert.equal((await receipts.get('queue')).queued,undefined);
 await receipts.run(cmd,async()=>{calls++;},()=>{replays++;});assert.equal(calls,1);
});

test('new thread partial success is uncertain; a known writer retry retains the created thread',async()=>{
 const receipts=ledger('partial'),cmd={type:'thread.start',requestId:'new',initialText:'body'};
 await assert.rejects(receipts.run(cmd,async()=>{await receipts.noteThread('new','created');throw Error('invalid input after creation');},()=>{}));
 assert.equal((await receipts.get('new')).state,'uncertain');
 const retry=ledger('known');await assert.rejects(retry.run(cmd,async()=>{await retry.noteThread('new','created');throw Error('active writer');},()=>{}));
 let seen;await retry.run(cmd,async()=>{seen=(await retry.get('new')).threadId;},()=>{});assert.equal(seen,'created');
});

test('cloud snapshots use ten user turns rather than message counts',async()=>{
 const store=new CloudSnapshots(path.join(home,'snapshot.json'));await store.import({schemaVersion:1,snapshots:[{externalId:'paged',title:'test',updatedAt:new Date().toISOString(),status:'unknown',messages:Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',text:String(i)}))}]});
 const page=await store.read('cloud-snapshot:paged',undefined,10);assert.equal(page.events.length,20);assert.equal(page.events[0].text,'4');assert.equal(page.hasMore,true);
});
