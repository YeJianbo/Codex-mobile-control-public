import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerMobileAssistant,mobileAssistantDetail,mobileAssistantCatalog} from '../src/services/mobileAssistant.ts';

test('assistant projection preserves task content and actual unavailable executors',()=>{
  const detail={tool:'write_file',path:'result.md',content:'完整待审批文件正文'},result={output:'完整执行结果',exitCode:0};
  const response=mobileAssistantDetail({token:'never-forward',task:{id:'task-id-123',title:'任务',text:'真实任务内容',token:'never-forward'},history:{status:'command_unknown',events:[{eventId:'e1',type:'tool.completed',result}],unconfirmedCommands:[{pid:42,command:'fixture-command',cwd:'fixture'}]},approvals:[{id:'approval-1',approvalType:'file',detail}]});
  assert.equal(response.token,undefined);assert.equal(response.task.token,undefined);
  assert.deepEqual(response.approvals[0].detail,detail);assert.deepEqual(response.history.events[0].result,result);
  assert.equal(response.history.unconfirmedCommands[0].pid,42);
  const catalog=mobileAssistantCatalog({models:[],backends:[{executor:'gateway',agent:'antigravity',name:'AGY',available:false,reason:'ACP 尚未认证',token:'never-forward'}]});
  assert.equal(catalog.backends[0].reason,'ACP 尚未认证');assert.equal(catalog.backends[0].token,undefined);
});

test('mobile endpoints use fixed local routes and strict request schemas',async()=>{
  const calls=[];const app=Fastify();
  const client={async managementRequest(route,body){calls.push({route,body});return {task:{id:'task-id-123',state:'accepted'},history:{events:[]},approvals:[],models:[],projects:[],tasks:[]};}};
  registerMobileAssistant(app,client);
  try{
    const root='/api/mobile-management/assistant';
    for(const path of ['/catalog','/projects','/tasks','/tasks/task-id-123'])assert.equal((await app.inject({url:root+path})).statusCode,200);
    const created=await app.inject({method:'POST',url:root+'/tasks',payload:{requestId:'request-id-123',executor:'internal-engine',model:'gpt-6.1-sol',projectPath:'fixture',text:'fixture only'}});
    assert.equal(created.statusCode,200);assert.equal(calls.at(-1).route,'/api/personal-assistant/tasks');
    const allowed=await app.inject({method:'POST',url:root+'/tasks/task-id-123/approve',payload:{approvalId:'approval-1',answers:{question1:{answers:['fixture answer']}}}});
    assert.equal(allowed.statusCode,200);assert.equal(calls.at(-1).route,'/api/personal-assistant/tasks/task-id-123/approve');
    const before=calls.length;
    for(const payload of [{approvalId:'approval-1',decision:'accept',route:'/api/anything'},{approvalId:'approval-1',decision:'accept',answers:{}}])assert.equal((await app.inject({method:'POST',url:root+'/tasks/task-id-123/approve',payload})).statusCode,400);
    assert.equal(calls.length,before);
  }finally{await app.close();}
});

test('unknown command stop remains unconfirmed and accepts no arbitrary flags',async()=>{
  const app=Fastify();let calls=0;
  registerMobileAssistant(app,{async managementRequest(){calls++;return {ok:false,status:'command_unknown',message:'旧命令可能仍在运行'};}});
  try{
    const url='/api/mobile-management/assistant/tasks/task-id-123/stop';
    const response=await app.inject({method:'POST',url,payload:{}});
    assert.equal(response.statusCode,200);assert.equal(response.json().ok,false);assert.equal(response.json().status,'command_unknown');
    assert.equal((await app.inject({method:'POST',url,payload:{force:true}})).statusCode,400);assert.equal(calls,1);
  }finally{await app.close();}
});
