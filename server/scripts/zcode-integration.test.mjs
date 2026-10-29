import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {ZcodeConnection,zcodeRun,readZcodeCatalog} from '../src/services/zcodeClient.ts';
import {zcodeSessionTokens} from '../src/services/zcodeUsage.ts';
import {readZcodeUsage} from '../../components/local-console/src/zcode-usage.mjs';
import {ExternalUsage} from '../../components/local-console/src/external-usage.mjs';
import {requestRecord} from '../../components/local-console/src/request-records.mjs';
import {zcodeToolStream} from '../src/services/zcodeStream.ts';
import {zcodeRecoveryInputPrefix,zcodeRecoveryPrompt} from '../src/services/zcodeRecovery.ts';

function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zcode-native-'));
 const oldBase=process.env.ZCODE_DATA_BASE_DIR,oldConfig=process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,oldPersonal=process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
 const file=path.join(home,'provider.json');fs.writeFileSync(file,JSON.stringify({revision:1,config:{providerConfigRules:{providerRules:[]}}}));
 process.env.ZCODE_DATA_BASE_DIR=home;process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=file;process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=path.join(home,'personal.json');
 t.after(()=>{for(const [key,value] of [['ZCODE_DATA_BASE_DIR',oldBase],['ZCODE_BUILTIN_PROVIDER_CONFIG_FILE',oldConfig],['ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',oldPersonal]])if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(home,{recursive:true,force:true});});
 return home;
}
const usage={inputTokens:120,outputTokens:30,totalTokens:150,reasoningTokens:10,cacheReadTokens:90,cacheCreationTokens:0};
function processMock(onRequest,onResponse=()=>{}){
 let exit;const done=new Promise(resolve=>exit=resolve),stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
 let buffer='';const requests=[];
 const emit=value=>stdout.write(JSON.stringify(value)+'\n');
 stdin.on('data',data=>{buffer+=data;for(let index;(index=buffer.indexOf('\n'))>=0;){const value=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);requests.push(value);setImmediate(()=>value.method?onRequest(value,emit,exit):onResponse(value,emit,exit));}});
 return {stdin,stdout,stderr,then:done.then.bind(done),kill:()=>{stdout.end();stderr.end();exit({exitCode:0});},requests,emit,exit};
}

test('native model catalog reads image capability from the input-format object',async t=>{
 fixture(t);let child;
 const launch=()=>child=processMock(({id,method},emit)=>emit({id,result:method==='session/create'?{settings:{model:{available:[
  {ref:{providerId:'account',modelId:'GLM-5.3'},label:'GLM-5.3',contextWindow:1000000,properties:{inputFormat:{supportsText:true,supportsImage:true}}}
 ]}}}:{}}));
 const catalog=await readZcodeCatalog({command:process.execPath,args:['fixture.cjs'],source:'configured'},process.cwd(),launch);
 assert.equal(catalog.supportsImages,true);assert.equal(catalog.models.length,1);
 assert(child.requests.some(row=>row.method==='session/create'&&row.params.persistence==='deferred'));
 assert(child.requests.some(row=>row.method==='session/close'&&row.params.expectedPersistence==='deferred'));
});

test('ZCode streams a turn, handles approval and questions, and keeps persistent native history',async t=>{
 fixture(t);let child,permission=false,question=false;
 const launch=()=>child=processMock((request,emit)=>{
  const {id,method,params}=request;
  if(method==='session/send'){
   emit({id,result:{accepted:true}});
   emit({id:'permission',method:'interaction/requestPermission',params:{sessionId:params.sessionId,toolName:'Bash',input:{command:'fixture'}}});
   emit({id:'question',method:'interaction/requestUserInput',params:{sessionId:params.sessionId,questions:[{question:'选择',header:'测试',options:[{label:'A'}]}]}});
   emit({method:'session/event',params:{sessionId:params.sessionId,type:'model.streaming',payload:{kind:'text_delta',delta:'正文',partId:'answer'}}});
   emit({method:'session/event',params:{sessionId:params.sessionId,type:'turn.completed',payload:{response:'正文',resultType:'success'}}});
  }else emit({id,result:method==='session/usage'?usage:method==='session/read'?{projection:{contextUsed:42,contextWindow:200000}}:{}});
 });
 const run=zcodeRun({executable:{command:process.execPath,args:['fixture.cjs'],source:'configured'},cwd:process.cwd(),session:'sess_existing',model:'account%3Abigmodel-start-plan/GLM-5.3',prompt:'fixture',approve:async()=>{permission=true;return true;},ask:async()=>{question=true;return {'选择':'A'};}},launch);
 const output=[];run.stdout.on('data',data=>output.push(...data.toString().trim().split('\n').map(JSON.parse)));
 assert.equal((await run).exitCode,0);assert(permission&&question);
 assert(child.requests.some(r=>r.method==='session/resume'&&r.params.sessionId==='sess_existing'));
 assert(!child.requests.some(r=>r.method==='session/create'||r.method==='session/close'));
 const result=output.find(row=>row.type==='result');assert.equal(result.usage.context_used,42);assert.equal(result.usage.total_tokens,150);assert.equal(result.usage.cumulative,true);
 assert.equal(output.filter(row=>row.type==='assistant').map(row=>row.message.content[0].text).join(''),'正文');
 assert.equal(child.requests.find(row=>row.id==='permission').result.decision,'allow');
});

