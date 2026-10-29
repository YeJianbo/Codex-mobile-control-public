import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import Fastify from 'fastify';
import {SessionManager} from '../src/services/sessionManager.ts';
import {registerThreadToolsRoutes} from '../src/services/threadToolsRoutes.ts';

const parent='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
function fixture(){
  const requests=[],events=[],codex=new EventEmitter();
  codex.request=async(method,params)=>{
    requests.push({method,params});
    if(method==='thread/fork'){
      if(params.ephemeral&&params.deferGoalContinuation)throw Error('`deferGoalContinuation` cannot be combined with `ephemeral`');
      return {thread:{id:child,ephemeral:params.ephemeral,cwd:'F:/fixture'},model:'fixture'};
    }
    if(method.startsWith('thread/goal/')&&params.threadId===child)throw Error('ephemeral thread does not support goals');
    if(method==='thread/backgroundTerminals/list')return {data:[{processId:'p1',command:'fixture',cwd:'F:/fixture',itemId:'item'}],nextCursor:null};
    return {terminated:true};
  };
  const store={threads:[{id:parent,title:'主任务',projectPath:'F:/fixture',status:'running'}],approvals:[],
    isEphemeral(id){return this.threads.some(thread=>thread.id===id&&thread.ephemeral)},
    dropEphemeral(id){this.threads=this.threads.filter(thread=>thread.id!==id)},
    async upsertThread(thread){const row={...this.threads.find(t=>t.id===thread.id),...thread};this.threads=this.threads.filter(t=>t.id!==thread.id);this.threads.push(row);return row;}};
  const sessions=new SessionManager(codex,{publish:event=>events.push(event)},store);
  return {requests,events,codex,store,sessions};
}

test('side fork inherits context without unsupported goal options and leaves the running parent alone',async()=>{
  const f=fixture();
  const result=await f.sessions.forkThread(parent,{ephemeral:true});
  assert.equal(result.thread.id,child);assert.equal(result.thread.ephemeral,true);assert.equal(result.thread.forkedFromId,parent);
  assert.equal(f.store.threads.find(t=>t.id===parent).status,'running');
  assert.deepEqual(f.requests,[{method:'thread/fork',params:{threadId:parent,ephemeral:true,excludeTurns:true}}]);
  await f.sessions.closeSideThread(child);
  assert.equal(f.requests.at(-1).method,'thread/unsubscribe');assert.equal(f.requests.some(r=>r.method==='turn/interrupt'&&r.params.threadId===parent),false);
  assert.equal(f.store.isEphemeral(child),false);
});

test('persistent forks honor the chosen completed turn without changing configuration',async()=>{
  const f=fixture();
  await f.sessions.forkThread(parent,{ephemeral:false,lastTurnId:'turn-5'});
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].params.lastTurnId,'turn-5');
  assert.equal(f.requests[0].params.model,undefined);assert.equal(f.requests[0].params.approvalPolicy,undefined);
  assert.equal(f.requests[0].params.deferGoalContinuation,true);
  assert.equal(f.store.threads.find(t=>t.id===child).title,'主任务 · 分支');
});

test('terminal controls enforce thread authorization before reaching Codex and preserve opaque process IDs',async()=>{
  const f=fixture(),app=Fastify();
  registerThreadToolsRoutes(app,{...f,authorize:async(_request,id)=>{if(id!==parent)throw Object.assign(Error('denied'),{statusCode:403})}});
  try{
    const list=await app.inject({method:'GET',url:`/api/threads/${parent}/background-terminals`});assert.equal(list.statusCode,200);assert.equal(list.json().data[0].processId,'p1');
    const stop=await app.inject({method:'POST',url:`/api/threads/${parent}/background-terminals/terminate`,payload:{processId:'opaque/process-id'}});assert.equal(stop.statusCode,200);
    assert.deepEqual(f.requests.at(-1),{method:'thread/backgroundTerminals/terminate',params:{threadId:parent,processId:'opaque/process-id'}});
    const before=f.requests.length;
    assert.equal((await app.inject({method:'POST',url:`/api/threads/${child}/background-terminals/terminate`,payload:{processId:'p1'}})).statusCode,403);
    assert.equal(f.requests.length,before);
  }finally{await app.close()}
});
