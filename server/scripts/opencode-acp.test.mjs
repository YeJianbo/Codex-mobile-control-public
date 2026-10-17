import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {harnessAcp,readHarnessCatalog} from '../src/services/harnessAcp.ts';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {createOpencodePolicy} from '../src/services/opencodePolicy.ts';
import mobilePolicy from './opencode-mobile-policy.mjs';
import {opencodeAcpEnvironment,refreshOpencodeModels} from '../src/services/opencodeConfig.ts';

const originalModelsFetch=process.env.OPENCODE_DISABLE_MODELS_FETCH;
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';
after(()=>{if(originalModelsFetch===undefined)delete process.env.OPENCODE_DISABLE_MODELS_FETCH;else process.env.OPENCODE_DISABLE_MODELS_FETCH=originalModelsFetch;});

function fixture({resume=false,cancel=false,nativeFirst=false,modelIds=['provider/model-a','private/folder/model-b'],onLaunch=()=>{}}={}){
  const requests=[],stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
  let finish,promptId,model=modelIds[0],mode='build',effort='__default';
  let policyHooks,policyReady=Promise.resolve(),hookDecision=Promise.resolve();
  const done=new Promise(resolve=>finish=resolve);
  const child={stdin,stdout,stderr,then:done.then.bind(done),kill(){stdout.end();stderr.end();finish({exitCode:0});return true;}};
  stdin.on('finish',()=>child.kill());
  const levels=()=>model===modelIds[0]?['low','high','__default']:['tiny','huge','__default'];
  const state=()=>({configOptions:[
    {id:'model',category:'model',type:'select',currentValue:model,options:modelIds.map(value=>({value,name:value}))},
    {id:'effort',category:'thought_level',type:'select',currentValue:effort,options:levels().map(value=>({value,name:value}))},
    {id:'mode',category:'mode',type:'select',currentValue:mode,options:['build','plan'].map(value=>({value,name:value}))},
  ]});
  const send=message=>stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const update=value=>send({method:'session/update',params:{sessionId:'saved-opencode',update:value}});
  const fresh=()=>{
    update({sessionUpdate:'agent_message_chunk',_meta:{isReplay:true},content:{type:'text',text:'late replay'}});
    update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'fresh response'}});
    send({id:promptId,result:{stopReason:'end_turn'}});
  };
  stdin.on('data',buffer=>{for(const line of buffer.toString().trim().split('\n')){
    const message=JSON.parse(line);requests.push(message);
    queueMicrotask(async()=>{
      if(message.method==='initialize'){await policyReady;send({id:message.id,result:{agentCapabilities:{loadSession:true,promptCapabilities:{image:true},sessionCapabilities:{close:{},...(resume?{resume:{}}:{})}}}});}
      else if(['session/new','session/load','session/resume'].includes(message.method)){
        // OpenCode's modern load response omits legacy models/modes and sessionId.
        update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old response'}});
        update({sessionUpdate:'tool_call',toolCallId:'old-tool',title:'Old command',kind:'execute',rawInput:{command:'old'}});
        send({id:message.id,result:{...(message.method==='session/new'?{sessionId:'saved-opencode'}:{}),...state()}});
      }else if(message.method==='session/set_config_option'){
        if(message.params.configId==='model'){assert(modelIds.includes(message.params.value));model=message.params.value;effort='__default';}
        else if(message.params.configId==='effort'){assert(levels().includes(message.params.value));effort=message.params.value;}
        else throw Error('Unexpected config option');
        send({id:message.id,result:state()});
      }else if(message.method==='session/set_mode'){
        mode=message.params.modeId;assert(['build','plan'].includes(mode));send({id:message.id,result:{}});
      }else if(message.method==='session/prompt'){
        promptId=message.id;if(cancel)return;
        update({sessionUpdate:'tool_call',toolCallId:'new-tool',title:'Command',kind:'execute',rawInput:{command:'mock-only'}});
        const gate=()=>policyHooks?.['tool.execute.before']({sessionID:'saved-opencode',callID:'new-tool',tool:'bash'},{args:{command:'mock-only'}});
        if(!nativeFirst)await gate();
        send({id:999,method:'session/request_permission',params:{sessionId:'saved-opencode',toolCall:{toolCallId:'new-tool'},options:[{kind:'allow_always',optionId:'always'},{kind:'allow_once',optionId:'once'},{kind:'reject_once',optionId:'reject'}]}});
        if(nativeFirst)hookDecision=Promise.resolve(gate());
      }else if(message.id===999){assert.equal(message.result.outcome.optionId,'once');await hookDecision;fresh();}
      else if(message.method==='session/cancel')send({id:promptId,result:{stopReason:'cancelled'}});
      else if(message.id!==undefined)send({id:message.id,result:{}});
    });
  }});
  return {requests,child,launch:(command,args,options)=>{
    assert.deepEqual(args,['acp']);onLaunch(options);
    const policy=JSON.parse(options.env.OPENCODE_CONFIG_CONTENT||'{}').plugin?.find(spec=>Array.isArray(spec)&&spec[0].endsWith('/opencode-mobile-policy.mjs'));
    if(policy)policyReady=mobilePolicy({},policy[1]).then(hooks=>{policyHooks=hooks;});
    return child;
  },get promptId(){return promptId;}};
}