test('a desktop-created session can continue through its inherited subagent config callback',async t=>{
 fixture(t);let child;
 const sid='sess_desktop';
 const launch=()=>child=processMock(({id,method},emit)=>{
  emit({id,result:method==='session/usage'?usage:method==='session/read'?{projection:{contextUsed:42,contextWindow:1000000}}:{accepted:true}});
  if(method==='session/send')emit({id:'subagent-config',method:'subagents/readRuntimeConfig',params:{sessionId:sid}});
 },(response,emit)=>{
  if(response.id!=='subagent-config')return;
  assert.deepEqual(response.result,{kind:'built-in-fallback'});
  emit({method:'session/event',params:{sessionId:sid,type:'model.streaming',payload:{kind:'text_delta',delta:'继续执行',partId:'answer'}}});
  emit({method:'session/event',params:{sessionId:sid,type:'turn.completed',payload:{response:'继续执行',resultType:'success'}}});
 });
 const run=zcodeRun({executable:{command:process.execPath,args:['fixture.cjs'],source:'configured'},cwd:process.cwd(),session:sid,model:'account/GLM-5.3',prompt:'继续',approve:async()=>true,ask:async()=>null},launch);
 t.after(()=>run.kill());const output=[];run.stdout.on('data',data=>output.push(...data.toString().trim().split('\n').map(JSON.parse)));
 assert.equal((await run).exitCode,0);
 assert.equal(output.find(row=>row.type==='result').result,'继续执行');
 assert.equal(child.requests.filter(row=>row.method==='session/send').length,1);
 assert(!child.requests.some(row=>row.method==='session/create'||row.method==='session/stop'||row.method==='session/close'));
});

test('unsupported reverse requests use method-not-found and identify the method without its payload',async()=>{
 const child=processMock(()=>{}),client=new ZcodeConnection({command:'fixture',source:'configured'},process.cwd(),{},async()=>{throw Object.assign(Error('private request payload'),{code:-32601});},()=>child);
 try{
  child.emit({id:'unsupported',method:'optional/futureCapability',params:{private:'sensitive'}});
  await new Promise(resolve=>setImmediate(resolve));
  const response=child.requests.find(row=>row.id==='unsupported');
  assert.equal(response.error.code,-32601);
  assert(response.error.message.includes('optional/futureCapability'));
  assert(!JSON.stringify(response).includes('sensitive'));
  assert(!JSON.stringify(response).includes('private request payload'));
 }finally{client.close();}
});

test('ZCode process exit rejects pending RPC immediately',async()=>{
 const child=processMock(()=>{}),client=new ZcodeConnection({command:'fixture',source:'configured'},process.cwd(),{},async()=>{},()=>child);
 const pending=client.request('session/resume',{sessionId:'missing'});child.exit({exitCode:7});await assert.rejects(pending,/退出 \(7\)/);
});

