import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {readModelCatalog,consoleModelOverrides,consoleResumeOverrides} from '../src/services/modelCatalog.ts';
import {registerThreadFast} from '../src/services/threadFast.ts';
import {writeUserSettings} from '../src/services/codexSettings.ts';
import {SessionManager} from '../src/services/sessionManager.ts';

async function fixture(run){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'console-relay-'));
  const previous={CODEX_HOME:process.env.CODEX_HOME,CODEX_MOBILE_CONTROL_HOME:process.env.CODEX_MOBILE_CONTROL_HOME};
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const directory=path.join(home,'codexmate','local-console');await fs.mkdir(directory,{recursive:true});
  const model=(slug,visibility='list')=>({slug,visibility,display_name:slug,supported_reasoning_levels:[{effort:'low'}],default_reasoning_level:'low'});
  const official=model('official-fixture'),relay=model('relay_fixture::model'),hidden=model('relay_fixture::hidden','hide');
  await fs.writeFile(path.join(directory,'official.json'),JSON.stringify({models:[official]}));
  await fs.writeFile(path.join(directory,'relay-model-catalog.json'),JSON.stringify({models:[relay,hidden]}));
  await fs.writeFile(path.join(directory,'model-catalog.json'),JSON.stringify({models:[official,relay,hidden]}));
  const text=`model = "official-fixture"\nmodel_provider = "existing_official"\nmodel_catalog_json = ${JSON.stringify(path.join(directory,'official.json'))}\n[model_providers.existing_relay]\nbase_url = "http://127.0.0.1:25819/relay/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`;
  const configFile=path.join(home,'config.toml');await fs.writeFile(configFile,text);
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,model TEXT,reasoning_effort TEXT)');
  try{await run({home,directory,configFile,text,db});}
  finally{
    db.close();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await fs.rm(home,{recursive:true,force:true});
  }
}

test('console catalog combines enabled relay aliases with native models without rewriting desktop configuration',async()=>fixture(async f=>{
  const rpc={request:()=>assert.fail('native discovery should not be needed')};
  const catalog=await readModelCatalog(rpc);
  assert.deepEqual(catalog.models.map(m=>m.model),['official-fixture','relay_fixture::model']);
  assert.deepEqual(await consoleModelOverrides(rpc,'official-fixture'),{});
  assert.deepEqual(await consoleModelOverrides(rpc,'relay_fixture::model'),{modelProvider:'existing_relay',config:{model_catalog_json:path.join(f.directory,'model-catalog.json')}});
  await assert.rejects(consoleModelOverrides(rpc,'relay_fixture::hidden'),/尚未启用/);
  await assert.rejects(writeUserSettings({model:'relay_fixture::model'}),/新会话/);
  assert.equal(await fs.readFile(f.configFile,'utf8'),f.text);
}));

test('new relay threads and resumed relay threads retain their provider; source changes require a new conversation',async()=>fixture(async f=>{
  const rpc=new EventEmitter(),calls=[],threads=[];
  rpc.request=async(method,params)=>{
    calls.push({method,params});
    if(method==='thread/start'){
      const id=params.model.includes('::')?'relay-thread':'official-thread';
      f.db.prepare('INSERT INTO threads VALUES(?,?,?)').run(id,params.model,'low');return {thread:{id},model:params.model};
    }
    if(method==='thread/resume')return {thread:{id:params.threadId,status:{type:'idle'}}};
    assert.fail('unexpected RPC '+method);
  };
  const store={threads,approvals:[],eventsForThread:()=>[],upsertThread:async row=>{const entry={...row,title:row.title||'fixture'};threads.push(entry);return entry;}};
  const manager=new SessionManager(rpc,{publish:()=>{}},store);
  await manager.handleClientCommand({type:'thread.start',model:'official-fixture',projectPath:f.home});
  assert.equal(calls[0].params.modelProvider,undefined);
  await manager.handleClientCommand({type:'thread.start',model:'relay_fixture::model',projectPath:f.home});
  assert.equal(calls[1].params.modelProvider,'existing_relay');assert.equal(calls[1].params.config.model_catalog_json,path.join(f.directory,'model-catalog.json'));
  const resumed=new SessionManager(rpc,{publish:()=>{}},store);await resumed.resumeThread('relay-thread');
  assert.equal(calls[2].method,'thread/resume');assert.equal(calls[2].params.modelProvider,'existing_relay');assert.equal(calls[2].params.model,'relay_fixture::model');
  const count=calls.length;
  await assert.rejects(resumed.handleClientCommand({type:'turn.start',threadId:'relay-thread',model:'official-fixture',text:'must not send'}),/新建会话/);
  assert.equal(calls.length,count);assert.equal(await fs.readFile(f.configFile,'utf8'),f.text);
}));

test('speed readback restores the saved relay provider instead of the desktop default',async()=>fixture(async f=>{
  f.db.prepare('INSERT INTO threads VALUES(?,?,?)').run('relay-thread','relay_fixture::model','low');
  const calls=[],rpc={request:async(method,params)=>{calls.push({method,params});return {serviceTier:'default'};}};
  const route=await consoleResumeOverrides(rpc,'relay-thread');assert.equal(route.modelProvider,'existing_relay');
  assert.deepEqual(await consoleResumeOverrides(rpc,'unknown-native-thread'),{});
  const app=Fastify();registerThreadFast(app,rpc,async()=>{});
  try{
    const response=await app.inject('/api/threads/relay-thread/fast');assert.equal(response.statusCode,200);
    assert.equal(calls[0].method,'thread/resume');assert.equal(calls[0].params.modelProvider,'existing_relay');assert.equal(calls[0].params.model,'relay_fixture::model');
  }finally{await app.close();}
}));
