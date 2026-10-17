import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {ChannelStore} from '../src/channels/store.ts';
import {ChannelService} from '../src/channels/service.ts';
import {registerChannelRoutes} from '../src/channels/routes.ts';

async function fixture(t){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-channels-'));
  const store=new ChannelStore(path.join(folder,'channels.sqlite'));
  const receipts=new Map();let submitted=0;let context;const sent=[];
  const service=new ChannelService(store,{
    validateThread:async id=>{assert.ok(['thread-a','thread-b'].includes(id));},
    receipt:async id=>receipts.get(id),
    submit:async data=>{submitted++;const receipt={requestId:data.requestId,threadId:data.threadId,state:'accepted'};receipts.set(data.requestId,receipt);return receipt;},
  });
  service.register({kind:'qq',connect:async value=>{context=value;return {onEvent:output=>sent.push(output),close:async()=>{}};}});
  const account=store.addAccount('qq','My QQ');
  const binding=await service.bind({accountId:account.id,chatId:'chat',senderId:'owner',threadId:'thread-a'});
  t.after(async()=>{await service.close();assert.ok(folder.startsWith(path.join(os.tmpdir(),'cmc-channels-')));await fs.rm(folder,{recursive:true,force:true});});
  return {store,service,account,binding,sent,receipts,get context(){return context;},get submitted(){return submitted;}};
}

test('unconfigured chats cannot create tasks; duplicate delivery shares one task receipt',async t=>{
  const f=await fixture(t);await f.service.start(f.account.id);
  const message={id:'m1',chatId:'chat',senderId:'owner',text:'hello'};
  await assert.rejects(f.context.receive({...message,senderId:'other'}),/工作目录/);
  await assert.rejects(f.context.receive({...message,chatId:'other'}),/工作目录/);
  const [a,b]=await Promise.all([f.context.receive(message),f.context.receive(message)]);
  assert.equal(a.requestId,b.requestId);assert.equal(f.submitted,1);
  await f.context.receive(message);assert.equal(f.submitted,1);
  f.store.unbind(f.binding.id);
  await assert.rejects(f.context.receive({...message,id:'m2'}),/工作目录/);
});

test('only bound live conversation events reach drivers, and stop invalidates old callbacks',async t=>{
  const f=await fixture(t);await f.service.start(f.account.id);
  for(const event of [
    {type:'message.delta',threadId:'thread-b',text:'private'},
    {type:'message.delta',threadId:'thread-a',text:'old',replayed:true},
    {type:'terminal.output',threadId:'thread-a',stream:'stdout',text:'command'},
    {type:'message.delta',threadId:'thread-a',text:'child',subagent:true},
  ])f.service.publish(event);
  assert.equal(f.sent.length,0);
  f.service.publish({type:'message.delta',threadId:'thread-a',text:'answer'});
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].binding.senderId,'owner');
  await f.service.stop(f.account.id);
  await assert.rejects(f.context.receive({id:'later',chatId:'chat',senderId:'owner',text:'hello'}),/已断开/);
  f.service.publish({type:'turn.completed',threadId:'thread-a',status:'completed'});
  assert.equal(f.sent.length,1);
});

test('request mapping survives reload and cannot replay into a newly bound thread',async t=>{
  const f=await fixture(t);const first=f.store.request(f.binding,'m1');
  f.store.close();assert.equal(f.store.request(f.binding,'m1').requestId,first.requestId);
  await f.service.bind({...f.binding,threadId:'thread-b'});await f.service.start(f.account.id);
  await assert.rejects(f.context.receive({id:'m1',chatId:'chat',senderId:'owner',text:'hello'}),/原会话/);
  assert.equal(f.submitted,0);
});

test('management API requires local admin and unavailable driver cannot pretend to connect',async t=>{
  const f=await fixture(t);const app=Fastify();registerChannelRoutes(app,f.service,'admin-token');
  t.after(()=>app.close());
  assert.equal((await app.inject({url:'/api/channels'})).statusCode,403);
  assert.equal((await app.inject({url:'/api/channels',headers:{authorization:'Bearer admin-token'},remoteAddress:'192.168.1.8'})).statusCode,403);
  assert.equal((await app.inject({url:'/api/channels',headers:{authorization:'Bearer admin-token','x-public-proxy-secret':'proxy'}})).statusCode,403);
  const list=await app.inject({url:'/api/channels',headers:{authorization:'Bearer admin-token'}});
  assert.equal(list.statusCode,200);assert.equal(list.json().channels.find(c=>c.kind==='weixin').available,false);
  const account=f.store.addAccount('weixin','My WeChat');
  await assert.rejects(f.service.start(account.id),/尚未接入/);
  assert.equal(f.service.state().accounts.find(a=>a.id===account.id).state,'unavailable');
});
