import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ChannelStore} from '../src/channels/store.ts';
import {ChannelService} from '../src/channels/service.ts';
import {QqAccess} from '../src/channels/qqAccess.ts';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'qq-access-')),store=new ChannelStore(path.join(directory,'channels.sqlite'));
  const account=store.addAccount('qq','test');let at=1000000;
  const access=new QqAccess(store,()=>at);
  t.after(async()=>{store.close();await fs.rm(directory,{recursive:true,force:true});});
  return {store,account,access,advance(ms){at+=ms;}};
}

test('QQ requires a locally generated, unexpired, one-use code and persists only its digest',async t=>{
  const f=await fixture(t),id=f.account.id;
  assert.equal(f.access.allowed(id,'owner'),false);
  for(const text of ['你好','/结果','/状态','/停止'])assert.equal(f.access.check(id,'stranger',text).allowed,false);
  const first=f.access.pair(id),second=f.access.pair(id);
  assert(!JSON.stringify(f.store.privateValue(id,'qq-pairing')).includes(second.code));
  assert.equal(f.access.check(id,'attacker','/绑定 '+first.code).allowed,false);assert.equal(f.access.allowed(id,'attacker'),false);
  f.access.check(id,'owner','/绑定 '+second.code);assert.equal(f.access.allowed(id,'owner'),true);
  f.access.check(id,'other','/绑定 '+second.code);assert.equal(f.access.allowed(id,'other'),false);
  const expired=f.access.pair(id);f.advance(600001);f.access.check(id,'other','/绑定 '+expired.code);assert.equal(f.access.allowed(id,'other'),false);
  f.store.close();assert.equal(f.access.allowed(id,'owner'),true);
});

test('old bindings do not authorize QQ; revocation blocks task, command and result delivery',async t=>{
  const f=await fixture(t);let connection,submissions=0;const events=[];
  const service=new ChannelService(f.store,{validateThread:async()=>{},receipt:async()=>undefined,submit:async()=>{submissions++;}});
  service.register({kind:'qq',connect:async value=>{connection=value;return {onEvent:event=>events.push(event),async close(){}};}});
  t.after(()=>service.close());
  const binding=await service.bind({accountId:f.account.id,chatId:'c',senderId:'old-user',threadId:'old-thread'});
  await service.start(f.account.id);
  const message={id:'a',chatId:'c',senderId:'old-user',text:'/结果'};
  await assert.rejects(service.control(f.account.id,message),/未授权/);
  await assert.rejects(connection.receive({...message,text:'删除文件'}),/未授权/);assert.equal(submissions,0);
  service.publish({type:'message.delta',threadId:'old-thread',text:'private'});assert.equal(events.length,0);
  const pairing=service.qqAccess.pair(f.account.id);service.qqAccess.check(f.account.id,'old-user','/绑定 '+pairing.code);
  service.publish({type:'message.delta',threadId:'old-thread',text:'owned'});assert.equal(events.length,1);
  service.qqAccess.revoke(f.account.id);
  assert.equal(service.isBound(f.account.id,'c','old-user',binding.threadId),false);
  service.publish({type:'message.delta',threadId:'old-thread',text:'private'});assert.equal(events.length,1);
  await assert.rejects(service.control(f.account.id,message),/未授权/);
});
