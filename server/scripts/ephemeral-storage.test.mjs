import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('ephemeral transcripts stay out of SQLite, retain long streaming answers, and ignore late closed-thread events',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-side-history-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  let store,db;
  try{
    const {StateStore}=await import('../src/services/stateStore.ts');store=new StateStore();await store.load();
    await store.upsertThread({id:'side',title:'侧聊',ephemeral:true});
    for(let index=0;index<2000;index++)await store.appendEvent({type:'message.delta',threadId:'side',turnId:'turn',itemId:'answer',eventId:`part-${index}`,text:`${index},`});
    const events=store.eventsForThread('side',1000);
    assert.equal(events.length,1);assert.equal(events[0].text,Array.from({length:2000},(_,i)=>`${i},`).join(''));
    assert.equal(events[0].textComplete,true);assert.equal(events[0].eventId,'history:side:part-1999');
    assert.equal(store.events.some(event=>event.threadId==='side'),false);
    store.dropEphemeral('side');
    await store.upsertThread({id:'side',status:'completed'});
    await store.appendEvent({type:'turn.completed',threadId:'side',status:'completed'});
    assert.equal(store.threads.some(thread=>thread.id==='side'),false);
    db=new DatabaseSync(path.join(home,'state.sqlite'),{readOnly:true});
    assert.equal(db.prepare('SELECT count(*) AS count FROM threads WHERE id=?').get('side').count,0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM events WHERE thread_id=?').get('side').count,0);
  }finally{
    db?.close();store?.close();
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
  }
});
