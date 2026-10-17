import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionManager} from '../dist/services/sessionManager.js';
import {writeRemoteAutoApproval} from '../dist/services/remoteApprovalSettings.js';

test('background gateway approves public-thread operations without a phone connection',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-auto-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  try{
    const replies=[],events=[],approvals=[];
    const codex=new EventEmitter();
    codex.request=async(method,p)=>({thread:{id:p.threadId,status:{type:'idle'}}});
    codex.respond=async(id,result)=>{replies.push({id,result});codex.emit("notification",{method:"serverRequest/resolved",params:{requestId:id,threadId:"public-thread"}});};
    const store={threads:[],approvals,
      upsertThread:async value=>value,
      addApproval:async value=>{const row={...value,status:'pending'};approvals.push(row);return row;},
      resolveApproval:async(id,decision)=>{approvals.find(a=>a.id===id).status=decision==='accept'?'accepted':'declined';},
      expireApproval:async id=>{approvals.find(a=>a.id===id).status='expired';},
    };
    const sessions=new SessionManager(codex,{publish:event=>events.push(event)},store);
    await sessions.handleClientCommand({type:'thread.resume',threadId:'public-thread'},true);
    await writeRemoteAutoApproval(true);
    // No mobile socket or UI exists in this fixture.
    for(const [index,method] of ['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval'].entries()){
      await sessions.handleServerRequest({id:`desktop:test:${index}`,method,params:{threadId:'public-thread',itemId:`tool-${index}`,permissions:{network:{enabled:true}}}});
    }
    assert.equal(replies.length,3);
    assert.deepEqual(replies[0].result,{decision:'accept'});
    assert.deepEqual(replies[1].result,{decision:'accept'});
    assert.deepEqual(replies[2].result,{permissions:{network:{enabled:true}},scope:'turn'});
    assert.ok(approvals.every(a=>a.status==='accepted'));
    assert.equal(events.filter(e=>e.type==='approval.requested').length,0);
    assert.equal(events.filter(e=>e.type==='approval.resolved'&&e.decision==='decline').length,0,'processed notifications must not race an accepted response into a denial');
    await sessions.handleServerRequest({id:'question',method:'item/tool/requestUserInput',params:{threadId:'public-thread',questions:[{id:'q',question:'Choose'}]}});
    assert.equal(replies.length,3,'must not invent answers to questions');
    await writeRemoteAutoApproval(false);
    await sessions.handleServerRequest({id:'manual',method:'item/fileChange/requestApproval',params:{threadId:'public-thread'}});
    assert.equal(replies.length,3,'disabled setting preserves manual approval');
    codex.emit('notification',{method:'serverRequest/resolved',params:{requestId:'manual',threadId:'public-thread'}});
    assert(events.some(e=>e.type==='approval.resolved'&&e.approvalId.startsWith('manual')&&e.decision==='resolved'));
    assert.equal(approvals.find(a=>a.rpcId==='manual').status,'expired');
    await writeRemoteAutoApproval(true);
    codex.respond=async()=>{throw Error('bridge disconnected');};
    await sessions.handleServerRequest({id:'failed',method:'item/fileChange/requestApproval',params:{threadId:'public-thread'}});
    assert.equal(events.some(e=>e.type==='approval.requested'&&e.approvalId.startsWith('failed')),false,'automatic mode must not produce manual approval notifications');
    assert.equal(approvals.find(a=>a.rpcId==='failed').status,'pending');
  }finally{
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('direct and desktop copies share one automatic decision in either arrival order',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-approval-mirror-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 try{
  await writeRemoteAutoApproval(true);
  for(const order of ['direct-first','bridge-first','concurrent']){
   const codex=new EventEmitter(),replies=[],events=[],approvals=[];
   codex.respond=async(id,result)=>{replies.push({id,result});};
   const store={threads:[],approvals,
    addApproval:async input=>{const row={...input,status:'pending'};approvals.push(row);await Promise.resolve();return row;},
    resolveApproval:async(id,decision)=>{const row=approvals.find(a=>a.id===id);assert.equal(row.status,'pending');row.status=decision==='accept'?'accepted':'declined';},
   };
   const manager=new SessionManager(codex,{publish:event=>events.push(event)},store);
   const params={threadId:'mirror-thread',turnId:'turn-1',itemId:'exec-unique',command:'example'};
   const direct={id:51,method:'item/commandExecution/requestApproval',params},bridge={...direct,id:'desktop:1234:7:51'};
   if(order==='concurrent')await Promise.all([manager.handleServerRequest(direct),manager.handleServerRequest(bridge)]);
   else for(const request of order==='direct-first'?[direct,bridge]:[bridge,direct])await manager.handleServerRequest(request);
   assert.equal(approvals.length,1,order);assert.equal(approvals[0].status,'accepted',order);
   assert.equal(replies.length,1,order);assert.equal(events.filter(e=>e.type==='approval.requested').length,0,order);
   await manager.handleServerRequest(bridge);assert.equal(replies.length,1,'snapshot replay must not submit a second decision');
  }
 }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('old pending mirror adopts its recorded response without another RPC or a new notification',async()=>{
 const replies=[],events=[],codex=new EventEmitter();codex.respond=async(...args)=>replies.push(args);
 const base={method:'item/commandExecution/requestApproval',threadId:'mirror-thread',turnId:'turn-1',itemId:'exec-unique'};
 const approvals=[{...base,id:'direct',rpcId:51,status:'accepted'},{...base,id:'mirror',rpcId:'desktop:1234:7:51',status:'pending'},
  {...base,id:'other-thread',rpcId:'desktop:1234:7:51',threadId:'different',status:'pending'},
  {...base,id:'other-operation',rpcId:'desktop:1234:7:51',itemId:'exec-other',status:'pending'}];
 const store={threads:[],approvals,resolveApproval:async(id,decision)=>{const row=approvals.find(a=>a.id===id);assert.equal(row.status,'pending');row.status=decision==='accept'?'accepted':'declined';}};
 const manager=new SessionManager(codex,{publish:event=>events.push(event)},store);
 await Promise.all([manager.reconcileApprovalMirrors(),manager.reconcileApprovalMirrors()]);
 assert.equal(approvals[1].status,'accepted');assert.equal(approvals[2].status,'pending');assert.equal(approvals[3].status,'pending');
 assert.equal(events.length,1);assert.deepEqual(events[0],{type:'approval.resolved',threadId:'mirror-thread',approvalId:'mirror',decision:'accept'});
 await manager.resolveApproval('mirror','accept');assert.equal(replies.length,0,'an already recorded acceptance is idempotent');
 await assert.rejects(manager.resolveApproval('mirror','decline'),/已处理|失效/);
});

test('distinct desktop contexts remain independent and questions still require user input',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-approval-context-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 try{
  await writeRemoteAutoApproval(false);
  const codex=new EventEmitter(),events=[],approvals=[];
  const store={threads:[],approvals,addApproval:async input=>{const row={...input,status:'pending'};approvals.push(row);return row;}};
  const manager=new SessionManager(codex,{publish:event=>events.push(event)},store);
  for(const id of ['desktop:1234:7:51','desktop:1234:8:51'])await manager.handleServerRequest({id,method:'item/commandExecution/requestApproval',params:{threadId:'mirror-thread',turnId:'turn-1',itemId:'exec-unique'}});
  assert.equal(approvals.length,2);assert.equal(events.filter(e=>e.type==='approval.requested').length,2);
  await writeRemoteAutoApproval(true);
  await manager.handleServerRequest({id:52,method:'item/tool/requestUserInput',params:{threadId:'mirror-thread',questions:[{id:'q',question:'Choose'}]}});
  assert.equal(events.at(-1).approvalType,'question');assert.equal(approvals.at(-1).status,'pending');
 }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
