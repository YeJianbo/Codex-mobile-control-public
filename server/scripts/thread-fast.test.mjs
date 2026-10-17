import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {EventEmitter} from 'node:events';
import {registerThreadFast} from '../src/services/threadFast.ts';
import {permittedPublicRequest} from './public-routes.mjs';
test('Fast reads the current session without overriding it and saves only explicit toggles',async()=>{
 const calls=[];let tier='priority';const app=Fastify();
 registerThreadFast(app,{request:async(method,params)=>{calls.push({method,params});if(method==='thread/settings/update'){tier=params.serviceTier==='fast'?'priority':params.serviceTier===null?'priority':params.serviceTier;return {};}return {serviceTier:tier,config:{service_tier:'priority'}};}},async id=>assert.equal(id,'t'));
 try{
  assert.equal((await app.inject('/api/threads/t/fast')).json().fast,true);
  assert.deepEqual(calls[0],{method:'thread/resume',params:{threadId:'t',excludeTurns:true}});
  assert.equal((await app.inject({method:'PUT',url:'/api/threads/t/fast',payload:{fast:false}})).json().fast,false);
  assert.deepEqual(calls[1],{method:'thread/settings/update',params:{threadId:'t',serviceTier:'default'}});
  assert.deepEqual(calls[2],{method:'thread/resume',params:{threadId:'t',excludeTurns:true}});
  assert.equal((await app.inject('/api/threads/t/fast')).json().fast,false);
  await app.inject({method:'PUT',url:'/api/threads/t/fast',payload:{fast:true}});
  assert.equal((await app.inject('/api/threads/t/fast')).json().fast,true);
  assert.equal((await app.inject('/api/settings/fast')).json().fast,true);
  assert.equal(permittedPublicRequest('GET','/api/threads/t/fast'),true);
  assert.equal(permittedPublicRequest('PUT','/api/threads/t/fast'),true);
  assert.equal(permittedPublicRequest('DELETE','/api/threads/t/fast'),false);
 }finally{await app.close();}
});

test('acknowledgement without the requested effective state is not a successful toggle',async()=>{
 const app=Fastify();registerThreadFast(app,{request:async method=>method==='thread/settings/update'?{}:{serviceTier:'priority'}},async()=>{});
 try{
  const response=await app.inject({method:'PUT',url:'/api/threads/t/fast',payload:{fast:false}});
  assert.equal(response.statusCode,502);assert.equal(response.json().fast,true);
 }finally{await app.close();}
});
test('missing service-tier information remains unknown rather than pretending it is off',async()=>{
 const app=Fastify();registerThreadFast(app,{request:async()=>({})},async()=>{});
 try{assert.equal((await app.inject('/api/threads/t/fast')).json().fast,null);}finally{await app.close();}
});

test('Fast save waits for application after the RPC acknowledgement, ignoring other threads',async()=>{
 const app=Fastify(),rpc=new EventEmitter();let tier='priority',applied=false;
 rpc.request=async(method,params)=>{
  if(method==='thread/settings/update'){
   rpc.emit('notification',{method:'thread/settings/updated',params:{threadId:'other',threadSettings:{serviceTier:'default'}}});
   setTimeout(()=>{tier=params.serviceTier;applied=true;rpc.emit('notification',{method:'thread/settings/updated',params:{threadId:params.threadId,threadSettings:{serviceTier:tier}}});},30);
   return {};
  }
  assert(applied,'readback must wait for the actual settings update');
  return {serviceTier:tier};
 };
 registerThreadFast(app,rpc,async()=>{});
 try{
  const response=await app.inject({method:'PUT',url:'/api/threads/t/fast',payload:{fast:false}});
  assert.equal(response.statusCode,200);assert.equal(response.json().fast,false);
  assert.equal(rpc.listenerCount('notification'),0);
 }finally{await app.close();}
});
