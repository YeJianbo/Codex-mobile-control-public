import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FollowupQueue} from '../dist/services/followupQueue.js';

test('editing copy survives a lost response and restart without being sent',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-queue-draft-'));
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  let store=new StateStore();await store.load();
  let status='running';const sent=[];
  const sessions={canSteer:()=>false};
  const send=async message=>{sent.push(message.id);status='running';};
  let queue=new FollowupQueue(store,sessions,async()=>status,send);
  try{
    const original=queue.add({id:'lost-response',threadId:'t',text:'保留的原文',images:[{id:'image',name:'图片.png'}],files:[{id:'file',name:'文档.pdf',mime:'application/pdf',size:17}],model:'model',effort:'high',mode:'plan'});
    const taken=queue.takeForEditing(original.id,'t');
    assert.equal(taken.status,'editing');assert.deepEqual(queue.list('t'),[]);
    // No client acknowledgement: recreate the real SQLite-backed queue.
    queue.close();store.close();store=new StateStore();await store.load();
    queue=new FollowupQueue(store,sessions,async()=>status,send);
    assert.deepEqual(queue.takeForEditing(original.id,'t'),taken);
    assert.equal(queue.drafts('t')[0].text,original.text);
    assert.deepEqual(queue.drafts('t')[0].images,original.images);
    assert.deepEqual(queue.drafts('t')[0].files,original.files);
    queue.add({id:'next',threadId:'t',text:'后续消息',images:[],files:[]});status='completed';
    const deadline=Date.now()+6000;
    while(!sent.length){assert(Date.now()<deadline,'queue consumer timed out');await new Promise(resolve=>setTimeout(resolve,50));}
    assert.deepEqual(sent,['next'],'the editing copy must not run or obstruct a later queued message');
    queue.finishEditing(original.id,'t');queue.finishEditing(original.id,'t');
    assert.deepEqual(queue.drafts('t'),[]);assert(!store.readFollowups().some(row=>row.id===original.id));
    queue.close();queue.add({id:'write-failure',threadId:'t',text:'写入失败时仍留在队列',images:[],files:[]});
    const write=store.writeFollowup.bind(store);
    store.writeFollowup=(id,row)=>{if(row.status==='editing')throw new Error('disk unavailable');write(id,row);};
    assert.throws(()=>queue.takeForEditing('write-failure','t'),/disk unavailable/);
    assert.equal(queue.list('t')[0].status,'queued');
    assert.throws(()=>queue.finishEditing('write-failure','t'),/尚未取回/);
    assert.equal(store.readFollowups().find(row=>row.id==='write-failure').status,'queued');
  }finally{
    queue.close();store.close();assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
  }
});
