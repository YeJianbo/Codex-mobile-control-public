import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexLiveHistory} from '../src/services/codexLiveHistory.ts';
import {EventEmitter} from 'node:events';
import {SessionManager} from '../src/services/sessionManager.ts';

test('streaming polls parse only committed additions and leave earlier snapshots unchanged',()=>{
  const db=new DatabaseSync(':memory:');let payloadRows=0;
  const measured=new Proxy(db,{get(target,key){
    if(key==='prepare')return sql=>{
      const statement=target.prepare(sql);
      if(!/^SELECT (?:seq,\s*)?payload FROM codex_live_events WHERE thread_id=/.test(sql))return statement;
      return new Proxy(statement,{get(stmt,property){
        if(property==='all')return (...args)=>{const rows=stmt.all(...args);payloadRows+=rows.length;return rows;};
        const value=Reflect.get(stmt,property,stmt);return typeof value==='function'?value.bind(stmt):value;
      }});
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const history=new CodexLiveHistory(measured);
  const append=(id)=>history.append({threadId:'stream',type:'message.delta',eventId:`chunk-${id}`,text:`${id}|`});
  try{
    for(let i=0;i<1000;i++)append(i);
    const original=history.read('stream');
    for(let i=1000;i<1020;i++){append(i);assert.equal(history.read('stream').length,i+1);}
    assert.equal(payloadRows,1020,'polls should read the initial window once, then only new rows');
    assert.equal(original.length,1000,'an earlier read remains a stable snapshot');
    append(1019);assert.equal(history.read('stream').length,1020,'duplicate events are ignored');
    assert.equal(payloadRows,1020);
    db.exec('BEGIN');append('rolled-back');db.exec('ROLLBACK');
    assert.equal(history.read('stream').length,1020,'rolled-back writes never enter the parsed cache');
    db.exec('BEGIN');append('transaction-read');
    assert.equal(history.read('stream').length,1021);
    db.exec('ROLLBACK');
    assert.equal(history.read('stream').length,1020,'reads inside a transaction cannot cache uncommitted data');
    append('committed');assert.equal(history.read('stream').at(-1).eventId,'chunk-committed');
    history.remove('stream');assert.deepEqual(history.read('stream'),[]);
    append('replacement');assert.deepEqual(history.read('stream').map(e=>e.eventId),['chunk-replacement']);
  }finally{db.close();}
});

test('real turn notifications preserve the reply across status and name refreshes',()=>{
  const db=new DatabaseSync(':memory:'),history=new CodexLiveHistory(db),codex=new EventEmitter();
  const threads=[{id:'t',status:'idle'}];let sequence=0;
  new SessionManager(codex,{publish:event=>history.append({eventId:`event-${++sequence}`,...event})},
    {threads,approvals:[],upsertThread:async value=>{Object.assign(threads[0],value);return threads[0]}});
  const notify=(method,params)=>codex.emit('notification',{method,params:{threadId:'t',...params}});
  try{
    notify('turn/started',{turn:{id:'turn-1'}});
    for(let i=0;i<8;i++){
      notify('item/agentMessage/delta',{itemId:'answer',delta:`paragraph-${i}|`});
      notify('thread/status/changed',{status:{type:'active'}});
      notify('thread/name/updated',{threadName:'Updated title'});
    }
    notify('turn/started',{turn:{id:'turn-1'}});
    notify('turn/completed',{turn:{id:'turn-1',status:'completed'}});
    notify('thread/status/changed',{status:{type:'idle'}});
    const events=history.read('t');
    assert.equal(events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),Array.from({length:8},(_,i)=>`paragraph-${i}|`).join(''));
    assert.equal(events.filter(e=>e.type==='turn.started').length,1);
    assert.equal(events.find(e=>e.type==='turn.started').turnId,'turn-1');
    assert.equal(db.prepare('SELECT active FROM codex_live_windows WHERE thread_id=?').get('t').active,0);
  }finally{db.close();}
});

test('Codex history keeps a whole long reply across other threads, saves and restart',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'codex-live-'));
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  const {mergeMobileThreadEvents}=await import('../dist/services/mobileHistory.js');
  const {selectConversationWindow,selectConversationPage,selectConversationTurns}=await import('../dist/services/codexSessions.js');
  let store=new StateStore();
  try{
    await store.load();
    const chunks=Array.from({length:1300},(_,i)=>`段${i}🙂|`);
    await store.appendEvent({type:'user.message',threadId:'t',eventId:'user',text:'graph做了什么？',createdAt:'2026-10-04T06:25:00Z'});
    await store.appendEvent({type:'thread.started',threadId:'t',eventId:'start',thread:{id:'t',status:'running'}});
    for(const [i,text] of chunks.entries())await store.appendEvent({type:'message.delta',threadId:'t',itemId:'answer',eventId:`delta-${i}`,text,createdAt:'2026-10-04T06:26:00Z'});
    for(let i=0;i<1500;i++)await store.appendEvent({type:'message.delta',threadId:'other',itemId:'other-answer',eventId:`other-${i}`,text:'x'});
    assert.equal(store.events.length,1000);
    assert.equal(store.eventsForThread('t').filter(e=>e.type==='message.delta').map(e=>e.text).join(''),chunks.join(''));
    await store.createPairing();store.close();store=new StateStore();await store.load();
    const events=store.eventsForThread('t');
    assert.equal(events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),chunks.join(''));
    for(const selected of [selectConversationWindow(events),selectConversationPage(events,200),selectConversationTurns(events,10)]){
      assert.equal(selected.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),chunks.join(''),'default, counted and turn-based API windows all retain whole replies');
    }
    const saved={type:'message.delta',threadId:'t',itemId:'answer',eventId:'history:full',text:chunks.join(''),createdAt:'2026-10-04T06:27:00Z'};
    assert.deepEqual(mergeMobileThreadEvents([saved],events).filter(e=>e.type==='message.delta'),[saved],'saved full response replaces deltas without duplicate text');
    const upload={type:'user.message',threadId:'attachments',eventId:'old-upload',text:'保留附件',images:[{id:'picture.png',name:'图'}],files:[{id:'video.mp4',name:'视频',mime:'video/mp4',size:10}]};
    await store.appendEvent(upload);
    await store.appendEvent({type:'tool.completed',threadId:'attachments',eventId:'old-operation',itemId:'operation',title:'先前操作',detail:'original output'});
    for(let i=0;i<4;i++)await store.appendEvent({type:'user.message',threadId:'attachments',eventId:`followup-${i}`,text:`followup ${i}`});
    assert.deepEqual(store.eventsForThread('attachments').find(e=>e.eventId==='old-upload'),upload,'a short disk window must not lose still-retained upload metadata');
    assert.equal(store.eventsForThread('attachments').find(e=>e.eventId==='old-operation')?.detail,'original output','cached operation IDs remain readable');
  }finally{store.close();await rm(home,{recursive:true,force:true});}
});

