import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {configurePublicAgentAccess} from '../src/services/agentProtocol.ts';
const fixtureExecutable=async agent=>({command:agent==='antigravity'?'agy':agent,source:'path'});


function fixture(t,terminate){
  const threads=[],metadata=new Map(),events=[],runs=[],approvals=new Map(),resolved=[];
  const store={threads,readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,v)=>metadata.set(id,structuredClone(v)),async upsertThread(v){let row=threads.find(x=>x.id===v.id);if(row)Object.assign(row,v);else threads.push(row={...v});return row;},async addApproval(v){approvals.set(v.id,v);},async resolveApproval(id,decision){resolved.push({id,decision});approvals.delete(id);}};
  const launch=(command,args,options)=>{
    let resolve;const done=new Promise(r=>resolve=r),stdout=new PassThrough(),stderr=new PassThrough(),stdin=new PassThrough();let closed=false;const inputs=[];stdin.on('data',v=>inputs.push(v.toString()));
    const child={stdout,stderr,stdin,then:done.then.bind(done),line(v){stdout.write(JSON.stringify(v)+'\n');},finish(exitCode=0){if(closed)return;closed=true;stdout.end();stderr.end();resolve({exitCode});},kill(){this.finish(1);}};
    runs.push({command,args,options,child,inputs});return child;
  };
  const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch,undefined,terminate,fixtureExecutable);
  manager.models=async()=>[{model:'claude::default'},{model:'antigravity::default'}];
  const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'Fixture condition did not settle');};
  const settle=()=>wait(()=>threads.every(row=>!manager.owns(row.id)));
  const start=(extra={})=>manager.handle({type:'thread.start',model:'claude::default',permission:'ask',initialText:'fixture',...extra});
  const complete=(run,session='mock-session')=>{run.child.line({type:'result',session_id:session,result:'fixture complete',is_error:false});run.child.finish();};
  t.after(async()=>{for(const run of runs)run.child.finish(1);await settle();});
  return {manager,store,threads,metadata,events,runs,approvals,resolved,wait,settle,start,complete};
}

test('AGY rejects ask and omitted permissions before creating any visible task',async t=>{
  const f=fixture(t);
  for(const permission of ['ask',undefined])await assert.rejects(f.start({model:'antigravity::default',permission}),/无逐条审批能力/);
  assert.equal(f.threads.length,0);assert.equal(f.runs.length,0);assert.deepEqual(f.events,[]);
  await f.start({model:'antigravity::default',permission:'auto'});assert.ok(f.runs[0].args.includes('accept-edits'));assert.ok(!f.runs[0].args.includes('--dangerously-skip-permissions'));
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'fixture complete'}});f.runs[0].child.finish();await f.settle();
});

test('Claude maps each explicit permission and structured stdin without reading configuration',async t=>{
  const f=fixture(t);
  for(const [permission,mode] of [['ask','default'],['auto','acceptEdits'],['full','bypassPermissions']]){
    await f.start({permission});const run=f.runs.at(-1);
    assert.equal(run.command,'claude');assert.equal(run.args[run.args.indexOf('--permission-mode')+1],mode);assert.equal(run.args[run.args.indexOf('--permission-prompt-tool')+1],'stdio');
    assert.equal(JSON.parse(run.inputs[0]).message.content[0].text,'fixture');f.complete(run);await f.settle();
  }
});

test('Claude tool approval preserves request identity and can be allowed or denied',async t=>{
  for(const decision of ['accept','decline']){
    const f=fixture(t);await f.start();const run=f.runs[0];
    run.child.line({type:'control_request',request_id:'request-'+decision,request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'fixture.txt'}}});
    await f.wait(()=>f.approvals.size===1);const approval=[...f.approvals.values()][0];assert.equal(approval.title,'Read');
    await f.manager.resolveApproval(approval.id,decision);await f.wait(()=>run.inputs.length===2);
    const reply=JSON.parse(run.inputs[1]);assert.equal(reply.response.request_id,'request-'+decision);assert.equal(reply.response.response.behavior,decision==='accept'?'allow':'deny');
    if(decision==='accept')assert.deepEqual(reply.response.response.updatedInput,{file_path:'fixture.txt'});
    f.complete(run);await f.settle();assert.equal(f.approvals.size,0);
  }
});

test('Claude unsupported control request has an explicit protocol error and no approval',async t=>{
  const f=fixture(t);await f.start();const run=f.runs[0];run.child.line({type:'control_request',request_id:'unsupported',request:{subtype:'unknown'}});
  await f.wait(()=>run.inputs.length===2);assert.equal(JSON.parse(run.inputs[1]).response.subtype,'error');assert.equal(f.approvals.size,0);f.complete(run);await f.settle();
});

