import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {watchZcodeSessions,zcodeNativeSessions,zcodeEvents} from '../src/services/zcodeNativeSessions.ts';
import {zcodeRecoveryInputPrefix,zcodeRecoveryPrompt} from '../src/services/zcodeRecovery.ts';
import {mergeZcodeThreadEvents} from '../src/services/mobileHistory.ts';
import {closeHistoryWorkers} from '../src/services/historyWorkers.ts';
import {SessionManager} from '../src/services/sessionManager.ts';

test('discarded attempts and automatic continuation remain one logical ZCode turn',()=>{
 const messages=[],parts=[];
 const add=(id,turn,role,finish,text,extra={})=>{
  const at=1000+messages.length;
  messages.push({id,time_created:at,time_updated:at,data:JSON.stringify({role,anchor:{turnId:turn},time:{created:at,...(finish?{completed:at+1}:{})},finish,...extra})});
  if(text)parts.push({id:id+':text',message_id:id,time_created:at,time_updated:at,data:JSON.stringify({type:'text',text})});
 };
 add('u','t1','user',null,'original');
 add('a1','t1','assistant','tool-calls','checking');
 parts.push({id:'tool-part',message_id:'a1',time_created:1001,time_updated:1002,data:JSON.stringify({type:'tool',callID:'call',tool:'Read',state:{status:'completed',input:{path:'a'},output:'read'}})});
 add('discarded','t1','assistant','start_plan_admission_retry_discarded',null);
 add('error','t1','assistant','failed_closed',null,{error:{message:'Start Plan is busy'}});
 add('r','t2','user',null,zcodeRecoveryPrompt,{anchor:{turnId:'t2',sourceCommandId:zcodeRecoveryInputPrefix+'fixture'},metadata:{inputIntent:{clientId:'legacy-session-send',text:zcodeRecoveryPrompt}}});
 add('a2','t2','assistant','stop','done');
 const events=zcodeEvents('thread',{id:'native',status:'completed',time_created:1000,time_updated:1010},messages,parts);
 assert.equal(events.filter(row=>row.type==='user.message').length,1);
 assert.equal(events.filter(row=>row.type==='turn.completed').length,1);
 assert(events.every(row=>row.turnId==='t1'));
 assert.equal(events.find(row=>row.type==='tool.started').itemId,'call');
 const terminal={type:'turn.completed',threadId:'thread',turnId:'t1',status:'error'};
 const live=[{type:'user.message',threadId:'thread',turnId:'gateway',text:'original',createdAt:new Date(1000).toISOString()},
  {type:'error',threadId:'thread',turnId:'gateway',willRetry:true,message:'retrying'}];
 assert(!mergeZcodeThreadEvents([events[0],events.find(row=>row.type==='user.message'),terminal],live,true).some(row=>row.type==='turn.completed'));
});

