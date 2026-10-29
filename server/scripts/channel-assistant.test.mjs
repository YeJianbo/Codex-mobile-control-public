import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChannelService} from '../src/channels/service.ts';
import {ChannelStore} from '../src/channels/store.ts';
import {ChannelWorkspaces} from '../src/channels/workspace.ts';
import {channelDefaultModel,channelAssistantModel,channelAssistantCommand} from '../src/channels/model.ts';
import {channelFailureMessage} from '../src/channels/delivery.ts';
import Fastify from 'fastify';
import {registerMobileStatistics} from '../src/services/mobileStatistics.ts';

test('local tasks retain Sol while the channel assistant selects Gemini Flash',()=>{
  assert.equal(channelDefaultModel([{model:'gpt-6-astra'},{model:'gpt-6.1-sol'}]),'gpt-6.1-sol');
  assert.equal(channelDefaultModel([{model:'gpt-6-sol'}]),'gpt-6-sol');
  assert.throws(()=>channelDefaultModel([{model:'gpt-6-astra'}]),/没有可用/);
  const flash={model:'antigravity::gemini-3.8-flash',defaultReasoningEffort:'medium'};
  assert.equal(channelAssistantModel([{model:'gemini-3.8-flash'},{model:'relay::gemini-3.8-flash'},flash,{model:'relay::gemini-3.8-flash-lite'}]),flash);
  assert.throws(()=>channelAssistantModel([{model:'relay::gemini-3.8-flash'}]),/AGY/);
  assert.throws(()=>channelAssistantModel([{model:'gpt-6.1-sol'}]),/Gemini 3.8 Flash/);
  const start=channelAssistantCommand({requestId:'new',text:'你好',projectPath:'C:/assistant'},flash);
  assert.equal(start.type,'thread.start');assert.equal(start.model,flash.model);assert.equal(start.permission,'auto');assert.equal(start.agentTransport,undefined);
  assert.equal(channelAssistantCommand({requestId:'next',threadId:'antigravity-existing',text:'继续'},flash).type,'turn.start');
  assert.throws(()=>channelAssistantCommand({requestId:'old',threadId:'01a15933-7ad7-7580-b026-c4a20268ccd1',text:'继续'},flash),/新会话/);
  assert.match(channelFailureMessage(Error('该模型不在控制台可选列表中，请刷新模型列表')),/当前模型不可用/);
  assert(!channelFailureMessage(Error('Bearer secret-token')).includes('secret-token'));
});

test('channel route changes create a new thread only for new messages and retain authorization and history',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'channel-route-'));
  const store=new ChannelStore(path.join(directory,'channels.sqlite'));
  const receipts=new Map(),submitted=[];let connection,busy=true;
  const service=new ChannelService(store,{
    validateThread:async()=>{},requiresNewThread:async id=>id==='official',status:async()=>busy?'running':'idle',
    prepareWorkspace:async(id,previous)=>{assert.equal(previous,'official');return 'C:/assistant-space';},
    receipt:async id=>receipts.get(id),submit:async input=>{
      submitted.push(input);const receipt={requestId:input.requestId,threadId:input.threadId||'gemini',state:'accepted'};
      receipts.set(input.requestId,receipt);service.publish({type:'thread.started',requestId:input.requestId,threadId:receipt.threadId});return receipt;
    },
  });
  service.register({kind:'qq',connect:async value=>{connection=value;return {onEvent(){},async close(){}};}});
  t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
  const account=store.addAccount('qq','test');store.putPrivate(account.id,'qq-authorized',['owner']);
  const binding=store.bind({accountId:account.id,chatId:'chat',senderId:'owner',threadId:'official'});
  const old=store.request(binding,'failed');const failed={...old,state:'failed',error:'original failure'};receipts.set(old.requestId,failed);
  await service.start(account.id);
  const message={id:'failed',chatId:'chat',senderId:'owner',text:'你是？'};
  assert.deepEqual(await connection.receive(message),failed);assert.equal(submitted.length,0);
  await assert.rejects(connection.receive({...message,id:'new'}),/仍在运行/);
  assert.equal(store.findRequest(account.id,'chat','owner','new'),undefined);
  busy=false;
  const a=await connection.receive({...message,id:'new'});
  assert.equal(a.threadId,'gemini');assert.equal(submitted.length,1);
  assert.equal(submitted[0].threadId,undefined);assert.equal(submitted[0].projectPath,'C:/assistant-space');
  assert.equal(store.bindings()[0].threadId,'gemini');assert.equal(store.bindings()[0].id,binding.id);
  assert.equal(store.findRequest(account.id,'chat','owner','failed').threadId,'official');
  assert.equal(service.isAuthorized(account.id,'owner'),true);
  await connection.receive({...message,id:'new'});assert.equal(submitted.length,1);
  await assert.rejects(connection.receive(message),/原会话/);assert.equal(submitted.length,1);
  await connection.receive({...message,id:'next'});assert.equal(submitted[1].threadId,'gemini');
  store.putPrivate(account.id,'qq-authorized',[]);
  await assert.rejects(connection.receive({...message,id:'revoked'}),/未授权/);assert.equal(submitted.length,2);
});