test('ZCode guides the running session and retains a native fallback queue until its final turn',async t=>{
 fixture(t);let child,queued=false,markReady,markRead;
 const ready=new Promise(resolve=>markReady=resolve),read=new Promise(resolve=>markRead=resolve);
 const launch=()=>child=processMock(({id,method,params},emit)=>{
  if(method==='session/send'){emit({id,result:{accepted:true}});markReady();return;}
  if(method==='v4/command'){
   assert.equal(params.type,'sendText');assert.equal(params.sessionId,'sess_existing');
   assert.equal(params.payload.requestedDelivery,'guide');assert.equal(params.payload.text,'调整方向');
   queued=true;emit({id,result:{status:'accepted',result:{type:'inputAccepted',delivery:'queue',inputId:params.commandId}}});return;
  }
  emit({id,result:method==='session/usage'?usage:method==='session/read'?{projection:{pendingSteerInputs:queued?[{pendingInputId:'guide'}]:[]}}:{}});
  if(method==='session/read')markRead();
 });
 const run=zcodeRun({executable:{command:process.execPath,args:['fixture.cjs'],source:'configured'},cwd:process.cwd(),session:'sess_existing',model:'account%3Abigmodel-start-plan/GLM-5.3',prompt:'fixture',approve:async()=>true,ask:async()=>null},launch);
 const output=[];run.stdout.on('data',data=>output.push(...data.toString().trim().split('\n').map(JSON.parse)));
 t.after(()=>run.kill());await ready;
 assert.equal(await run.steer('调整方向'),'queue');
 child.emit({method:'session/event',params:{sessionId:'sess_existing',type:'turn.completed',payload:{response:'第一轮',resultType:'success'}}});
 await read;await new Promise(resolve=>setImmediate(resolve));
 assert(!output.some(row=>row.type==='result'));
 queued=false;
 child.emit({method:'session/event',params:{sessionId:'sess_existing',type:'turn.started',payload:{}}});
 child.emit({method:'session/event',params:{sessionId:'sess_existing',type:'turn.completed',payload:{response:'引导结果',resultType:'success'}}});
 assert.equal((await run).exitCode,0);
 assert.equal(output.find(row=>row.type==='result').result,'引导结果');
 assert.equal(child.requests.filter(row=>row.method==='session/send').length,1);
 await assert.rejects(run.steer('已结束'),/不可引导/);
});

test('ZCode snapshots replace cumulative totals and keep context separate',()=>{
 const first=zcodeSessionTokens({input_tokens:100,output_tokens:20,total_tokens:120,context_used:50,context_window:200000});
 const second=zcodeSessionTokens({input_tokens:140,output_tokens:30,total_tokens:170},first);
 assert.equal(second.total,170);assert.equal(second.input,140);assert.equal(second.last,50);assert.equal(second.context,50);assert.equal(second.contextWindow,200000);
 assert.equal(zcodeSessionTokens({input_tokens:140,output_tokens:30,total_tokens:170},second).total,170);
});

test('native request metering retains timing, failures and stable history across refresh and deletion',t=>{
 const home=fixture(t),folder=path.join(home,'.zcode','cli','db');fs.mkdirSync(folder,{recursive:true});
 const dbFile=path.join(folder,'db.sqlite'),db=new DatabaseSync(dbFile),now=Date.now();
 db.exec('CREATE TABLE model_usage(id TEXT,session_id TEXT,model_id TEXT,provider_id TEXT,status TEXT,started_at INTEGER,duration_ms INTEGER,time_to_first_token_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_read_input_tokens INTEGER,error_code TEXT)');
 const put=db.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 put.run('r1','s1','GLM-5.3','account:bigmodel-start-plan','completed',now,2000,400,100,20,5,80,'old_timeout');
 put.run('r2','s1','GLM-5.3','account:bigmodel-start-plan','error',now+1,500,null,0,0,0,0,'capacity');db.close();
 const raw=readZcodeUsage(home),row=requestRecord(raw.rows[0],{id:'r1',source:'zcode'});
 assert.equal(row.totalTokens,120);assert.equal(row.averageTPS,10);assert.equal(row.firstTextMs,null);assert.equal(row.firstOutputMs,400);assert.equal(row.provider,'account:bigmodel-start-plan');
 assert.equal(requestRecord(raw.rows[1],{source:'zcode'}).failed,true);
 assert.equal(row.failed,false);assert.equal(row.errorCode,null);
 const history=new ExternalUsage(home,{dir:path.join(home,'history'),refreshMs:0});
 const first=history.zcode('year'),second=history.zcode('year');assert.equal(first.totals.requests,2);assert.equal(second.totals.requests,2);assert.equal(second.totals.input,100);
 fs.unlinkSync(dbFile);assert.equal(history.zcode('year').totals.requests,2);
});

