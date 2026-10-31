import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {harnessAcp,readHarnessCatalog} from '../src/services/harnessAcp.ts';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {SessionManager} from '../src/services/sessionManager.ts';
import {CommandReceipts} from '../src/services/commandReceipts.ts';

function fixture(agent,{cancel=false,newSessionError,configError,permissionAdapterReady=true,extraModels=[],resumeSessionId='saved-session',failWriteAfter,closeStdinAfter,holdConfig=false}={}){
  const requests=[],stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
  const model=agent==='deepseek'?'[{"provider":"deepseek-official","model":"deepseek::flash"}]':'openrouter:example/model';
  let finish,promptId,closed=false;const heldConfig=[];
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
        const identity=message.method==='session/resume'?(resumeSessionId?{sessionId:resumeSessionId}:{}):{sessionId:'saved-session'};
        update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old history'}});
        reply({id:message.id,result:{...identity,configOptions:agent==='deepseek'?[{id:'model',category:'model',currentValue:model,options:[{name:'Provider',options:[{value:model,name:'Flash'},...extraModels]}]}]:[],models:{currentModelId:model,availableModels:[{modelId:model,name:'Example'}]}}});
      }else if(message.method==='session/set_config_option'){
        if(holdConfig){heldConfig.push(message);return;}
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
      if(failWriteAfter&&message.method===failWriteAfter)stdin.write=()=>{throw Error('fixture pipe broken');};
      if(closeStdinAfter&&message.method===closeStdinAfter)stdin.destroy();
    });
  }});
  return {model,requests,child,launch:()=>child,get closed(){return closed;},get promptId(){return promptId;},get heldConfig(){return heldConfig.length>0;},releaseConfig(){for(const message of heldConfig)reply({id:message.id,result:{configOptions:[]}});}};
}

test('ACP preflight failure retains the thread and retries the same request without a false sent event',async()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'cmc-acp-receipt-'));
  const attempts=[fixture('deepseek',{configError:'fixture configuration failed'}),fixture('deepseek')];
  const threads=[],events=[],metadata=new Map();
  const store={threads,approvals:[],readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,value)=>metadata.set(id,structuredClone(value)),async upsertThread(value){let thread=threads.find(item=>item.id===value.id);if(thread)Object.assign(thread,value);else threads.push(thread={...value});return thread;}};
  const hub={publish:event=>events.push(event)},agents=new AgentSessions(store,hub,(...args)=>attempts.shift().launch(...args),undefined,undefined,async()=>({command:'fixture',source:'path'}));
  agents.validate=async()=>{};agents.modelsForAgent=async()=>[{model:'deepseek::fixture',supportedReasoningEfforts:[{reasoningEffort:'high'}]}];agents.ensureNativeDeepSeekThread=async()=>null;
  const manager=new SessionManager(new EventEmitter(),hub,store,()=>new Map(),undefined,agents);
  manager.receipts=new CommandReceipts(path.join(home,'receipts.json'));
  const command={type:'thread.start',requestId:'fixture',model:'deepseek::fixture',effort:'high',permission:'auto',initialText:'message',projectPath:process.cwd()};
  try{
    await assert.rejects(manager.handleClientCommand(command),error=>error.kind==='not_started');
    const first=await manager.receipts.get('fixture'),thread=threads[0];
    assert.equal(first.state,'failed');assert.equal(first.retryAllowed,true);assert.equal(first.threadId,thread.id);
    assert.equal(thread.status,'idle');assert.equal(metadata.get(thread.id).session,'saved-session');
    assert(!events.some(event=>event.type==='user.message'||event.type==='turn.started'||event.type==='command.accepted'));
    await manager.handleClientCommand(command);
    assert.equal(threads.length,1);assert.equal((await manager.receipts.get('fixture')).state,'accepted');
    assert.equal(events.filter(event=>event.type==='user.message').length,1);
    assert.equal(events.find(event=>event.type==='user.message').threadId,thread.id);
    for(let i=0;i<100&&agents.owns(thread.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert(!agents.owns(thread.id));
  }finally{manager.closeCapacityRetries();manager.receipts.close();await agents.close();rmSync(home,{recursive:true,force:true});}
});

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

test('DeepSeek resume refuses to continue when the agent returns a different session id',async()=>{
  const run=fixture('deepseek',{resumeSessionId:'hijacked-session'}),lines=[];
  const child=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),session:'saved-session',content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  child.stdout.on('data',chunk=>lines.push(...chunk.toString().trim().split('\n').map(JSON.parse)));
  const result=await child;
  assert.equal(result.exitCode,1);
  assert(lines.some(line=>line.type==='result'&&line.is_error&&/不同的会话编号/.test(line.result)));
  assert(lines.every(line=>line.session_id!=='hijacked-session'));
  assert(run.requests.some(message=>message.method==='session/resume'&&message.params.sessionId==='saved-session'));
  assert(!run.requests.some(message=>['session/new','session/prompt','session/set_config_option','session/set_mode'].includes(message.method)));
});