test('desktop changes refresh the original gateway thread without taking ownership or duplicating tools',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zcode-native-')),previous=process.env.ZCODE_STORAGE_DIR;
  process.env.ZCODE_STORAGE_DIR=root;fs.mkdirSync(path.join(root,'db'));
  const db=new DatabaseSync(path.join(root,'db','db.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,directory TEXT,title TEXT,task_type TEXT,time_created INTEGER,time_updated INTEGER,time_archived INTEGER,time_deleted INTEGER,last_outcome TEXT);
    CREATE TABLE session_target(session_id TEXT,status TEXT,active_run_last_seen_at INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,sequence INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,sequence INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT);`);
  db.exec('CREATE TABLE model_usage(session_id TEXT,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_read_input_tokens INTEGER)');
  const now=Date.now(),id='zcode-original',native='sess_desktop';
  db.prepare('INSERT INTO session VALUES(?,NULL,?,?,?,?,?,NULL,NULL,NULL)').run(native,'/project','桌面会话','interactive',now,now);
  db.prepare('INSERT INTO session VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL)').run('sess_child',native,'/project','子代理','subagent_child',now,now);
  db.prepare('INSERT INTO message VALUES(?,?,?,?,?,?)').run('child-user','sess_child',1,now,now,JSON.stringify({role:'user',agent:'general-purpose',time:{created:now}}));
  db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?,?)').run('child-prompt','child-user','sess_child',0,now,now,JSON.stringify({type:'text',text:'子任务'}));
  db.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?)').run('sess_child',80,20,5,50);
  const message=(key,role,sequence,extra={})=>db.prepare('INSERT INTO message VALUES(?,?,?,?,?,?)').run(key,native,sequence,now+sequence,now+sequence,JSON.stringify({role,time:{created:now+sequence},anchor:{turnId:'native-turn'},...extra}));
  const part=(key,parent,sequence,data)=>db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?,?)').run(key,parent,native,sequence,now+sequence,now+sequence,JSON.stringify(data));
  message('user','user',1,{modelSelection:{providerId:'account',modelId:'GLM-5.3',options:{reasoningLevel:'max'}}});part('prompt','user',0,{type:'text',text:'原始请求'});
  message('assistant','assistant',2,{providerId:'account',modelId:'GLM-5.3'});
  part('reply','assistant',0,{type:'text',text:'正在回答'});part('tool','assistant',1,{type:'tool',tool:'Read',state:{status:'running',input:{path:'a.txt'}}});
  message('hidden','user',3,{synthetic:true,semantics:{uiVisibility:'hidden'}});part('hidden-text','hidden',0,{type:'text',text:'不能展示的内部提示'});
  const meta=new Map([[id,{session:native}]]),events=[],threads=[{id,title:'旧标题',status:'idle'}],owned=new Set();
  const store={threads,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,value)=>meta.set(id,value),isThreadHidden:()=>false,async upsertThread(thread){Object.assign(threads.find(t=>t.id===thread.id)||{},thread);}};
  let close;
  t.after(async()=>{
    await close?.();db.close();
    if(previous===undefined)delete process.env.ZCODE_STORAGE_DIR;else process.env.ZCODE_STORAGE_DIR=previous;
    // Both history lanes may hold the fixture after child and parent reads.
    await closeHistoryWorkers();
    fs.rmSync(root,{recursive:true,force:true});
  });
  close=await watchZcodeSessions(store,{publish:event=>events.push(event)},id=>owned.has(id));
  const list=await zcodeNativeSessions.list();assert.equal(list.length,2);
  const parent=list.find(row=>row.thread.id===id),child=list.find(row=>row.sessionId==='sess_child');
  assert.equal(parent.thread.status,'running');
  assert.equal(child.thread.subagent.parentThreadId,id,'native parent IDs reuse the gateway alias');
  assert.equal(child.thread.subagent.role,'general-purpose');assert.equal(child.tokens.total,100);
  assert.equal((await zcodeNativeSessions.read(child.thread.id)).events.find(e=>e.type==='user.message').text,'子任务');
  const opened=[];
  await SessionManager.prototype.resumeThread.call({agents:{owns:()=>false,resume:()=>{throw Error('观察桌面会话不能请求执行器恢复');}},hub:{publish:event=>opened.push(event)}},id);
  assert.equal(opened[0].thread.id,id);
  let snapshot=await zcodeNativeSessions.read(id);
  assert.equal(snapshot.events.filter(e=>e.type==='user.message').length,1);
  assert.equal(snapshot.events.find(e=>e.type==='message.delta').text,'正在回答');
  assert.equal(snapshot.events.filter(e=>e.type==='tool.started').length,1);
  events.length=0;
  db.prepare('UPDATE part SET data=?,time_updated=? WHERE id=?').run(JSON.stringify({type:'text',text:'已经回答完毕'}),now+100,'reply');
  db.prepare('UPDATE part SET data=?,time_updated=? WHERE id=?').run(JSON.stringify({type:'tool',tool:'Read',state:{status:'completed',input:{path:'a.txt'},output:'读取完成'}}),now+100,'tool');
  db.prepare('UPDATE message SET data=?,time_updated=? WHERE id=?').run(JSON.stringify({role:'assistant',time:{created:now+2,completed:now+100},anchor:{turnId:'native-turn'},finish:'stop',providerId:'account',modelId:'GLM-5.3'}),now+100,'assistant');
  db.prepare("UPDATE session SET last_outcome='completed',time_updated=? WHERE id=?").run(now+100,native);
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.ok(events.some(e=>e.type==='thread.history.changed'&&e.threadId===id));
  assert.ok(events.some(e=>e.type==='turn.completed'&&e.threadId===id&&e.status==='completed'));
  snapshot=await zcodeNativeSessions.read(id);
  assert.equal(snapshot.thread.status,'completed');assert.equal(snapshot.events.find(e=>e.type==='message.delta').text,'已经回答完毕');
  const saved=[{type:'user.message',threadId:id,turnId:'gateway-turn',text:'原始请求',createdAt:new Date(now+1).toISOString(),images:[{id:'image'}]},
    {type:'turn.started',threadId:id,turnId:'gateway-turn',createdAt:new Date(now+1).toISOString()},
    {type:'message.delta',threadId:id,turnId:'gateway-turn',itemId:'gateway-turn:reply',text:'正在回答'},
    {type:'tool.started',threadId:id,itemId:'gateway-turn:call',title:'Read'}];
  const merged=mergeZcodeThreadEvents(snapshot.events,saved);
  assert.equal(merged.filter(e=>e.type==='user.message').length,1);
  assert.equal(merged.filter(e=>e.type==='tool.started').length,1);
  assert.equal(merged.filter(e=>e.type==='message.delta').length,1);
  assert.ok(merged.find(e=>e.type==='user.message').images?.length);
});