test('ZCode joins streamed tool inputs, omitted-input lifecycle events and structured results',()=>{
 const records=[],event=zcodeToolStream(record=>records.push(record));
 event('model.streaming',{kind:'tool_call',toolCallId:'call',toolName:'Bash',input:{command:'probe'}});
 event('tool.updated',{kind:'scheduled',toolCallId:'call',toolName:'Bash',inputOmitted:true});
 event('tool.updated',{kind:'started',toolCallId:'call'});
 event('tool.updated',{kind:'progress',toolCallId:'call',outputPreview:{text:'ready',fullText:'ready',totalLines:1,totalBytes:5,linesEstimated:false}});
 event('tool.updated',{kind:'result',toolCallId:'call',result:{success:true,content:[{type:'text',text:'ready\ndone'}]}});
 event('part.upserted',{part:{id:'part',type:'tool',callID:'call',tool:'Bash',state:{status:'completed',input:{command:'probe'},output:'ready\ndone'}}});
 assert.equal(records.filter(row=>row.type==='assistant').length,1);
 assert.deepEqual(records[0].message.content[0].input,{command:'probe'});
 assert.equal(records.filter(row=>row.type==='tool_output').map(row=>row.text).join(''),'ready\ndone');
 assert.equal(records.filter(row=>row.type==='user').length,1);
 event('tool.updated',{kind:'result',toolCallId:'failed',toolName:'Read',result:{success:false,error:{message:'not found'}}});
 assert.equal(records.at(-1).message.content[0].is_error,true);
});

test('ZCode busy recovery stays in the same session beyond eight attempts without rewinding',async t=>{
 fixture(t);let child,sends=0;
 const launch=()=>child=processMock(({id,method,params},emit)=>{
  emit({id,result:method==='session/usage'?usage:method==='session/read'?{projection:{}}:{accepted:true}});
  if(method!=='session/send')return;
  sends++;
  emit({method:'session/event',params:{sessionId:params.sessionId,type:'turn.started',payload:{}}});
  emit({method:'session/event',params:{sessionId:params.sessionId,type:sends<11?'turn.failed':'turn.completed',payload:sends<11?{error:{message:'Start Plan is busy and automatic model stream recovery reached the maximum retry count.'}}:{response:'done'}}});
 });
 const run=zcodeRun({executable:{command:'fixture',source:'configured'},cwd:process.cwd(),session:'sess_original',model:'account/GLM-5.3',prompt:'original',approve:async()=>true,ask:async()=>null,recovery:{enabled:async()=>true,delay:()=>0}},launch);
 const records=[];run.stdout.on('data',chunk=>records.push(...chunk.toString().trim().split('\n').map(JSON.parse)));
 assert.equal((await run).exitCode,0);assert.equal(sends,11);
 const inputs=child.requests.filter(row=>row.method==='session/send');
 assert(inputs.every(row=>row.params.sessionId==='sess_original'));
 assert.equal(inputs.filter(row=>row.params.content==='original').length,1);
 assert(inputs.slice(1).every(row=>row.params.content===zcodeRecoveryPrompt&&row.params.inputId.startsWith(zcodeRecoveryInputPrefix)));
 assert(!child.requests.some(row=>row.params?.type==='retryTurn'||row.method==='session/create'));
 assert.equal(records.filter(row=>row.type==='result').length,1);
 assert.equal(records.filter(row=>row.subtype==='api_retry').length,10);
});

test('ZCode waiting recovery stops immediately and disabling recovery prevents another request',async t=>{
 fixture(t);
 for(const action of ['stop','disable']){
  let child,enabled=true,waiting;const ready=new Promise(resolve=>waiting=resolve);
  const launch=()=>child=processMock(({id,method,params},emit)=>{
   emit({id,result:method==='session/usage'?usage:method==='session/read'?{projection:{}}:{}});
   if(method==='session/send')emit({method:'session/event',params:{sessionId:params.sessionId,type:'turn.failed',payload:{error:{message:'Start Plan is busy'}}}});
  });
  const run=zcodeRun({executable:{command:'fixture',source:'configured'},cwd:process.cwd(),session:'sess_original',model:'account/GLM-5.3',prompt:'original',approve:async()=>true,ask:async()=>null,recovery:{enabled:async()=>enabled,delay:()=>action==='stop'?60000:1}},launch);
  run.stdout.on('data',chunk=>{if(chunk.toString().includes('api_retry')){if(action==='disable')enabled=false;waiting();}});
  await ready;if(action==='stop')await run.interrupt();
  assert.equal((await run).exitCode,action==='stop'?0:1);
  assert.equal(child.requests.filter(row=>row.method==='session/send').length,1);
 }
});