test('DeepSeek resume proceeds when the agent omits or echoes the session id',async()=>{
  for(const resumeSessionId of ['','saved-session']){
    const run=fixture('deepseek',{resumeSessionId}),lines=[];
    const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),session:'saved-session',permission:'auto',content:[{type:'text',text:'fixture'}],approve:async()=>{throw Error('Workspace edit should be allowed');}},run.launch);
    adapter.stdout.on('data',data=>lines.push(...data.toString().trim().split('\n').map(JSON.parse)));
    assert.equal((await adapter).exitCode,0);
    assert(run.requests.some(message=>message.method==='session/resume'));
    assert(run.requests.some(message=>message.method==='session/prompt'&&message.params.sessionId==='saved-session'));
    assert.equal(lines.find(line=>line.type==='result').session_id,'saved-session');
  }
});

test('ACP prompt dispatch reports written with the session and actual model',async()=>{
  const run=fixture('deepseek');
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  const dispatch=await adapter.promptDispatch;
  assert.equal((await adapter).exitCode,0);
  assert.equal(dispatch.phase,'written');
  assert.equal(dispatch.error,undefined);
  assert.equal(dispatch.session,'saved-session');
  assert.equal(dispatch.actualModel,run.model);
  assert(run.requests.some(message=>message.method==='session/prompt'));
});

test('ACP prompt dispatch reports not_started when preparation fails',async()=>{
  const run=fixture('deepseek',{configError:'model configuration failed'}),lines=[];
  const child=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),effort:'unsupported',content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  child.stdout.on('data',chunk=>lines.push(...chunk.toString().trim().split('\n').map(JSON.parse)));
  const dispatch=await child.promptDispatch;
  assert.equal((await child).exitCode,1);
  assert.equal(dispatch.phase,'not_started');
  assert(dispatch.error);
  assert.equal(dispatch.session,'saved-session');
  assert(!run.requests.some(request=>request.method==='session/prompt'));
});

test('ACP prompt dispatch reports not_started when stdin is not writable',async()=>{
  const run=fixture('deepseek',{closeStdinAfter:'session/set_config_option'});
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  const dispatch=await adapter.promptDispatch;
  assert.equal((await adapter).exitCode,1);
  assert.equal(dispatch.phase,'not_started');
  assert(/不可写/.test(String(dispatch.error?.message)));
  assert(!run.requests.some(request=>request.method==='session/prompt'));
});

test('ACP prompt dispatch reports uncertain when the write throws',async()=>{
  const run=fixture('deepseek',{failWriteAfter:'session/set_config_option'});
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>true},run.launch);
  const dispatch=await adapter.promptDispatch;
  assert.equal((await adapter).exitCode,1);
  assert.equal(dispatch.phase,'uncertain');
  assert(/fixture pipe broken/.test(String(dispatch.error?.message)));
});

test('ACP prompt dispatch resolves written before the turn completes',async()=>{
  const run=fixture('deepseek',{cancel:true});
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>false},run.launch);
  for(let index=0;index<100&&!run.promptId;index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(run.promptId);
  let timer;
  const dispatch=await Promise.race([adapter.promptDispatch,new Promise(resolve=>{timer=setTimeout(()=>resolve('pending'),2000);})]).finally(()=>clearTimeout(timer));
  assert.notEqual(dispatch,'pending');
  assert.equal(dispatch.phase,'written');
  assert.equal(dispatch.error,undefined);
  assert.equal(dispatch.session,'saved-session');
  assert.equal(dispatch.actualModel,run.model);
  await adapter.interrupt();await adapter;
  assert(run.requests.some(message=>message.method==='session/cancel'));assert(run.closed);
});

test('ACP prompt dispatch reports not_started when stopped before the prompt',async()=>{
  const run=fixture('deepseek',{holdConfig:true});
  // The held set_config_option reply gates the turn: the prompt cannot start
  // until it is answered, so interrupting now is deterministic.
  const adapter=harnessAcp({agent:'deepseek',command:'fixture',cwd:process.cwd(),model:run.model,content:[{type:'text',text:'fixture'}],approve:async()=>false},run.launch);
  for(let index=0;index<100&&!run.heldConfig;index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(run.heldConfig);
  const stopping=adapter.interrupt();
  // Release the held reply only after stop has been requested: the turn then
  // unwinds before promptStarted, so no prompt can ever be sent.
  run.releaseConfig();
  await stopping;
  const dispatch=await adapter.promptDispatch;
  assert.equal(dispatch.phase,'not_started');
  assert.equal(dispatch.error,undefined);
  assert.equal(dispatch.session,'saved-session');
  assert(!run.requests.some(request=>request.method==='session/prompt'));
  assert(run.closed);
});
