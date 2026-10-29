import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteAgentSessions} from '../src/services/remoteAgentSessions.ts';

function fixture(){
  const clients=new Map(),calls=[],published=[];
  const factory=(event,running,created,scope)=>{
    const client={outdated:!scope,connected:false,runningIds:new Set(),event,running,created,
      async connect(){this.connected=true;},
      async request(method,params){
        this.connected=true;calls.push({scope,method,params});
        const models=scope?[{model:'zcode::account/GLM-5.3'}]:[{model:'antigravity::gemini'},{model:'zcode::old/model'}];
        const backends=scope?[{agent:'zcode',available:true,activeCount:0}]:[{agent:'antigravity',available:true,activeCount:1},{agent:'zcode',available:false,activeCount:0}];
        if(method==='models')return models;
        if(method==='backends'||method==='health')return backends;
        if(method==='pickerCatalog')return {models,backends,pending:[]};
      },
      async restartIfIdle(){},close(){this.connected=false;},
    };
    clients.set(scope,client);return client;
  };
  const remote=new RemoteAgentSessions(event=>published.push(event),factory);
  return {remote,clients,calls,published};
}

test('old primary keeps its AGY task while current ZCode handles models, sends and approvals',async()=>{
  const {remote,clients,calls}=fixture(),primary=clients.get(''),current=clients.get('zcode');
  try{
    await remote.ready();primary.running(['antigravity-running']);
    const picker=await remote.pickerCatalog(true);
    assert.deepEqual(picker.models.map(row=>row.model),['antigravity::gemini','zcode::account/GLM-5.3']);
    assert.equal(picker.backends.find(row=>row.agent==='zcode').available,true);
    assert.equal((await remote.backends()).find(row=>row.agent==='zcode').available,true);
    assert.equal((await remote.health()).find(row=>row.agent==='antigravity').activeCount,1);
    current.running(['zcode-running']);
    assert.ok(remote.owns('antigravity-running'));assert.ok(remote.owns('zcode-running'));
    await remote.handle({type:'turn.start',model:'zcode::account/GLM-5.3'});
    assert.equal(calls.at(-1).scope,'zcode');
    await remote.handle({type:'turn.interrupt',threadId:'antigravity-running'});
    assert.equal(calls.at(-1).scope,'');
    current.event({type:'approval.requested',threadId:'zcode-running',approvalId:'approval-zcode'});
    await remote.resolveApproval('approval-zcode','accept');assert.equal(calls.at(-1).scope,'zcode');
    current.event({type:'approval.requested',threadId:'zcode-running',approvalId:'question-zcode',approvalType:'question'});
    await remote.answerQuestions('question-zcode',{q0:{answers:['继续']}});assert.equal(calls.at(-1).scope,'zcode');
    primary.event({type:'thread.started',threadId:'zcode-desktop',thread:{status:'running'}});
    assert.equal(remote.owns('zcode-desktop'),false);
  }finally{await remote.close();}
});

test('upgraded primary receives new tasks while an existing scoped task finishes on its owner',async()=>{
  const {remote,clients,calls}=fixture(),primary=clients.get(''),current=clients.get('zcode');
  try{
    await remote.ready();current.running(['zcode-running']);current.connected=true;primary.outdated=false;
    await remote.models();assert.equal(current.connected,true);
    await remote.handle({type:'turn.interrupt',threadId:'zcode-running'});assert.equal(calls.at(-1).scope,'zcode');
    await remote.handle({type:'turn.start',model:'zcode::account/GLM-5.3'});assert.equal(calls.at(-1).scope,'');
    current.event({type:'turn.completed',threadId:'zcode-running',status:'completed'});
    await remote.models();assert.equal(current.connected,false);
  }finally{await remote.close();}
});
