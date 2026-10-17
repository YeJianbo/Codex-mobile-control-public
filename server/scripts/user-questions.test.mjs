import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SessionManager} from '../src/services/sessionManager.ts';
import {readCustomPermissions} from '../src/services/codexSettings.ts';
import {writeRemoteAutoApproval} from '../src/services/remoteApprovalSettings.ts';
function setup(){
 const codex=new EventEmitter(),responses=[],events=[];
 codex.respond=(id,result)=>responses.push({id,result});codex.respondError=(...args)=>{throw Error(JSON.stringify(args))};
 const store={approvals:[],threads:[],async addApproval(value){const a={...value,status:'pending'};this.approvals.push(a);return a;},async resolveApproval(id,decision){this.approvals.find(a=>a.id===id).status=decision==='accept'?'accepted':'declined';},async expireApproval(id){this.approvals.find(a=>a.id===id).status='expired';}};
 const sessions=new SessionManager(codex,{publish:e=>events.push(e)},store);
 return {codex,responses,events,store,sessions};
}
test('a queued message can steer a desktop-owned turn through its observed turn ID',async()=>{
 const {codex,events,sessions}=setup();
 const calls=[];codex.request=async(method,params)=>{calls.push({method,params});return {};};
 await sessions.steer('desktop-thread','补充说明',[],[],'desktop-turn');
 assert.equal(calls[0].method,'turn/steer');
 assert.equal(calls[0].params.expectedTurnId,'desktop-turn');
 assert.equal(calls[0].params.input[0].text,'补充说明');
 assert(events.some(event=>event.type==='user.message'&&event.text==='补充说明'));
});
test('questions require explicit complete answers, keep exact RPC ID, and reject repeat submissions',async()=>{
 const {codex,responses,store,sessions}=setup();
 codex.emit('serverRequest',{id:42,method:'item/tool/requestUserInput',params:{threadId:'t',questions:[{id:'q',question:'Choose',options:null}]}});
 await new Promise(r=>setImmediate(r));assert.equal(responses.length,0);
 await assert.rejects(()=>sessions.resolveApproval('question-42','accept'),/填写/);
 await assert.rejects(()=>sessions.answerQuestions('question-42',{}),/所有/);
 await sessions.answerQuestions('question-42',{q:{answers:['My answer']}});
 assert.deepEqual(responses,[{id:42,result:{answers:{q:{answers:['My answer']}}}}]);
 assert.equal(store.approvals[0].status,'accepted');
 await assert.rejects(()=>sessions.answerQuestions('question-42',{q:{answers:['again']}}),/失效/);
});
test('desktop completion expires the matching remote prompt',async()=>{
 const {codex,store,sessions,responses}=setup();
 codex.emit('serverRequest',{id:'q',method:'item/tool/requestUserInput',params:{threadId:'t',questions:[{id:'a',question:'Answer'}]}});
 await new Promise(r=>setImmediate(r));codex.emit('notification',{method:'serverRequest/resolved',params:{threadId:'t',requestId:'q'}});
 await assert.rejects(()=>sessions.answerQuestions('question-q',{a:{answers:['late']}}),/失效/);assert.equal(responses.length,0);assert.equal(store.approvals[0].status,'expired');
});
test('desktop approval keeps the original request ID and optional auto handling never answers questions',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-desktop-approval-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 try{
  const {codex,responses,store,sessions}=setup();
  await writeRemoteAutoApproval(false);
  codex.emit('serverRequest',{id:'desktop:1:7',method:'item/commandExecution/requestApproval',params:{threadId:'t',itemId:'item-7',command:'Get-Date'}});
  for(let n=0;n<200&&!store.approvals.some(a=>a.id==='desktop:1:7-item-7');n++)await new Promise(r=>setTimeout(r,10));
  assert.equal(responses.length,0);
  await sessions.resolveApproval('desktop:1:7-item-7','accept');
  assert.deepEqual(responses[0],{id:'desktop:1:7',result:{decision:'accept'}});
  assert.equal(store.approvals[0].status,'accepted');
  await writeRemoteAutoApproval(true);
  codex.emit('serverRequest',{id:'desktop:1:8',method:'item/commandExecution/requestApproval',params:{threadId:'t',itemId:'item-8',command:'Get-Date'}});
  codex.emit('serverRequest',{id:'desktop:1:9',method:'item/tool/requestUserInput',params:{threadId:'t',questions:[{id:'q',question:'Continue?'}]}});
  for(let n=0;n<200&&(responses.length<2||!store.approvals.some(a=>a.approvalType==='question'));n++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(responses[1],{id:'desktop:1:8',result:{decision:'accept'}});
  assert.equal(store.approvals.find(a=>a.id==='desktop:1:8-item-8').status,'accepted');
  assert.equal(store.approvals.find(a=>a.id==='question-desktop:1:9').status,'pending');
  assert.equal(responses.length,2);
  assert.deepEqual(await sessions.approvePendingAutomatically(),{accepted:0,failed:0});
 }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
test('enabling automatic handling also resolves already pending command approvals, never questions',async()=>{
 const {responses,store,sessions}=setup();
 await store.addApproval({id:'51-cmd',rpcId:51,method:'item/commandExecution/requestApproval',threadId:'t',approvalType:'command',title:'Get-Date'});
 await store.addApproval({id:'question-52',rpcId:52,method:'item/tool/requestUserInput',threadId:'t',approvalType:'question',title:'Choose'});
 assert.deepEqual(await sessions.approvePendingAutomatically(),{accepted:1,failed:0});
 assert.deepEqual(responses,[{id:51,result:{decision:'accept'}}]);
 assert.equal(store.approvals.find(a=>a.id==='question-52').status,'pending');
});
test('automatic handling accepts numeric Codex approvals before showing a prompt',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-auto-approval-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 try{
  const {codex,responses,events,store}=setup();
  await writeRemoteAutoApproval(true);
  codex.emit('serverRequest',{id:123,method:'item/commandExecution/requestApproval',params:{threadId:'t',itemId:'cmd-123',command:'Get-Date'}});
  await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(responses,[{id:123,result:{decision:'accept'}}]);
  assert.equal(store.approvals[0].status,'accepted');
  assert.equal(events.some(event=>event.type==='approval.requested'),false);
  codex.emit('serverRequest',{id:124,method:'item/tool/requestUserInput',params:{threadId:'t',questions:[{id:'q',question:'Continue?'}]}});
  await new Promise(r=>setTimeout(r,30));
  assert.equal(store.approvals[1].status,'pending');
  assert.equal(events.some(event=>event.type==='approval.requested'&&event.approvalType==='question'),true);
 }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
test('custom permissions read profile, structured policy and workspace restrictions without writing config',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-permissions-')),previous=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
 const text='profile = "test"\nsandbox_mode = "danger-full-access"\n[profiles.test]\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n[sandbox_workspace_write]\nnetwork_access = false\nwritable_roots = ["C:/workspace"]\nexclude_tmpdir_env_var = true\n';
 try{await fs.writeFile(path.join(home,'config.toml'),text);const p=await readCustomPermissions();assert.equal(p.sandbox,'workspace-write');assert.equal(p.approvalPolicy,'on-request');assert.equal(p.sandboxPolicy.networkAccess,false);assert.deepEqual(p.sandboxPolicy.writableRoots,['C:/workspace']);assert.equal(p.sandboxPolicy.excludeTmpdirEnvVar,true);assert.equal(await fs.readFile(path.join(home,'config.toml'),'utf8'),text);}finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
