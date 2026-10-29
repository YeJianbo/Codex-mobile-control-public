import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {harnessAcp,readHarnessCatalog} from '../src/services/harnessAcp.ts';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';

function fixture(agent,{cancel=false,newSessionError,configError,permissionAdapterReady=true,extraModels=[]}={}){
  const requests=[],stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
  const model=agent==='deepseek'?'[{"provider":"deepseek-official","model":"deepseek::flash"}]':'openrouter:example/model';
  let finish,promptId,closed=false;
  const done=new Promise(resolve=>finish=resolve);
  const child={stdin,stdout,stderr,then:done.then.bind(done),kill(){closed=true;stdout.end();stderr.end();finish({exitCode:0});return true;}};
  stdin.on('finish',()=>child.kill());
  const reply=message=>stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const update=value=>reply({method:'session/update',params:{sessionId:'saved-session',update:value}});
  stdin.on('data',data=>{for(const line of data.toString().trim().split('\n')){
    const message=JSON.parse(line);requests.push(message);
    queueMicrotask(()=>{
      if(message.method==='initialize'){if(agent==='deepseek'&&permissionAdapterReady)stderr.write('CMC_DSH_PERMISSION_ADAPTER_READY\n');reply({id:message.id,result:{agentCapabilities:{promptCapabilities:{image:true}}}});}
      else if(['session/new','session/resume','session/load'].includes(message.method)){
        if(newSessionError){reply({id:message.id,error:{code:-32603,message:'Internal error',data:{details:newSessionError}}});return;}
        update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old history'}});
        reply({id:message.id,result:{sessionId:'saved-session',configOptions:agent==='deepseek'?[{id:'model',category:'model',currentValue:model,options:[{name:'Provider',options:[{value:model,name:'Flash'},...extraModels]}]}]:[],models:{currentModelId:model,availableModels:[{modelId:model,name:'Example'}]}}});
      }else if(message.method==='session/set_config_option'){
        if(configError){reply({id:message.id,error:{code:-32602,message:configError}});return;}
        reply({id:message.id,result:{configOptions:[{id:'reasoning_effort',category:'thought_level',currentValue:message.params.configId==='reasoning_effort'?message.params.value:'off',options:['off','low','medium','high','max'].map(value=>({value,name:value}))}]}});
      }else if(message.method==='session/prompt'){
        promptId=message.id;if(cancel)return;
        update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private reasoning'}});
        update({sessionUpdate:'tool_call',toolCallId:'edit',kind:'edit',title:'Write',rawInput:{file_path:'result.txt'},locations:[{path:'result.txt'}],status:'in_progress'});
        reply({id:500,method:'session/request_permission',params:{toolCall:{toolCallId:'edit'},options:[{optionId:'allow',kind:'allow_once'},{optionId:'reject',kind:'reject_once'}]}});
      }else if(message.id===500){
        assert.equal(message.result.outcome.optionId,'allow');
        update({sessionUpdate:'tool_call_update',toolCallId:'edit',status:'completed',content:[{type:'content',content:{type:'text',text:'written'}}]});
        for(const text of ['hello ','world'])update({sessionUpdate:'agent_message_chunk',content:{type:'text',text}});
        reply({id:promptId,result:{stopReason:'end_turn',usage:{inputTokens:7,outputTokens:2}}});
      }else if(message.method==='session/cancel')reply({id:promptId,result:{stopReason:'cancelled'}});
      else if(message.id!==undefined)reply({id:message.id,result:{}});
    });
  }});
  return {model,requests,child,launch:()=>child,get closed(){return closed;},get promptId(){return promptId;}};
}

test('DeepSeek catalog sessions use disposable storage and never prompt',async()=>{
  const run=fixture('deepseek');let patchFile,storage;
  const launch=(command,args,options)=>{
    patchFile=args[args.indexOf('--patch')+1];
    const patch=JSON.parse(readFileSync(patchFile,'utf8'));
    storage=patch.find(entry=>entry.id==='session-persistence-jsonl')?.config.root;
    assert(storage?.startsWith(path.dirname(patchFile)+path.sep));
    assert.equal(patch.find(entry=>entry.id==='session-query-sqlite')?.config.path,':memory:');
    return run.launch(command,args,options);
  };
  await readHarnessCatalog('deepseek','fixture',process.cwd(),launch);
  assert(!existsSync(patchFile));assert(!existsSync(storage));
  assert(!run.requests.some(request=>request.method==='session/prompt'));
});

test('ACP publishes the native session before a configuration failure',async()=>{
  const run=fixture('deepseek',{configError:'model configuration failed'}),lines=[];
  const child=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),effort:'unsupported',content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  child.stdout.on('data',chunk=>lines.push(...chunk.toString().trim().split('\n').map(JSON.parse)));
  assert.equal((await child).exitCode,1);
  assert.equal(lines[0].session_id,'saved-session');
  assert(!run.requests.some(request=>request.method==='session/prompt'));
});

