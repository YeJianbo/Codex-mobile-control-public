import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {readPartialPickerCatalog} from '../src/services/modelCatalog.ts';
import {registerModelDirectory} from '../src/routes/modelDirectory.ts';
import {AgentSessions} from '../src/services/agentSessions.ts';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-model-directory-'));
const before={CODEX_HOME:process.env.CODEX_HOME,CODEX_MOBILE_CONTROL_AGENTS:process.env.CODEX_MOBILE_CONTROL_AGENTS};
process.env.CODEX_HOME=home;
process.env.CODEX_MOBILE_CONTROL_AGENTS='antigravity';
after(async()=>{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(home,{recursive:true,force:true});});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('partial Codex reads share work, finish without a slow source, and retain success on failure',async()=>{
  const gate=deferred();let reads=0;
  const codex={request:async()=>{reads++;return gate.promise;}};
  const result=await readPartialPickerCatalog(codex);
  assert.equal(result.pending,true);assert.deepEqual(result.models,[]);assert.equal(reads,1);
  gate.resolve({data:[{model:'gpt-6.1-sol',displayName:'Sol',supportedReasoningEfforts:[]}]});
  const complete=await readPartialPickerCatalog(codex);
  assert.equal(complete.pending,false);assert.equal(complete.models[0].harness,'codex');assert.equal(reads,1);
  codex.request=async()=>{throw Error('provider offline');};
  const failure=await readPartialPickerCatalog(codex,true);
  assert.equal(failure.pending,false);assert.equal(failure.models[0].model,'gpt-6.1-sol');assert.match(failure.error,/offline/);
  assert.equal((await readPartialPickerCatalog(codex)).pending,false);
});

test('a slow Harness cannot block the Codex picker; later polls include the completed Harness',async()=>{
  const gate=deferred();let reads=0;
  const discover=async(_command,args)=>{
    if(args[0]==='models'){reads++;await gate.promise;return {exitCode:0,stdout:'gemini-4-flash-high\tGemini 4 Flash (High)',stderr:''};}
    return {exitCode:0,stdout:'{}',stderr:''};
  };
  const agents=new AgentSessions({}, {publish(){}},undefined,discover,undefined,async()=>({command:'fixture-agy',source:'fixture'}));
  const codex={request:async()=>({data:[{model:'gpt-6.1-sol',displayName:'Sol',supportedReasoningEfforts:[]}]})};
  const app=Fastify();registerModelDirectory(app,codex,agents,undefined);
  try{
    const started=performance.now();
    const first=(await app.inject('/api/models?agents=all&partial=1')).json();
    assert(performance.now()-started<2000,'partial directory exceeded its bounded HTTP wait');
    assert(first.models.some(model=>model.model==='gpt-6.1-sol'));
    assert.deepEqual(first.pending,['antigravity']);assert.equal(reads,1);
    gate.resolve();await agents.models();
    const final=(await app.inject('/api/models?agents=all&partial=1')).json();
    assert.deepEqual(final.pending,[]);assert.equal(reads,1);
    assert(final.models.some(model=>model.model==='antigravity::gemini-4-flash'));
    assert(final.models.some(model=>model.model==='gpt-6.1-sol'));
    assert.deepEqual((await app.inject('/api/models?agents=all')).json().models,final.models);
  }finally{gate.resolve();await agents.close();await app.close();}
});
