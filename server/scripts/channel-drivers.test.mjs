import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {ChannelStore} from '../src/channels/store.ts';
import {ChannelService} from '../src/channels/service.ts';
import {qqDriver} from '../src/channels/qq.ts';
import {weixinDriver,weixinBase} from '../src/channels/weixin.ts';
import {registerChannelRoutes} from '../src/channels/routes.ts';

async function fixture(t){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-platform-'));
  const store=new ChannelStore(path.join(folder,'channels.sqlite')),receipts=new Map(),submitted=[];
  let sequence=0;
  const service=new ChannelService(store,{validateThread:async()=>{},validateProject:async p=>assert.equal(p,'C:/fixture'),receipt:async id=>receipts.get(id),
    submit:async input=>{submitted.push(input);const receipt={requestId:input.requestId,threadId:input.threadId||`thread-${++sequence}`,state:'accepted'};receipts.set(input.requestId,receipt);service.publish({type:'thread.started',threadId:receipt.threadId,requestId:input.requestId,thread:{id:receipt.threadId}});return receipt;},status:async()=> 'idle',interrupt:async()=>{}});
  t.after(async()=>{await service.close();assert.ok(folder.startsWith(path.join(os.tmpdir(),'cmc-platform-')));await fs.rm(folder,{recursive:true,force:true});});
  return {store,service,submitted};
}
test('QQ official events automatically create isolated conversations and reuse receipts',async t=>{
  const f=await fixture(t),handlers={},sent=[];let stop;
  const bot={on(name,callback){handlers[name]=callback;return this;},start(signal){return new Promise(resolve=>{stop=resolve;signal.addEventListener('abort',resolve,{once:true});queueMicrotask(()=>handlers.ready({}));});},stop(){stop?.();},async sendText(target,text){sent.push({target,text});}};
  f.service.register(qqDriver(f.service,()=>bot));const account=f.store.addAccount('qq','QQ');
  await f.service.configure(account.id,{appId:'12345678',appSecret:'fixture-secret'});await f.service.setProject(account.id,'C:/fixture');await f.service.start(account.id);
  const message={kind:'c2c',senderId:'user-a',messageId:'one',content:'hello',replyTarget:{scope:'c2c',targetId:'user-a',msgId:'one'}};
  await handlers.message({},message);assert.equal(f.submitted.length,0);assert.equal(f.store.privateValue(account.id,'qq-reply:user-a'),undefined);
  const pairing=f.service.qqAccess.pair(account.id);
  await handlers.message({},{...message,messageId:'pair',content:'/绑定 '+pairing.code});assert.equal(f.submitted.length,0);assert.equal(f.service.qqAccess.allowed(account.id,'user-a'),true);
  f.store.putPrivate(account.id,'qq-authorized',['user-a','user-b']);sent.length=0;
  await handlers.message({},message);await handlers.message({},message);
  await handlers.message({},{...message,senderId:'user-b',messageId:'two',replyTarget:{scope:'c2c',targetId:'user-b',msgId:'two'}});
  assert.equal(f.submitted.length,2);assert.equal(f.store.bindings().length,2);assert.notEqual(f.store.bindings()[0].threadId,f.store.bindings()[1].threadId);
  assert.equal(sent.length,0,'Accepted messages do not send a submission acknowledgement');
  f.service.publish({type:'message.delta',threadId:'thread-1',itemId:'answer',text:'完成',textComplete:true});f.service.publish({type:'turn.completed',threadId:'thread-1',status:'completed'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.at(-1).text,'完成');assert.equal(sent.at(-1).target.targetId,'user-a');
  assert.equal(JSON.stringify(f.service.state()).includes('fixture-secret'),false);
  await f.service.stop(account.id);await handlers.message({},{...message,messageId:'three'});assert.equal(f.submitted.length,2);
});

test('Weixin QR credentials remain private; polling cursor and reply context follow official messages',async t=>{
  const f=await fixture(t),original=globalThis.fetch,calls=[];let polls=0,aborted=false;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input),body=options.body?JSON.parse(options.body):null;calls.push({path:url.pathname,body,headers:options.headers});
    const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    if(url.pathname.endsWith('get_bot_qrcode'))return json({qrcode:'qr-id',qrcode_img_content:'https://weixin.qq.com/fixture'});
    if(url.pathname.endsWith('get_qrcode_status'))return json({status:'confirmed',bot_token:'private-token',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'});
    if(url.pathname.endsWith('getupdates')){
      if(polls++===0)return json({ret:0,get_updates_buf:'cursor-1',msgs:[{message_id:'9007199254740993',from_user_id:'owner',message_type:1,message_state:2,context_token:'reply-context',item_list:[{type:1,text_item:{text:'hello'}}]}]});
      return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
    }
    if(url.pathname.endsWith('sendmessage'))return json({ret:0});
    throw Error('unexpected endpoint');
  };
  t.after(()=>{globalThis.fetch=original;});
  f.service.register(weixinDriver(f.service));const account=f.store.addAccount('weixin','微信');await f.service.setProject(account.id,'C:/fixture');
  assert.equal((await f.service.login(account.id)).status,'wait');assert.equal((await f.service.login(account.id)).status,'confirmed');
  assert.equal(JSON.stringify(f.service.state()).includes('private-token'),false);
  await f.service.start(account.id);
  for(let i=0;i<100&&!f.submitted.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls.some(c=>c.path.endsWith('sendmessage')),false);
  const binding=f.store.bindings()[0];
  f.service.publish({type:'message.delta',threadId:binding.threadId,itemId:'answer',text:'你好',textComplete:true});
  f.service.publish({type:'turn.completed',threadId:binding.threadId,status:'completed'});
  for(let i=0;i<100&&!calls.some(c=>c.path.endsWith('sendmessage'));i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.submitted.length,1);assert.equal(calls.find(c=>c.path.endsWith('sendmessage')).body.msg.context_token,'reply-context');
  assert.equal(f.store.privateValue(account.id,'weixin-cursor'),'cursor-1');
  await f.service.stop(account.id);assert.equal(aborted,true);
  assert.throws(()=>weixinBase('https://evil.invalid'),/地址无效/);
});

test('native console grants are one-use, local and tied to the paired browser token',async t=>{
  const f=await fixture(t),app=Fastify();registerChannelRoutes(app,f.service,'admin');t.after(()=>app.close());
  const bootstrap=await app.inject({method:'POST',url:'/api/channels/bootstrap',headers:{authorization:'Bearer admin'}});assert.equal(bootstrap.statusCode,200);
  const payload={code:bootstrap.json().code};const claim=await app.inject({method:'POST',url:'/api/channels/claim',headers:{authorization:'Bearer paired'},payload});assert.equal(claim.statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/channels/claim',headers:{authorization:'Bearer paired'},payload})).statusCode,403);
  const headers={authorization:'Bearer paired','x-channel-admin':claim.json().grant};
  assert.equal((await app.inject({url:'/api/channels',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/api/channels',headers:{...headers,authorization:'Bearer other'}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/channels',headers,remoteAddress:'192.168.1.1'})).statusCode,403);
  assert.equal((await app.inject({url:'/api/channels',headers:{...headers,'x-public-proxy-secret':'proxy'}})).statusCode,403);
});