test('Claude partial text, repeated assistant snapshots and final records do not duplicate output',async t=>{
  const f=fixture(t);await f.start();const child=f.runs[0].child;
  child.line({type:'stream_event',event:{delta:{type:'text_delta',text:'visible'}}});
  const assistant={type:'assistant',message:{id:'message-1',content:[{type:'thinking',thinking:'PRIVATE_FIXTURE_REASONING'},{type:'text',text:'visible'},{type:'tool_use',id:'tool-1',name:'Read',input:{file_path:'fixture.txt'}}]}};
  child.line(assistant);child.line(assistant);child.line({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'fixture output',is_error:true}]}});
  const final={type:'result',session_id:'mock-session',result:'visible',usage:{input_tokens:10,cache_read_input_tokens:3,output_tokens:2}};child.line(final);child.line(final);child.finish();await f.settle();
  assert.equal(f.events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),'visible');assert.equal(f.events.filter(e=>e.type==='tool.started').length,1);assert.equal(f.events.find(e=>e.type==='tool.completed').status,'error');assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE_FIXTURE_REASONING/);assert.equal(f.metadata.get(f.threads[0].id).tokens.total,15);
});

test('Claude resume after manager recreation retains session and selected effort',async t=>{
  const f=fixture(t);await f.start({effort:'high'});const id=f.threads[0].id;f.complete(f.runs[0],'persisted-fixture');await f.settle();
  const resumed=new AgentSessions(f.store,{publish:e=>f.events.push(e)},(...args)=>{const original=f.manager.launch;return original(...args);},undefined,undefined,fixtureExecutable);resumed.models=f.manager.models;
  await resumed.handle({type:'turn.start',threadId:id,permission:'ask',text:'continue'});const run=f.runs[1];assert.equal(run.args[run.args.indexOf('--resume')+1],'persisted-fixture');assert.equal(run.args[run.args.indexOf('--effort')+1],'high');
  f.complete(run);await f.wait(()=>!resumed.owns(id));assert.equal(f.metadata.get(id).effort,'high');
});

test('Claude cancellation declines pending tools, completes interrupted and permits recovery',async t=>{
  const f=fixture(t);await f.start();const id=f.threads[0].id,run=f.runs[0];run.child.line({type:'control_request',request_id:'waiting',request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'fixture.txt'}}});await f.wait(()=>f.approvals.size===1);
  await f.manager.handle({type:'turn.interrupt',threadId:id});await f.settle();assert.equal(f.threads[0].status,'interrupted');assert.equal(f.approvals.size,0);assert.equal(f.resolved[0].decision,'decline');assert.ok(!f.events.some(e=>e.type==='error'));
  await f.manager.handle({type:'turn.start',threadId:id,permission:'ask',text:'recovered'});f.complete(f.runs[1]);await f.settle();assert.equal(f.threads[0].status,'completed');
});

test('Claude missing or failed final result remains an error with useful output',async t=>{
  for(const record of [undefined,{type:'result',is_error:true,errors:['fixture provider unavailable']}]){
    const f=fixture(t);await f.start();const child=f.runs[0].child;child.stdout.write('malformed fixture line\n');if(record)child.line(record);child.finish();await f.settle();assert.equal(f.threads[0].status,'error');assert.ok(f.events.some(e=>e.type==='error'&&e.message));
  }
});

