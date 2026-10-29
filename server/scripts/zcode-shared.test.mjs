import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ZcodeWorkspaceBridge} from './zcode-shared-backend.mjs';

function fixture(t,options={}){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const written=[];child.stdin.on('data',data=>written.push(...data.toString().trim().split('\n').map(JSON.parse)));
  const bridge=new ZcodeWorkspaceBridge({child,cwd:process.cwd(),...options});t.after(()=>bridge.dispose(false));
  const peer=role=>{const rows=[];const peer={role,rows,send:row=>rows.push(row),close:()=>{}};bridge.attach(peer);return peer;};
  const reply=(request,result={})=>bridge.receive({id:request.id,result});
  const call=(peer,method,params={},id=1)=>{bridge.request(peer,{id,method,params});return written.at(-1);};
  return {bridge,child,written,peer,call,reply};
}

test('shared runtime separates RPC ids and sends approvals only to the task owner',t=>{
  const {bridge,peer,call,reply,written}=fixture(t),gateway=peer('gateway'),desktop=peer('desktop');
  const a=call(gateway,'session/create',{sessionId:'same'}),b=call(desktop,'session/resume',{sessionId:'same'});
  assert.notEqual(a.id,b.id);reply(a,{session:{sessionId:'same'}});reply(b,{session:{sessionId:'same'}});
  assert(gateway.rows.some(row=>row.id===1&&row.result.session.sessionId==='same'));
  assert(desktop.rows.some(row=>row.id===1&&row.result.session.sessionId==='same'));
  reply(call(gateway,'session/send',{sessionId:'same'},2),{accepted:true});
  bridge.receive({id:'native-permission',method:'interaction/requestPermission',params:{sessionId:'same'}});
  const approval=gateway.rows.find(row=>row.method==='interaction/requestPermission');assert(approval);
  assert(!desktop.rows.some(row=>row.method==='interaction/requestPermission'));
  const before=written.length;bridge.request(desktop,{id:approval.id,result:{decision:'allow'}});assert.equal(written.length,before);
  bridge.request(gateway,{id:approval.id,result:{decision:'allow'}});assert.equal(written.at(-1).id,'native-permission');
  assert.equal(written.filter(row=>row.method==='session/subscribe').length,1);
});

test('owner disconnect hands a pending question to an attached observer without duplicate answers',t=>{
  const {bridge,peer,call,reply,written}=fixture(t),gateway=peer('gateway'),desktop=peer('desktop');
  reply(call(gateway,'session/send',{sessionId:'same'}),{accepted:true});reply(call(desktop,'session/resume',{sessionId:'same'}));
  bridge.receive({id:7,method:'interaction/requestUserInput',params:{sessionId:'same'}});
  const id=gateway.rows.at(-1).id;bridge.detach(gateway);
  assert.equal(desktop.rows.at(-1).method,'interaction/requestUserInput');
  bridge.request(desktop,{id,result:{action:'cancel'}});const count=written.length;
  bridge.request(gateway,{id,result:{action:'accept'}});assert.equal(written.length,count);assert.equal(written.at(-1).id,7);
});

test('startup state is replayed and active turns survive every observer disconnect',async t=>{
  let reclaimed=false;
  const {bridge,peer,call,reply,child}=fixture(t,{idleMs:10,onIdle:()=>reclaimed=true});
  child.stdin.on('data',data=>{for(const row of data.toString().trim().split('\n').map(JSON.parse))if(row.method==='session/read')bridge.receive({id:row.id,result:{projection:{status:'idle',backgroundJobs:[]}}});});
  bridge.receive({method:'startup/storageState',params:{databaseId:'session',phase:'ready'}});
  const gateway=peer('gateway');bridge.replayStartup(gateway);assert.equal(gateway.rows.at(-1).params.phase,'ready');
  reply(call(gateway,'session/create',{sessionId:'same'}));
  bridge.receive({method:'session/event',params:{sessionId:'same',type:'turn.started'}});
  bridge.detach(gateway);await new Promise(resolve=>setTimeout(resolve,25));assert.equal(bridge.closed,false);
  bridge.receive({method:'session/event',params:{sessionId:'same',type:'turn.completed'}});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(reclaimed,true);assert.equal(child.stdin.writableEnded,true);
});

test('rejected competing sends retain the original owner; a legacy active session cannot be adopted',t=>{
  const {bridge,peer,call,reply}=fixture(t,{legacyBlocked:message=>message.params?.sessionId==='legacy'}),gateway=peer('gateway'),desktop=peer('desktop');
  reply(call(gateway,'session/send',{sessionId:'same'}),{accepted:true});
  const rejected=call(desktop,'session/send',{sessionId:'same'});bridge.receive({id:rejected.id,error:{code:-32010,message:'busy'}});
  bridge.receive({id:'auth',method:'interaction/requestPermission',params:{sessionId:'same'}});
  assert(gateway.rows.at(-1).method==='interaction/requestPermission');assert(desktop.rows.at(-1).error);
  bridge.request(desktop,{id:99,method:'session/resume',params:{sessionId:'legacy'}});
  assert.equal(desktop.rows.at(-1).error.code,-32010);
});
