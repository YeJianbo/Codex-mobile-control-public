import test from 'node:test';
import assert from 'node:assert/strict';
import {agentUpdates,modelAgent,threadAgent} from '../src/services/agentProtocol.ts';
test('agent routing never changes an existing Codex thread',()=>{
  assert.equal(modelAgent('antigravity::claude-sonnet-4-6'),'antigravity');
  assert.equal(threadAgent('01a07e7c-abc'),'codex');
  assert.equal(threadAgent('claude-123'),'claude');
});
test('AGY streams public text and tool lifecycle, excluding internal steps',()=>{
  assert.deepEqual(agentUpdates('antigravity',{event:'step_update',step_update:{step_type:'thinking',text_delta:'hidden'}}),[]);
  assert.equal(agentUpdates('antigravity',{event:'step_update',step_update:{step_type:'agent_response',step_index:3,text_delta:'hello'}})[0].text,'hello');
  assert.deepEqual(agentUpdates('antigravity',{event:'step_update',step_update:{step_type:'tool',step_index:4,state:'DONE',tool_name:'read',tool_info:{output:'value'}}}).map(e=>e.kind),['tool','output','complete']);
});
test('Claude and Grok messages preserve tool ids and failures without exposing thinking',()=>{
  for(const agent of ['claude','grok']){
    const events=agentUpdates(agent,{type:'assistant',message:{id:'m',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'visible'},{type:'tool_use',id:'t',name:'Read',input:{path:'a'}}]}});
    assert.equal(events.length,2);assert.equal(events[1].id,'t');
    assert.equal(agentUpdates(agent,{type:'result',is_error:true,result:'denied'})[0].error,true);
  }
});