test('live disk windows prune at turn boundaries and keep active threads outside the idle budget',()=>{
  const db=new DatabaseSync(':memory:'),history=new CodexLiveHistory(db);
  const put=(threadId,type,eventId,text='')=>history.append({threadId,type,eventId,text});
  try{
    put('active','thread.started','active-start');put('active','message.delta','active-head','前文');
    for(let i=0;i<75;i++){put(`idle-${i}`,'user.message',`u-${i}`);put(`idle-${i}`,'message.delta',`d-${i}`,'complete');put(`idle-${i}`,'turn.completed',`end-${i}`);}
    assert.equal(history.read('active').at(-1).text,'前文');assert.deepEqual(history.read('idle-0'),[]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM codex_live_windows WHERE active=0').get().n,64);
    for(let i=0;i<4;i++){put('t','user.message',`user-${i}`,`${i}`);put('t','thread.started',`start-${i}`);put('t','message.delta',`answer-${i}`,`answer${i}`);put('t','turn.completed',`end-t-${i}`);}
    assert.deepEqual(history.read('t').filter(e=>e.type==='user.message').map(e=>e.text),['2','3']);
    assert.equal(history.read('t').filter(e=>e.type==='message.delta').map(e=>e.text).join(''),'answer2answer3');
    put('t','message.delta','answer-3','duplicate notification');
    assert.equal(history.read('t').filter(e=>e.eventId==='answer-3').length,1);
  }finally{db.close();}
});

test('desktop-only turns without gateway user messages still have a complete two-turn window',()=>{
  const db=new DatabaseSync(':memory:'),history=new CodexLiveHistory(db);
  try{
    for(let turn=0;turn<4;turn++){
      history.append({threadId:'desktop',type:'turn.started',eventId:`start-${turn}`,turnId:`turn-${turn}`});
      for(let i=0;i<250;i++)history.append({threadId:'desktop',type:'message.delta',itemId:`item-${turn}`,eventId:`${turn}-${i}`,text:`${i},`});
      history.append({threadId:'desktop',type:'turn.completed',eventId:`end-${turn}`});
    }
    assert.equal(history.read('desktop').filter(e=>e.type==='message.delta').length,500);
    assert.equal(history.read('desktop')[0].eventId,'start-2');
  }finally{db.close();}
});

test('restart seeding cannot append previously pruned turn fragments after a newer answer',()=>{
  const db=new DatabaseSync(':memory:'),history=new CodexLiveHistory(db);
  try{
    const events=[];
    for(let i=0;i<3;i++){
      const user={type:'user.message',threadId:'t',eventId:`u${i}`,text:`question${i}`};
      const answer={type:'message.delta',threadId:'t',eventId:`a${i}`,text:`answer${i}`};
      events.push(user,answer);history.append(user);history.append(answer);
    }
    const before=history.read('t');history.seed(events);
    assert.deepEqual(history.read('t'),before);
  }finally{db.close();}
});

test('automatic goal turns do not keep every prior reply just because they share one initial prompt',()=>{
  const db=new DatabaseSync(':memory:'),history=new CodexLiveHistory(db);
  try{
    history.append({threadId:'goal',type:'user.message',eventId:'initial',text:'继续推进课题'});
    for(let i=0;i<8;i++){
      history.append({threadId:'goal',type:'turn.started',eventId:`s${i}`,turnId:`turn-${i}`});
      history.append({threadId:'goal',type:'message.delta',eventId:`a${i}`,itemId:`item${i}`,text:`answer${i}`});
      history.append({threadId:'goal',type:'turn.completed',eventId:`e${i}`});
    }
    assert.deepEqual(history.read('goal').filter(e=>e.type==='message.delta').map(e=>e.text),['answer6','answer7']);
    assert.equal(history.read('goal').length,6);
  }finally{db.close();}
});
