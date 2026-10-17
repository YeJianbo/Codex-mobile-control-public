import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentCatalog} from '../src/services/agentCatalog.ts';

test('Claude catalog only sends an initialize control request and keeps aliases distinct from actual model names',async()=>{
 const catalog=await readAgentCatalog('claude','configured-claude',async(command,args,options)=>{
  assert.equal(command,'configured-claude');assert(!args.includes('models'));assert.deepEqual(JSON.parse(options.input).request,{subtype:'initialize'});
  return {stdout:JSON.stringify({type:'control_response',response:{request_id:'catalog',response:{models:[{value:'default',supportedEffortLevels:['low','high']},{value:'sonnet',displayName:'old-custom-name',resolvedModel:'grok-fixture',supportedEffortLevels:['high','max']}]}}})};
 });
 assert.deepEqual(catalog.models.map(m=>m.model),['claude::default','claude::sonnet']);
 assert.match(catalog.models[1].displayName,/sonnet · grok-fixture/);assert.doesNotMatch(catalog.models[1].displayName,/old-custom-name/);
 assert.deepEqual(catalog.models[1].supportedReasoningEfforts,[{reasoningEffort:'high'},{reasoningEffort:'max'}]);
});

test('Grok catalog reads declared image capability and model-specific effort without creating a session',async()=>{
 const catalog=await readAgentCatalog('grok','configured-grok',async(command,args,options)=>{
  assert.equal(JSON.parse(options.input).method,'initialize');
  return {stdout:JSON.stringify({id:1,result:{agentCapabilities:{promptCapabilities:{image:false}},_meta:{modelState:{currentModelId:'model-a',availableModels:[{modelId:'model-a',name:'Model A',_meta:{reasoningEffort:'medium',reasoningEfforts:[{id:'low'},{id:'medium'}]}}]}}}})};
 });
 assert.equal(catalog.supportsImages,false);assert.equal(catalog.models[0].model,'grok::default');assert.equal(catalog.models[0].defaultReasoningEffort,'medium');
 assert.deepEqual(catalog.models[1].supportedReasoningEfforts,[{reasoningEffort:'low'},{reasoningEffort:'medium'}]);
});

test('Malformed or unsupported handshakes allow the existing catalog fallback',async()=>{
 for(const agent of ['claude','grok'])assert.deepEqual((await readAgentCatalog(agent,'fixture',async()=>({stdout:'unstructured\n{}\n'}))).models,[]);
});