test('Claude concurrent continuation launches one process and rejects cross-agent models',async t=>{
  const f=fixture(t);await f.start();const id=f.threads[0].id;f.complete(f.runs[0]);await f.settle();
  const results=await Promise.allSettled(['one','two'].map(text=>f.manager.handle({type:'turn.start',threadId:id,permission:'ask',text})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.runs.length,2);await assert.rejects(f.manager.validate('antigravity::default',id));f.complete(f.runs[1]);await f.settle();
});

test('Failed Windows process termination preserves running state and can be retried', {skip:process.platform!=='win32'},async t=>{
  let attempts=0;
  const f=fixture(t,async()=>({exitCode:++attempts===1?1:0}));await f.start();
  const id=f.threads[0].id,child=f.runs[0].child;child.pid=123;child.exitCode=null;
  await assert.rejects(f.manager.handle({type:'turn.interrupt',threadId:id}),/停止失败/);
  assert.equal(f.manager.active.get(id).stopped,false);assert.equal(f.manager.owns(id),true);
  assert.equal(f.events.filter(e=>e.type==='turn.completed').length,0);
  await f.manager.handle({type:'turn.interrupt',threadId:id});child.finish(1);await f.settle();
  assert.equal(f.threads[0].status,'interrupted');assert.equal(attempts,2);
});

test('Claude AskUserQuestion uses question replies rather than a generic allow button',async t=>{
 const f=fixture(t);await f.start();const run=f.runs[0];
 run.child.line({type:'control_request',request_id:'question-1',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{header:'颜色',question:'选择颜色？',options:[{label:'蓝色',description:'蓝色主题'},{label:'绿色',description:'绿色主题'}]}]}}});
 await f.wait(()=>f.approvals.size===1);const approval=[...f.approvals.values()][0];assert.equal(approval.approvalType,'question');
 await assert.rejects(f.manager.resolveApproval(approval.id,'accept'),/填写问题/);
 await assert.rejects(f.manager.answerQuestions(approval.id,{}),/回答所有问题/);
 await f.manager.answerQuestions(approval.id,{q0:{answers:['蓝色']}});await f.wait(()=>run.inputs.length===2);
 assert.deepEqual(JSON.parse(run.inputs[1]).response.response.updatedInput.answers,{'选择颜色？':'蓝色'});
 assert.equal(f.events.find(e=>e.questionReplyId===approval.id).questionReplies[0].answer,'蓝色');
 f.complete(run);await f.settle();assert.equal(f.approvals.size,0);
});

test('Stopping Claude cancels pending user questions and does not auto-answer',async t=>{
 const f=fixture(t);await f.start();const run=f.runs[0];
 run.child.line({type:'control_request',request_id:'question-stop',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Choose?'}]}}});
 await f.wait(()=>f.approvals.size===1);await f.manager.handle({type:'turn.interrupt',threadId:f.threads[0].id});await f.settle();
 assert.equal(f.approvals.size,0);assert.equal(f.resolved[0].decision,'decline');assert(!f.events.some(e=>e.questionReplies));
});

test('Claude plan mode is passed to the CLI even with auto or full permission selected',async t=>{
 const f=fixture(t);
 for(const permission of ['auto','full']){await f.start({mode:'plan',permission});const run=f.runs.at(-1);assert.equal(run.args[run.args.indexOf('--permission-mode')+1],'plan');f.complete(run);await f.settle();}
});

test('Windows taskkill exit race waits for the owned process instead of reporting a false stop failure', {skip:process.platform!=='win32'},async t=>{
  let child;
  const f=fixture(t,async()=>{setTimeout(()=>child.finish(1),40);return {exitCode:128,stderr:'process already exiting'}});
  await f.start();child=f.runs[0].child;child.pid=123;child.exitCode=null;
  await f.manager.handle({type:'turn.interrupt',threadId:f.threads[0].id});await f.settle();
  assert.equal(f.threads[0].status,'interrupted');assert.equal(f.manager.owns(f.threads[0].id),false);
});

test('backend-reported model is persisted independently of CLI brand and restored after completion',async t=>{
 const f=fixture(t);await f.start();const id=f.threads[0].id;
 f.runs[0].child.line({type:'assistant',message:{id:'observed',model:'grok-4.7',content:[{type:'text',text:'fixture'}]}});
 f.complete(f.runs[0]);await f.settle();assert.equal(f.manager.settings(id).model,'claude::default');assert.equal(f.manager.settings(id).actualModel,'grok-4.7');
});
test('unavailable executable fails before visible thread creation and launch',async t=>{
 const f=fixture(t);f.manager.locate=async()=>{throw Error('CLI 路径无效')};
 await assert.rejects(f.start(),/路径无效/);assert.equal(f.threads.length,0);assert.equal(f.runs.length,0);
});
test('public capability metadata allows Claude by default and an explicit disable still refuses',async t=>{
 const f=fixture(t);f.manager.executables.set('claude',{command:'claude',source:'path'});
 configurePublicAgentAccess();
 try{
  const local=(await f.manager.backends()).find(x=>x.agent==='claude');assert.equal(local.available,true);assert.equal(local.accountStatus,'not-checked');
  const remote=(await f.manager.backends(true)).find(x=>x.agent==='claude');assert.equal(remote.available,true);assert.equal(remote.publicAllowed,true);
  configurePublicAgentAccess({claude:false});
  const disabled=(await f.manager.backends(true)).find(x=>x.agent==='claude');assert.equal(disabled.available,false);assert.equal(disabled.publicAllowed,false);assert.match(disabled.reason,/公网/);
  const lan=(await f.manager.backends()).find(x=>x.agent==='claude');assert.equal(lan.available,true);
 }finally{configurePublicAgentAccess();}
});