test('Hermes default reasoning does not require an unsupported config switch',async()=>{
  const run=fixture('hermes');
  const child=harnessAcp({agent:'hermes',command:'fixture',cwd:process.cwd(),effort:'default',content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  assert.equal((await child).exitCode,0);
  assert(run.requests.some(r=>r.method==='session/prompt'));
  assert(!run.requests.some(r=>r.method==='session/set_config_option'));
});
test('DeepSeek refuses to prompt when its native permission extension failed to mount',async()=>{
  const run=fixture('deepseek',{permissionAdapterReady:false});
  const child=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),permission:'ask',content:[{type:'text',text:'must not run'}],approve:async()=>false},run.launch);
  const result=await child;
  assert.equal(result.exitCode,1);
  assert(!run.requests.some(request=>request.method==='session/prompt'));
});

for(const agent of ['deepseek','hermes'])test(`${agent} uses its ACP dialect and retains text, permissions, opaque model IDs and usage`,async()=>{
  const discovery=fixture(agent);
  const catalog=await readHarnessCatalog(agent,'fixture',process.cwd(),discovery.launch);
  assert(catalog.models.some(model=>model.model===agent+'::'+discovery.model));assert.equal(catalog.supportsImages,true);assert(discovery.closed);
  const run=fixture(agent),lines=[];
  const adapter=harnessAcp({agent,command:'fixture',cwd:process.cwd(),session:'saved-session',model:run.model,permission:'auto',content:[{type:'text',text:'fixture'}],approve:async()=>{throw Error('Workspace edit should be allowed');}},run.launch);
  adapter.stdout.on('data',data=>lines.push(...data.toString().trim().split('\n').map(JSON.parse)));
  assert.equal((await adapter).exitCode,0);
  assert(run.requests.some(message=>message.method===(agent==='deepseek'?'session/resume':'session/load')));
  const selection=run.requests.find(message=>message.method===(agent==='deepseek'?'session/set_config_option':'session/set_model'));
  assert.equal(agent==='deepseek'?selection.params.value:selection.params.modelId,run.model);
  if(agent==='hermes')assert.equal(run.requests.find(message=>message.method==='session/set_mode').params.modeId,'accept_edits');
  assert.equal(lines.flatMap(line=>line.message?.content||[]).filter(block=>block.type==='text').map(block=>block.text).join(''),'hello world');
  assert.equal(lines.find(line=>line.type==='result').usage.input_tokens,7);assert(run.closed);
});

test('DeepSeek configured non-current models expose their own effort levels and apply the selection',async()=>{
  const previous=process.env.DSH_HOME,home=mkdtempSync(path.join(os.tmpdir(),'cmc-ecnu-efforts-'));
  const ids=['ecnu-max','ecnu-plus'].map(id=>JSON.stringify(['ecnu',id]));
  mkdirSync(path.join(home,'profiles','desktop'),{recursive:true});
  writeFileSync(path.join(home,'profiles','desktop','cordis.patch.yml'),JSON.stringify([{id:'llm-pi-ai',config:{providers:{ecnu:{reasoning:'off',models:[{id:'ecnu-max',reasoningEfforts:{off:'none',low:'low',high:'high',max:'max'}},{id:'ecnu-plus',reasoningEfforts:{off:'none',low:'low',medium:'medium',max:'xhigh'}}]}}}}]));
  process.env.DSH_HOME=home;
  try{
    const legacy=JSON.stringify(['deepseek-official','ecnu-max']);
    const discovery=fixture('deepseek',{extraModels:[...ids,legacy].map(value=>({value,name:value}))});
    const catalog=await readHarnessCatalog('deepseek','fixture',process.cwd(),discovery.launch);
    assert(!catalog.models.some(m=>m.model==='deepseek::'+legacy));
    assert.equal(catalog.models.filter(m=>m.model==='deepseek::'+ids[0]).length,1);
    for(const [index,levels] of [['off','low','high','max'],['off','low','medium','max']].entries()){
      const entry=catalog.models.find(model=>model.model==='deepseek::'+ids[index]);
      assert.deepEqual(entry.supportedReasoningEfforts.map(e=>e.reasoningEffort),levels);assert.equal(entry.defaultReasoningEffort,'off');
    }
    for(const effort of ['off','high']){
      const run=fixture('deepseek');
      const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),model:legacy,effort,content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
      assert.equal((await adapter).exitCode,0);
      assert.equal(run.requests.find(r=>r.method==='session/set_config_option'&&r.params.configId==='model').params.value,ids[0]);
      assert.equal(run.requests.find(r=>r.method==='session/set_config_option'&&r.params.configId==='reasoning_effort').params.value,effort);
    }
  }finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(home,{recursive:true,force:true});}
});

test('ACP cancellation waits for owned process completion',async()=>{
  const run=fixture('deepseek',{cancel:true});
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>false},run.launch,async()=>{throw Error('Unexpected forced termination');});
  for(let index=0;index<100&&!run.promptId;index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(run.promptId);await adapter.interrupt();await adapter;
  assert(run.requests.some(message=>message.method==='session/cancel'));assert(run.closed);
});

test('Hermes provider setup error retains the actionable ACP details',async()=>{
  const run=fixture('hermes',{newSessionError:'No provider configured; run hermes setup model'});
  await assert.rejects(readHarnessCatalog('hermes','fixture',process.cwd(),run.launch),/hermes setup model/);
  assert(run.closed);
});
