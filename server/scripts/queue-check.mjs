import assert from 'node:assert/strict';
import {FollowupQueue} from '../src/services/followupQueue.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-queue-'));
process.env.CODEX_MOBILE_CONTROL_HOME=home;
const {StateStore}=await import('../src/services/stateStore.ts');
let store=new StateStore();await store.load();
let status='running',sent=[],steered=[];
const sessions={canSteer:()=>true,steer:async(id,text,images,files,desktopTurnId)=>steered.push({text,desktopTurnId})};
const wait=async(fn)=>{const end=Date.now()+6000;while(!fn()){assert.ok(Date.now()<end,'queue timed out');await new Promise(r=>setTimeout(r,80))}};
const send=async e=>{sent.push(e.text);status='running'};
let queue=new FollowupQueue(store,sessions,async()=>status,send);
try{
 queue.add({id:'sort-a',threadId:'sort',text:'first',images:[]});queue.add({id:'sort-b',threadId:'sort',text:'second',images:[]});
 queue.move('sort-b','sort','up');assert.deepEqual(queue.list('sort').map(e=>e.id),['sort-b','sort-a']);
 queue.close();store.close();store=new StateStore();await store.load();queue=new FollowupQueue(store,sessions,async()=>status,send);
 assert.deepEqual(queue.list('sort').map(e=>e.id),['sort-b','sort-a']);queue.cancel('sort-a','sort');queue.cancel('sort-b','sort');
 queue.add({id:'a',threadId:'t',text:'old',images:[]});queue.add({id:'b',threadId:'t',text:'cancel',images:[]});queue.edit('a','t','edited');queue.cancel('b','t');
 await new Promise(r=>setTimeout(r,1650));assert.equal(sent.length,0);
 queue.close();store.close();store=new StateStore();await store.load();queue=new FollowupQueue(store,sessions,async()=>status,send);
 assert.equal(queue.list('t')[0].text,'edited');status='completed';await wait(()=>sent.length===1);assert.deepEqual(sent,['edited']);
 queue.add({id:'a',threadId:'t',text:'duplicate',images:[]});assert.equal(queue.list('t').length,0);
 queue.add({id:'c',threadId:'t',text:'steer',images:[]});await queue.steer('c','t','desktop-turn');assert.deepEqual(steered,[{text:'steer',desktopTurnId:'desktop-turn'}]);
 queue.add({id:'d',threadId:'t',text:'after error',images:[]});status='error';await wait(()=>queue.list('t')[0]?.status==='failed');assert.equal(sent.length,1);queue.retry('d','t');await wait(()=>sent.length===2);
 queue.close();store.writeFollowup('uncertain',{id:'uncertain',threadId:'t',text:'uncertain',images:[],status:'sending',createdAt:new Date().toISOString()});store.close();store=new StateStore();await store.load();queue=new FollowupQueue(store,sessions,async()=>status,async()=>assert.fail('uncertain request auto-replayed'));assert.equal(queue.list('t')[0].status,'failed');
 console.log('Queue persistence, edit, cancel, idempotency, steer, failure pause and interrupted-send recovery passed');
}finally{queue.close();store.close();assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true})}