test('OpenCode catalog uses modern configOptions and discovers each model effort without a prompt',async()=>{
  const run=fixture();
  const result=await readHarnessCatalog('opencode','fixture',process.cwd(),run.launch);
  assert.equal(result.supportsImages,true);assert.equal(result.supportsPlanMode,true);
  assert.deepEqual(result.models.map(model=>model.model),['opencode::private/folder/model-b','opencode::default','opencode::provider/model-a']);
  const other=result.models.find(model=>model.model==='opencode::private/folder/model-b'),alias=result.models.find(model=>model.model==='opencode::default');
  assert.deepEqual(other.supportedReasoningEfforts.map(option=>option.reasoningEffort),['tiny','huge','__default']);
  assert.equal(other.providerId,'private');assert.equal(other.providerName,'private');assert.equal(other.shortName,'folder/model-b');
  assert.equal(alias.providerId,'provider');assert.equal(alias.shortName,'model-a（默认）');
  assert(!run.requests.some(request=>request.method==='session/prompt'));
  assert(run.requests.some(request=>request.method==='session/close'));
  assert.deepEqual(run.requests.filter(request=>request.method==='session/set_config_option').slice(-2).map(request=>request.params),[
    {sessionId:'saved-opencode',configId:'model',value:'provider/model-a'},
    {sessionId:'saved-opencode',configId:'effort',value:'__default'},
  ]);
});

test('OpenCode load suppresses old text and tools, applies opaque model/effort/plan and asks permission',async()=>{
  let permissions=0;
  const run=fixture({onLaunch:options=>{assert.equal(options.env.OPENCODE_DISABLE_MODELS_FETCH,process.env.OPENCODE_DISABLE_MODELS_FETCH??'false');assert(!Object.hasOwn(options.env,'OPENCODE_PERMISSION'));}});
  const child=harnessAcp({agent:'opencode',command:'fixture',cwd:process.cwd(),session:'saved-opencode',model:'private/folder/model-b',effort:'huge',mode:'plan',permission:'ask',
    content:[{type:'text',text:'mock input'}],approve:async params=>{permissions++;assert.equal(params.toolCall.kind,'execute');return true;}},run.launch);
  const lines=[];child.stdout.on('data',buffer=>lines.push(...buffer.toString().trim().split('\n').map(JSON.parse)));
  assert.equal((await child).exitCode,0);assert.equal(permissions,1);
  assert(run.requests.some(request=>request.method==='session/load'));
  assert(!run.requests.some(request=>request.method==='session/new'));
  assert.equal(run.requests.find(request=>request.method==='session/set_mode').params.modeId,'plan');
  assert.equal(lines.find(line=>line.type==='system').session_id,'saved-opencode');
  assert.equal(lines.find(line=>line.type==='system').model,'private/folder/model-b');
  assert.deepEqual(lines.flatMap(line=>line.message?.content||[]).filter(block=>block.type==='text').map(block=>block.text),['fresh response']);
  assert(!lines.flatMap(line=>line.message?.content||[]).some(block=>block.id==='old-tool'));
});

