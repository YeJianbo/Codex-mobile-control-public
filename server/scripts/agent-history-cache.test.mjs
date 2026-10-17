import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('external history polls read only additions, preserve snapshots and recover from failed commits',{timeout:15000},async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'agent-cache-'));
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  const store=new StateStore();let payloadRows=0;
  try{
    await store.load();
    const prepare=store.db.prepare.bind(store.db);
    store.db.prepare=sql=>{
      const statement=prepare(sql);
      if(!/^SELECT (?:seq,\s*)?payload FROM agent_history WHERE thread_id\s*=/.test(sql))return statement;
      return new Proxy(statement,{get(target,key){
        if(key==='all')return (...args)=>{const rows=target.all(...args);payloadRows+=rows.length;return rows;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
    };
    const append=id=>store.appendEvent({type:'message.delta',threadId:'opencode-stream',eventId:`chunk-${id}`,text:`${id}|`});
    for(let i=0;i<1000;i++)await append(i);
    const original=store.eventsForThread('opencode-stream');
    for(let i=1000;i<1020;i++){await append(i);assert.equal(store.eventsForThread('opencode-stream').length,i+1);}
    assert.equal(payloadRows,1020,'polls should parse the initial window once, then only new rows');
    assert.equal(original.length,1000);
    await append(1019);assert.equal(store.eventsForThread('opencode-stream').length,1020);
    assert.equal(payloadRows,1020,'duplicate notifications do not invalidate a clean cache');
    store.db.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'isolated failure'); END");
    await assert.rejects(append('failed'),/isolated failure/);
    assert.equal(store.eventsForThread('opencode-stream').length,1020);
    store.db.exec('DROP TRIGGER reject_fixture');
    await append('committed');assert.equal(store.eventsForThread('opencode-stream').at(-1).eventId,'chunk-committed');
    for(const agent of ['antigravity','claude','grok','deepseek','hermes','opencode']){
      const threadId=`${agent}-isolated`;
      await store.appendEvent({type:'user.message',threadId,eventId:`${agent}-prompt`,text:agent});
      assert.deepEqual(store.eventsForThread(threadId).map(e=>e.text),[agent]);
    }
    store.close();await store.load();
    assert.equal(store.eventsForThread('opencode-stream').length,1021,'reopening creates a fresh cache on the new SQLite connection');
    assert.equal(store.eventsForThread('opencode-stream')[0].text,'0|');
  }finally{store.close();await rm(home,{recursive:true,force:true});}
});