test('mobile warmup settings use a fixed route and validate writes before forwarding',async t=>{
  const app=Fastify(),calls=[];t.after(()=>app.close());
  registerMobileStatistics(app,{managementRequest:async(route,body)=>{calls.push({route,body});return body||{enabled:false,windows:['weekly'],status:'disabled'};}});
  const route='/api/mobile-management/statistics/quota/warmup';
  assert.equal((await app.inject({url:route})).json().status,'disabled');
  assert.equal(calls[0].route,'/api/usage/warmup');
  const selected={enabled:true,windows:['fiveHour','weekly']};
  assert.deepEqual((await app.inject({method:'POST',url:route,payload:selected})).json(),selected);
  assert.equal((await app.inject({method:'POST',url:route,payload:{enabled:true,windows:[]}})).statusCode,400);
  assert.equal(calls.length,2);
});

test('projectless conversations have independent spaces, reuse receipts and keep existing project binding',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'channel-assistant-'));
  const spaces=new ChannelWorkspaces(path.join(directory,'spaces')),store=new ChannelStore(path.join(directory,'channels.sqlite'));
  const submitted=[],receipts=new Map();let connection;
  const service=new ChannelService(store,{
    prepareWorkspace:id=>spaces.prepare(id),validateProject:async value=>assert.equal(value,'C:/project'),validateThread:async()=>{},
    receipt:async id=>receipts.get(id),submit:async input=>{submitted.push(input);const receipt={state:'accepted',requestId:input.requestId,threadId:input.threadId||'thread-'+submitted.length};receipts.set(input.requestId,receipt);return receipt;},
  });
  service.register({kind:'qq',connect:async value=>{connection=value;return {onEvent(){},async close(){}};}});
  t.after(async()=>{await service.close();await fs.rm(directory,{recursive:true,force:true});});
  const account=store.addAccount('qq','test');store.putPrivate(account.id,'qq-authorized',['a','b']);await service.start(account.id);
  const first={id:'first',chatId:'one',senderId:'a',text:'你好'};
  const [a,b]=await Promise.all([connection.receive(first),connection.receive(first)]);
  assert.equal(a.threadId,b.threadId);assert.equal(submitted.length,1);assert.match(submitted[0].text,/用户消息：\n你好/);
  await connection.receive({...first,id:'second',text:'继续'});assert.equal(submitted[1].threadId,a.threadId);
  await connection.receive({...first,senderId:'b'});assert.notEqual(submitted[0].projectPath,submitted[2].projectPath);
  assert.equal(spaces.owns(submitted[0].projectPath),true);
  await service.setProject(account.id,'C:/project');await connection.receive({...first,id:'third',chatId:'two'});
  assert.equal(submitted[3].projectPath,'C:/project');assert.equal(submitted[3].text,'你好');
  await service.setProject(account.id,'');assert.equal(store.privateValue(account.id,'projectPath'),'');
  assert.equal(store.bindings().length,3);
  await assert.rejects(spaces.prepare('../escape'),/ID/);
});