test('OpenCode native permission first and the policy hook share one pending decision',async()=>{
  let permissions=0;
  const run=fixture({nativeFirst:true});
  const child=harnessAcp({agent:'opencode',command:'fixture',cwd:process.cwd(),session:'saved-opencode',permission:'ask',content:[{type:'text',text:'mock input'}],
    approve:async()=>{permissions++;await new Promise(resolve=>setTimeout(resolve,20));return true;}},run.launch);
  assert.equal((await child).exitCode,0);assert.equal(permissions,1);
});

test('OpenCode policy stays local, preserves native permissions and fails closed',async()=>{
  const inline=process.env.OPENCODE_CONFIG_CONTENT,permission=process.env.OPENCODE_PERMISSION;
  let policy;
  try{
    process.env.OPENCODE_CONFIG_CONTENT='{// retain native deny\n"permission":{"edit":"deny"},"plugin":["file:///existing-plugin.mjs",],}';
    process.env.OPENCODE_PERMISSION='{"bash":"allow"}';
    let allow=false,received;
    policy=await createOpencodePolicy(async params=>{received=params;return allow;});
    const config=JSON.parse(policy.env.OPENCODE_CONFIG_CONTENT),spec=config.plugin.at(-1);
    assert.deepEqual(config.permission,{edit:'deny'});assert.equal(config.plugin[0],'file:///existing-plugin.mjs');
    assert(!Object.hasOwn(policy.env,'OPENCODE_PERMISSION'));assert.match(spec[1].endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
    const refused=await fetch(spec[1].endpoint+'/ready',{method:'POST'});assert.equal(refused.status,403);assert.equal(policy.ready,false);
    const hooks=await mobilePolicy({},spec[1]);assert.equal(policy.ready,true);
    await assert.rejects(hooks['tool.execute.before']({sessionID:'local-session',callID:'one',tool:'unknown-native-tool'},{args:{value:'中文输入'}}),/rejected/);
    assert.equal(received.toolCall.kind,'other');assert.equal(received.toolCall.rawInput.value,'中文输入');
    allow=true;await hooks['tool.execute.before']({sessionID:'local-session',callID:'two',tool:'write'},{args:{filePath:'result.txt',content:'mock-only'}});
    assert.deepEqual(received.toolCall.locations,[{path:'result.txt'}]);
    await policy.close();assert.equal(policy.ready,false);
    await assert.rejects(hooks['tool.execute.before']({sessionID:'local-session',callID:'three',tool:'bash'},{args:{command:'mock-only'}}),/rejected/);
  }finally{
    await policy?.close();
    if(inline===undefined)delete process.env.OPENCODE_CONFIG_CONTENT;else process.env.OPENCODE_CONFIG_CONTENT=inline;
    if(permission===undefined)delete process.env.OPENCODE_PERMISSION;else process.env.OPENCODE_PERMISSION=permission;
  }
});

test('OpenCode uses declared resume and cancels its existing session without replacing it',async()=>{
  const run=fixture({resume:true,cancel:true});
  const child=harnessAcp({agent:'opencode',command:'fixture',cwd:process.cwd(),session:'saved-opencode',permission:'full',content:[{type:'text',text:'mock input'}],approve:async()=>false},run.launch);
  for(let index=0;index<100&&!run.promptId;index++)await new Promise(resolve=>setTimeout(resolve,2));
  assert(run.promptId);await child.interrupt();assert.equal((await child).exitCode,0);
  assert(run.requests.some(request=>request.method==='session/resume'));
  assert(!run.requests.some(request=>request.method==='session/new'));
  assert.equal(run.requests.find(request=>request.method==='session/set_mode').params.modeId,'build');
  assert(run.requests.some(request=>request.method==='session/cancel'&&request.params.sessionId==='saved-opencode'));
});

test('OpenCode config updates invalidate the model cache before validating a new model',async()=>{
  const keys=['CODEX_MOBILE_CONTROL_AGENTS','OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_PERMISSION'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const folder=mkdtempSync(path.join(os.tmpdir(),'cmc-opencode-models-')),config=path.join(folder,'opencode.json');
  try{
    process.env.CODEX_MOBILE_CONTROL_AGENTS='opencode';process.env.OPENCODE_CONFIG=config;delete process.env.OPENCODE_CONFIG_CONTENT;delete process.env.OPENCODE_PERMISSION;
    writeFileSync(config,'{}');let reads=0,ids=['provider/model-a'];
    const sessions=new AgentSessions({}, {},undefined,()=>{reads++;return fixture({modelIds:ids}).child;},undefined,async()=>({command:'fixture',source:'configured'}));
    await sessions.validate('opencode::provider/model-a');assert.equal(reads,1);
    await sessions.models();assert.equal(reads,1);
    ids=['provider/model-new'];writeFileSync(config,'{"model":"provider/model-new"}');const changed=new Date(Date.now()+1000);utimesSync(config,changed,changed);
    await sessions.validate('opencode::provider/model-new');assert.equal(reads,2);
    await assert.rejects(sessions.validate('opencode::provider/model-a'),/模型已不在当前可用目录，请重新选择/);
    const backend=(await sessions.backends()).find(backend=>backend.agent==='opencode');
    assert.equal(backend.supportsPlan,true);assert.equal(backend.supportsPlanMode,true);assert.equal(backend.supportsImages,true);
  }finally{
    for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    assert(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(folder,{recursive:true,force:true});
  }
});

test('OpenCode stale native catalogs refresh once before discovery and respect explicit refresh',async()=>{
  const keys=['XDG_CACHE_HOME','OPENCODE_MODELS_PATH','OPENCODE_MODELS_URL','OPENCODE_DISABLE_MODELS_FETCH','npm_config_cache','NPM_CONFIG_CACHE'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const folder=mkdtempSync(path.join(os.tmpdir(),'cmc-opencode-refresh-')),cache=path.join(folder,'opencode','models.json');
  try{
    process.env.XDG_CACHE_HOME=folder;for(const key of keys.slice(1))delete process.env[key];
    mkdirSync(path.dirname(cache));writeFileSync(cache,'{}');const old=new Date(Date.now()-600000);utimesSync(cache,old,old);
    assert.equal(opencodeAcpEnvironment().OPENCODE_DISABLE_MODELS_FETCH,'false');
    assert.equal(opencodeAcpEnvironment().npm_config_cache,path.join(folder,'opencode','npm'));
    process.env.NPM_CONFIG_CACHE=path.join(folder,'explicit-npm-cache');assert.equal(opencodeAcpEnvironment().npm_config_cache,process.env.NPM_CONFIG_CACHE);delete process.env.NPM_CONFIG_CACHE;
    process.env.npm_config_cache=path.join(folder,'lower-npm-cache');assert.equal(opencodeAcpEnvironment().npm_config_cache,process.env.npm_config_cache);delete process.env.npm_config_cache;
    let refreshes=0;
    const launch=async(command,args)=>{assert.equal(command,'fixture');assert.deepEqual(args,['models','--refresh']);refreshes++;await new Promise(resolve=>setTimeout(resolve,10));writeFileSync(cache,'{"fresh":true}');return {exitCode:0};};
    await Promise.all([refreshOpencodeModels('fixture',folder,launch),refreshOpencodeModels('fixture',folder,launch)]);assert.equal(refreshes,1);
    await refreshOpencodeModels('fixture',folder,launch);assert.equal(refreshes,1);
    await refreshOpencodeModels('fixture',folder,launch,true);assert.equal(refreshes,2);
    process.env.OPENCODE_DISABLE_MODELS_FETCH='true';await refreshOpencodeModels('fixture',folder,launch,true);assert.equal(refreshes,2);
  }finally{
    for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
    assert(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(folder,{recursive:true,force:true});
  }
});
