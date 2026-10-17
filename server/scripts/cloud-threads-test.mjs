import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CloudThreads,cloudItemEvents} from '../dist/services/cloudThreads.js';
import {delegatedMessage,cloudSourceAvatar} from '../dist/services/messageSource.js';
import {assertControllableThread} from '../dist/services/cloudSnapshots.js';
import {permittedPublicRequest} from './public-routes.mjs';

let checks=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{checks++;console.log('ok - '+name)});
await check('mobile delivery metadata is hidden without losing the request or quoted examples',()=>{
  const envelope='<delivery_context>\nclient=android\ndelivery_channel=chatgpt\nmessage_id=Sentinel_example\n</delivery_context>\n';
  const read=text=>cloudItemEvents('cloud:t','turn',{id:'u',type:'userMessage',content:[{type:'text',text}]},'');
  assert.equal(read(envelope+'继续迭代')[0].text,'继续迭代');
  assert.equal(read(envelope.replaceAll('\n','\r\n')+'保留正文')[0].text,'保留正文');
  assert.deepEqual(read(envelope),[]);
  assert.equal(read('请解释这个示例：\n'+envelope)[0].text,('请解释这个示例：\n'+envelope).trim());
  assert.equal(read('<delivery_context>普通 XML</delivery_context>')[0].text,'<delivery_context>普通 XML</delivery_context>');
});
await check('cached cloud list does not block local rows on cloud RPC',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const cloud=new CloudThreads(async()=>pending);
  let timer;
  try{
    const rows=await Promise.race([cloud.cachedList(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cloud blocked the sidebar')),1000);})]);
    assert.deepEqual(rows,[]);
    release({data:[{id:'ready',name:'Ready',createdAt:1,updatedAt:2}],nextCursor:null});
    await cloud.list();
    assert.equal((await cloud.cachedList())[0].id,'cloud:ready');
  }finally{clearTimeout(timer);release({data:[],nextCursor:null});cloud.close();}
});
await check('delegation preserves decoded text and provenance',()=>{
  const result=delegatedMessage('<codex_delegation><source_thread_id>source-1</source_thread_id><input>文件 &lt;15MB &amp; 不重复</input></codex_delegation>');
  assert.equal(result.text,'文件 <15MB & 不重复');assert.equal(result.messageSource.threadId,'source-1');
  assert.equal(delegatedMessage('a <codex_delegation>fake</codex_delegation>'),undefined);
});
await check('received cloud delegation is a user message, never a tool-output bubble',()=>{
  const events=cloudItemEvents('cloud:t','turn',{id:'message',type:'functionCallOutput',name:'send_message',output:'<codex_delegation><source_thread_id>s</source_thread_id><input>完成交付</input></codex_delegation>'},'2026-10-02T00:00:00Z');
  assert.equal(events[0].type,'user.message');assert.equal(events[0].text,'完成交付');assert.equal(events[0].messageSource.threadId,'s');
});
await check('cloud text excludes internal instructions and hidden analysis',()=>{
  assert.deepEqual(cloudItemEvents('cloud:t','turn',{id:'m',type:'agentMessage',text:'hidden',phase:'analysis'},''),[]);
  assert.deepEqual(cloudItemEvents('cloud:t','turn',{id:'u',type:'userMessage',content:[{type:'text',text:'# AGENTS.md instructions\nsecret'}]},''),[]);
  assert.equal(cloudItemEvents('cloud:t','turn',{id:'u',type:'userMessage',content:[{type:'text',text:'可见请求'}]},'')[0].text,'可见请求');
});
await check('list paginates cloud host, history stays chronological and remains read only',async()=>{
  const calls=[];
  const row={id:'t',name:'云端测试',createdAt:1,updatedAt:2,status:{type:'active'},environments:[{cwd:'X:/project'}]};
  const cloud=new CloudThreads(async(method,p)=>{
    calls.push([method,p]);
    if(method==='thread/list')return p.cursor?{data:[{...row,id:'other'}],nextCursor:null}:{data:[row],nextCursor:'next'};
    if(method==='thread/read')return {thread:row};
    if(method==='thread/turns/list')return {data:[{id:'new',startedAt:4,status:'completed',items:[{id:'a',type:'agentMessage',text:'新'}]},{id:'old',startedAt:3,status:'completed',items:[{id:'b',type:'agentMessage',text:'旧'}]}],nextCursor:'older'};
    throw Error('unexpected RPC');
  });
  const rows=await cloud.list();assert.equal(rows.length,2);assert.equal(rows[0].source,'cloudCodex');assert.equal(rows[0].id,'cloud:t');assert.equal(rows[0].readOnly,true);assert.equal(rows[0].status,'running');
  const page=await cloud.read('cloud:t',2);assert.deepEqual(page.events.filter(e=>e.type==='message.delta').map(e=>e.text),['旧','新']);assert.equal(page.hasMore,true);
  const n=calls.length;await cloud.read('cloud:t',2);assert.equal(calls.length,n);
});
await check('cloud control cannot fall through to local writes',()=>{
  assert.throws(()=>assertControllableThread('cloud:t'));assert.doesNotThrow(()=>assertControllableThread('local-t'));
  assert(permittedPublicRequest('GET','/api/cloud/avatar/thread-1'));
  assert(!permittedPublicRequest('POST','/api/cloud/avatar/thread-1'));
  assert(!permittedPublicRequest('GET','/api/cloud/avatar/thread-1/anything'));
});
await check('hidden cloud turns do not crowd out history or lose pagination and active status',async()=>{
  const cloud=new CloudThreads(async(method,p)=>{
    if(method==='thread/read')return {thread:{id:'t',createdAt:1,status:'active'}};
    if(method==='thread/turns/list')return p.cursor?{data:[
      {id:'answer-new',startedAt:4,status:'completed',items:[{id:'a',type:'agentMessage',text:'较新正文'}]},
      {id:'answer-old',startedAt:3,status:'completed',items:[{id:'b',type:'agentMessage',text:'较早正文'}]},
      {id:'answer-first',startedAt:2,status:'completed',items:[{id:'c',type:'agentMessage',text:'最早正文'}]},
    ],nextCursor:null}:{data:[
      {id:'active',startedAt:6,status:'inProgress',items:[]},
      {id:'hidden',startedAt:5,status:'completed',items:[{id:'internal',type:'userMessage',content:[{type:'text',text:'<codex_internal_context>continue</codex_internal_context>'}]},{id:'blank',type:'agentMessage',text:'  \n'}]},
    ],nextCursor:'older'};
    throw Error('unexpected RPC');
  });
  const page=await cloud.read('cloud:t',2);
  assert.deepEqual(page.events.filter(e=>e.type==='message.delta').map(e=>e.text),['较早正文','较新正文']);
  assert.equal(page.hasMore,true);assert.equal(page.status,'running');
  assert.equal(page.events.at(-1).type,'turn.started');assert.equal(page.events.at(-1).turnId,'active');
  const older=await cloud.read('cloud:t',3);
  assert.equal(older.hasMore,false);
  assert.deepEqual(older.events.filter(e=>e.type==='message.delta').map(e=>e.text),['最早正文','较早正文','较新正文']);
});
await check('running cloud command is not presented as completed',()=>{
  const events=cloudItemEvents('cloud:t','turn',{id:'command',type:'commandExecution',command:'build',status:'inProgress'},'');
  assert.equal(events.length,1);assert.equal(events[0].type,'tool.started');
});
await check('verified avatar survives signed URL expiry without crossing account boundaries',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-cloud-avatar-'));
  const savedHome=process.env.CODEX_HOME,savedData=process.env.CODEX_MOBILE_CONTROL_HOME,originalFetch=globalThis.fetch;
  try{
    process.env.CODEX_HOME=directory;process.env.CODEX_MOBILE_CONTROL_HOME=directory;
    const body=Buffer.from('verified avatar fixture'),digest=createHash('sha256').update(body).digest('hex');
    await fs.mkdir(path.join(directory,'cloud-avatars'));
    await fs.writeFile(path.join(directory,'auth.json'),JSON.stringify({tokens:{account_id:'account-a'}}));
    await fs.writeFile(path.join(directory,'.codex-global-state.json'),JSON.stringify({'electron-persisted-atom-state':{'cloud-aeon-sidebar-cache-v1':{accountId:'account-a',profilesByThreadId:{sender:{id:'profile-fixture',avatar_url:'https://expired.oaiusercontent.com/avatar.png',avatar_manifest:{snapshot:{content_sha256:digest}}}}}}}));
    await fs.writeFile(path.join(directory,'cloud-avatars',digest+'.json'),JSON.stringify({type:'image/png',body:body.toString('base64')}));
    globalThis.fetch=()=>{throw Error('Expired signed URL must not be fetched')};
    assert.deepEqual((await cloudSourceAvatar('sender')).body,body);
    await fs.writeFile(path.join(directory,'auth.json'),JSON.stringify({tokens:{account_id:'account-b'}}));
    await assert.rejects(()=>cloudSourceAvatar('sender'));
  }finally{
    if(savedHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=savedHome;
    if(savedData===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=savedData;
    globalThis.fetch=originalFetch;
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'cmc-cloud-avatar-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
console.log(`Cloud checks passed: ${checks}/${checks}`);
