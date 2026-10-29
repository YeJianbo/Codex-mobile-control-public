import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {channelAssistantCommand} from '../src/channels/model.ts';
const fixtureExecutable=async agent=>({command:agent==='antigravity'?'agy':agent,source:'path'});

test('shared tool updates retain their turn and separate text on both sides of operations',async()=>{
 const events=[],store={writeAgentMeta(){},async upsertThread(){}};
 const manager=new AgentSessions(store,{publish:event=>events.push(event)});
 const stdout=new PassThrough(),stderr=new PassThrough(),child={stdout,stderr,then:Promise.resolve({exitCode:0}).then.bind(Promise.resolve({exitCode:0}))};
 const done=manager.consume('fixture','grok',child,{stopped:false},{},'fixture-model','turn');
 for(const record of [
  {type:'assistant',message:{id:'reply',content:[{type:'text',text:'before'}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'call',name:'工具',input:{}}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'call',name:'Read',input:{path:'a'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'call',content:'read'}]}},
  {type:'assistant',message:{id:'reply',content:[{type:'text',text:'after'}]}},
  {type:'result',result:''},
 ])stdout.write(JSON.stringify(record)+'\n');
 stdout.end();await done;
 const text=events.filter(row=>row.type==='message.delta');
 assert.notEqual(text[0].itemId,text[1].itemId);
 const tools=events.filter(row=>row.type.startsWith('tool.'));
 assert(tools.every(row=>row.turnId==='turn'));
 assert.equal(tools.filter(row=>row.type==='tool.started').at(-1).detail,JSON.stringify({path:'a'}));
 assert(events.indexOf(text[0])<events.indexOf(tools[0])&&events.indexOf(tools.at(-1))<events.indexOf(text[1]));
 await manager.close();
});

test('AGY submission validation does not wait for unrelated cold CLI discovery',async()=>{
  const previous=process.env.CODEX_MOBILE_CONTROL_AGENTS;process.env.CODEX_MOBILE_CONTROL_AGENTS='antigravity,grok';
  let release;const blocked=new Promise(resolve=>release=resolve);
  const locate=async agent=>{if(agent==='grok')await blocked;return fixtureExecutable(agent);};
  const discover=async()=>({exitCode:0,stdout:'gemini-fixture-low\tGemini Fixture (Low)\n'});
  const manager=new AgentSessions({}, {}, undefined,discover,undefined,locate);
  let timer;
  try{
    await Promise.race([manager.validate('antigravity::gemini-fixture'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AGY waited for Grok')),1000);})]);
    assert(manager.pickerPending.has('grok'));
  }finally{clearTimeout(timer);release();await manager.models();await manager.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_AGENTS;else process.env.CODEX_MOBILE_CONTROL_AGENTS=previous;}
});

import {FollowupQueue} from '../src/services/followupQueue.ts';

test('AGY legacy selection maps to base model with explicit effort',async()=>{
  const threads=[],meta=new Map();let args;
  const store={threads,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,v)=>meta.set(id,v),async upsertThread(v){const t=threads.find(t=>t.id===v.id);if(t)Object.assign(t,v);else threads.push(v);return t||v;}};
  const launch=(_cmd,values)=>{args=values;const stdout=new PassThrough(),stderr=new PassThrough();stdout.end();return {stdin:new PassThrough(),stdout,stderr,then:Promise.resolve({exitCode:0}).then.bind(Promise.resolve({exitCode:0}))};};
  const manager=new AgentSessions(store,{publish(){}},launch,undefined,undefined,fixtureExecutable);
  manager.models=async()=>[{model:'antigravity::gemini-3.8-flash',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}];
  await manager.handle({type:'thread.start',model:'antigravity::gemini-3.8-flash-high',effort:'medium',permission:'auto',initialText:'test'});
  assert.equal(args[args.indexOf('--model')+1],'gemini-3.8-flash');
  assert.equal(args[args.indexOf('--effort')+1],'medium');
});

test('model discovery coalesces callers, collapses AGY efforts and never prompts Claude',async()=>{
  const calls=[];
  const discover=async(command,args)=>{calls.push([command,args]);await new Promise(r=>setTimeout(r,5));return {exitCode:0,stdout:command==='agy'?'gemini-test-max\tGemini Test (Max)\ngemini-test-xhigh\tGemini Test (XHigh)\ngemini-test-high\tGemini Test (High)\ngemini-test-medium\tGemini Test (Medium)\ngemini-test-low\tGemini Test (Low)\ngemini-pro-high\tGemini Pro (High)\ngemini-pro-low\tGemini Pro (Low)\n':command==='grok'?'- grok-model\n':''};};
  const previous=process.env.CODEX_MOBILE_CONTROL_AGENTS;process.env.CODEX_MOBILE_CONTROL_AGENTS='claude,antigravity,grok';
  try{
    const manager=new AgentSessions({}, {}, undefined, discover,undefined,fixtureExecutable);
    const [a,b]=await Promise.all([manager.models(),manager.models()]);assert.deepEqual(a,b);
    assert.equal(calls.filter(([command,args])=>command==='agy'&&args[0]==='models').length,1);
    assert(!calls.some(([command,args])=>command==='claude'&&args.includes('models')));
    const model=a.find(m=>m.model==='antigravity::gemini-test');assert.equal(model.defaultReasoningEffort,'medium');assert.deepEqual(model.supportedReasoningEfforts.map(e=>e.reasoningEffort),['low','medium','high','xhigh','max']);
    const pro=a.find(m=>m.model==='antigravity::gemini-pro');assert.equal(pro.defaultReasoningEffort,'low');assert.deepEqual(pro.supportedReasoningEfforts.map(e=>e.reasoningEffort),['low','high']);
    assert(a.some(m=>m.model==='claude::default'));assert(a.some(m=>m.model==='grok::grok-model'));
    const count=calls.length;await manager.models();assert.equal(calls.length,count);
  }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_AGENTS;else process.env.CODEX_MOBILE_CONTROL_AGENTS=previous;}
});

test('expired model catalog stays visible during a slow background refresh',async()=>{
  let stage=0,release;const pending=new Promise(resolve=>release=resolve);
  const discover=async(command,args)=>{if(command!=='agy')return {exitCode:0,stdout:''};if(stage===1)await pending;return {exitCode:0,stdout:stage===0?'gemini-old-medium\tOld (Medium)\n':'gemini-new-medium\tNew (Medium)\n'};};
  const previous=process.env.CODEX_MOBILE_CONTROL_AGENTS;process.env.CODEX_MOBILE_CONTROL_AGENTS='antigravity';
  try{
    const manager=new AgentSessions({}, {}, undefined, discover,undefined,fixtureExecutable);const old=await manager.models();manager.catalog.at=0;stage=1;
    assert.deepEqual(await manager.models(),old);assert.deepEqual(await manager.models(),old);
    const refresh=manager.catalogRead;release();await refresh;
    assert((await manager.models()).some(m=>m.model==='antigravity::gemini-new'));
  }finally{release();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_AGENTS;else process.env.CODEX_MOBILE_CONTROL_AGENTS=previous;}
});

test('AGY transient catalog errors preserve loaded models and recover on refresh',async()=>{
  const previous=process.env.CODEX_MOBILE_CONTROL_AGENTS;process.env.CODEX_MOBILE_CONTROL_AGENTS='antigravity';let stage=0;
  const discover=async()=>{if(stage===1)throw Error('network timeout');return stage===2?{exitCode:1,stdout:'',stderr:'unavailable'}:stage===3?{exitCode:0,stdout:''}:{exitCode:0,stdout:'gemini-test-xhigh\tGemini Test (XHigh)\n'};};
  try{
    const manager=new AgentSessions({}, {},undefined,discover,undefined,fixtureExecutable);const loaded=await manager.models();
    for(stage=1;stage<=3;stage++){assert.deepEqual(await manager.models(true),loaded);assert((await manager.backends()).find(b=>b.agent==='antigravity').available);}
    stage=3;const cold=new AgentSessions({}, {},undefined,discover,undefined,fixtureExecutable);assert.deepEqual(await cold.models(),[]);assert.equal((await cold.backends()).find(b=>b.agent==='antigravity').available,false);
    stage=0;assert.deepEqual(await cold.models(true),loaded);assert((await cold.backends()).find(b=>b.agent==='antigravity').available);
  }finally{if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_AGENTS;else process.env.CODEX_MOBILE_CONTROL_AGENTS=previous;}
});

function agyFixture(){
  const threads=[],events=[],metadata=new Map(),runs=[];
  const store={threads,readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,v)=>metadata.set(id,structuredClone(v)),async upsertThread(value){let t=threads.find(t=>t.id===value.id);if(t)Object.assign(t,value);else threads.push(t={...value});return t;}};
  const launch=(_command,args,options)=>{
    let resolve;const done=new Promise(r=>resolve=r),stdout=new PassThrough(),stderr=new PassThrough();
    const child={stdin:new PassThrough(),stdout,stderr,then:done.then.bind(done),kill(){stdout.end();resolve({exitCode:1})},line(value){stdout.write(JSON.stringify(value)+'\n')},finish(exitCode=0){stdout.end();resolve({exitCode})}};
    runs.push({child,args,options});return child;
  };
  const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch,undefined,undefined,fixtureExecutable);
  manager.models=async()=>[{model:'antigravity::gemini-3.8-flash',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium'},{model:'antigravity::claude-opus',supportedReasoningEfforts:[]}];
  const start=extra=>manager.handle({type:'thread.start',model:'antigravity::gemini-3.8-flash',initialText:'first',permission:'auto',...extra});
  const settle=async()=>{for(let i=0;i<100&&threads.some(t=>manager.owns(t.id));i++)await new Promise(r=>setTimeout(r,5));assert(!threads.some(t=>manager.owns(t.id)));};
  return {manager,threads,events,metadata,runs,start,settle};
}

test('channel assistant dispatch launches AGY CLI with Gemini Flash and no permission bypass',async()=>{
  const f=agyFixture();
  await f.manager.handle(channelAssistantCommand({requestId:'channel',projectPath:'C:/assistant',text:'你好'},(await f.manager.models())[0]));
  const run=f.runs[0];
  assert(f.threads[0].id.startsWith('antigravity-'));
  assert.equal(f.metadata.get(f.threads[0].id).transport,undefined);
  assert(run.args.some(arg=>arg.endsWith('agyCliWorker.js')));assert(run.args.includes('agy'));
  assert.equal(run.args[run.args.indexOf('--model')+1],'gemini-3.8-flash');
  assert.equal(run.args[run.args.indexOf('--effort')+1],'medium');
  assert.equal(run.args[run.args.indexOf('--mode')+1],'accept-edits');
  assert(!run.args.includes('--dangerously-skip-permissions'));
  assert.equal(run.options.cwd,'C:/assistant');
  run.child.line({event:'result',result:{status:'SUCCESS',response:'你好',conversation_id:'channel'}});
  await f.settle();run.child.finish();await f.manager.close();
});

test('AGY validates model, effort and attachments before creating a thread',async()=>{
  const f=agyFixture();
  for(const extra of [{model:'antigravity::missing'},{effort:'xhigh'},{effort:'max'},{images:[{id:'missing',name:'image'}]},{files:[{id:'bad',name:'file'}]}])await assert.rejects(f.start(extra));
  assert.equal(f.threads.length,0);assert.equal(f.runs.length,0);assert.equal(f.events.length,0);
  await assert.rejects(f.manager.handle({type:'turn.start',threadId:'antigravity-missing',text:'next'}),/不存在/);
});

test('AGY steer appends a stream-json user event to the active CLI process',async()=>{
  const f=agyFixture();await f.start();const id=f.threads[0].id,chunks=[];
  f.runs[0].child.stdin.on('data',chunk=>chunks.push(chunk.toString()));
  await f.manager.steer(id,'继续检查');await new Promise(resolve=>setImmediate(resolve));
  assert(chunks.some(chunk=>JSON.stringify(JSON.parse(chunk))===JSON.stringify({event:'user',message:{content:'继续检查'}})));
  assert.equal(f.events.at(-1).type,'user.message');
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'已完成'}});f.runs[0].child.finish();await f.settle();
  await assert.rejects(f.manager.steer(id,'too late'),/不可引导/);
});

test('AGY resumes conversation and effort across turns; model change clears old effort',async()=>{
  const f=agyFixture();await f.start({effort:'low',mode:'plan'});const id=f.threads[0].id;
  assert(f.runs[0].args.includes('plan'));
  f.runs[0].child.line({event:'init',conversation_id:'conversation-1'});
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',conversation_id:'conversation-1',response:'ok'}});f.runs[0].child.finish();await f.settle();
  await f.manager.handle({type:'turn.start',threadId:id,text:'next',permission:'auto'});
  const args=f.runs[1].args;assert.equal(args[args.indexOf('--conversation')+1],'conversation-1');assert.equal(args[args.indexOf('--effort')+1],'low');
  assert.deepEqual(f.manager.settings(id),{model:'antigravity::gemini-3.8-flash',effort:'low',canSteer:true});
  f.runs[1].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[1].child.finish();await f.settle();
  await f.manager.handle({type:'turn.start',threadId:id,text:'different',model:'antigravity::claude-opus',permission:'auto'});
  assert(!f.runs[2].args.includes('--effort'));f.runs[2].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[2].child.finish();await f.settle();
});

test('AGY tool snapshots and repeated final records do not duplicate output or usage',async()=>{
  const f=agyFixture();await f.start();const child=f.runs[0].child;
  for(const output of ['a','ab','ab'])child.line({event:'step_update',step_update:{step_type:'tool',step_index:2,tool_name:'view_file',state:output==='a'?'RUNNING':'DONE',tool_info:{output}}});
  const result={event:'result',result:{status:'SUCCESS',response:'ok',usage:{input_tokens:10,output_tokens:3,total_tokens:13}}};child.line(result);child.line(result);child.finish();await f.settle();
  assert.equal(f.events.filter(e=>e.type==='tool.output').map(e=>e.text).join(''),'ab');
  assert.equal(f.events.filter(e=>e.type==='tool.completed').length,1);assert.equal(f.metadata.get(f.threads[0].id).tokens.total,13);
});

test('AGY resumed conversation counters replace snapshots instead of accumulating again',async()=>{
  const f=agyFixture();await f.start();const id=f.threads[0].id;
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'first',conversation_id:'usage-snapshot',usage:{input_tokens:100,cache_read_tokens:900,output_tokens:20}}});
  await f.settle();
  await f.manager.handle({type:'turn.start',threadId:id,text:'next',permission:'auto'});
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'next',usage:{input_tokens:130,cache_read_tokens:2100,output_tokens:27}}});
  await f.settle();
  assert.equal(f.metadata.get(id).tokens.total,2257);
  assert.equal(f.metadata.get(id).tokens.last,null);
  assert.equal(f.metadata.get(id).tokens.context,null);
  f.runs[0].child.finish();await f.manager.close();
});

test('AGY interrupt closes unfinished tools and permits the next turn',async()=>{
  const f=agyFixture();await f.start();const id=f.threads[0].id;
  f.runs[0].child.line({event:'step_update',step_update:{step_type:'tool',step_index:3,tool_name:'run_command',state:'RUNNING'}});
  await new Promise(r=>setTimeout(r,5));await f.manager.handle({type:'turn.interrupt',threadId:id});await f.settle();
  assert.equal(f.threads[0].status,'interrupted');assert.equal(f.events.find(e=>e.type==='tool.completed').status,'cancelled');
  await f.manager.handle({type:'turn.start',threadId:id,text:'again',permission:'auto'});
  f.runs[1].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[1].child.finish();await f.settle();assert.equal(f.threads[0].status,'completed');
});

test('AGY missing or failed final result marks the turn as error',async()=>{
  for(const record of [undefined,{event:'result'},{event:'result',result:{status:'FAILED',error:{message:'provider unavailable'}}}]){
    const f=agyFixture();await f.start();if(record)f.runs[0].child.line(record);f.runs[0].child.finish();await f.settle();
    assert.equal(f.threads[0].status,'error');assert(f.events.some(e=>e.type==='error'&&e.message));assert.equal(f.events.at(-1).status,'error');
  }
});

test('AGY simultaneous sends cannot launch two processes for the same conversation',async()=>{
  const f=agyFixture();await f.start();const id=f.threads[0].id;
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[0].child.finish();await f.settle();
  const results=await Promise.allSettled([f.manager.handle({type:'turn.start',threadId:id,text:'one',permission:'auto'}),f.manager.handle({type:'turn.start',threadId:id,text:'two',permission:'auto'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(f.runs.length,2);
  f.runs[1].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[1].child.finish();await f.settle();
});

test('AGY old persisted variant restores the current picker and conversation',async()=>{
  const f=agyFixture();await f.start({initialText:''});const id=f.threads[0].id;
  f.metadata.set(id,{model:'antigravity::gemini-3.8-flash-high',session:'old-conversation'});
  assert.deepEqual(f.manager.settings(id),{model:'antigravity::gemini-3.8-flash',effort:'high',canSteer:false});
  await f.manager.handle({type:'turn.start',threadId:id,text:'resume',permission:'auto'});
  assert.equal(f.manager.settings(id).canSteer,true);
  const args=f.runs[0].args;assert.equal(args[args.indexOf('--model')+1],'gemini-3.8-flash');assert.equal(args[args.indexOf('--effort')+1],'high');assert.equal(args[args.indexOf('--conversation')+1],'old-conversation');
  f.runs[0].child.line({event:'result',result:{status:'SUCCESS',response:'ok'}});f.runs[0].child.finish();await f.settle();
});

test('external sessions retain identity, queue in order, stop and reject cross-agent sends',async()=>{
  const threads=[],events=[],metadata=new Map(),followups=new Map(),runs=[];
  const store={threads,readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,v)=>metadata.set(id,structuredClone(v)),readFollowups:()=>[],writeFollowup:(id,v)=>followups.set(id,v),removeFollowup:id=>followups.delete(id),async upsertThread(value){let t=threads.find(t=>t.id===value.id);if(t)Object.assign(t,value);else threads.push(t={...value});return t;}};
  const launch=(_command,args)=>{
    let resolve;const done=new Promise(r=>resolve=r),stdout=new PassThrough(),stderr=new PassThrough();
    const child={stdin:new PassThrough(),stdout,stderr,then:done.then.bind(done),kill(){stdout.end();resolve({exitCode:1})},line(value){stdout.write(JSON.stringify(value)+'\n')},finish(){stdout.end();resolve({exitCode:0})}};runs.push({child,args});return child;
  };
  const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch,undefined,undefined,fixtureExecutable);
  manager.models=async()=>[{model:'claude::default'}];
  const tick=()=>new Promise(r=>setTimeout(r,20));
  await manager.handle({type:'thread.start',model:'claude::default',initialText:'first'});
  const id=threads[0].id;assert(manager.owns(id));
  const sessions={canSteer:()=>false,steer:()=>{throw Error('not supported')}};
  const queue=new FollowupQueue(store,sessions,async()=>threads[0].status,e=>manager.handle({type:'turn.start',...e}));
  queue.add({id:'q',threadId:id,text:'next',images:[],model:'claude::default'});
  assert.equal(queue.list(id)[0].status,'queued');
  await assert.rejects(manager.validate('grok::default',id),/属于/);
  runs[0].child.line({type:'system',session_id:'original-session'});
  runs[0].child.line({type:'assistant',message:{content:[{type:'text',text:'hello'}]}});
  runs[0].child.line({type:'result',usage:{input_tokens:10,cache_read_input_tokens:5,output_tokens:2}});runs[0].child.finish();
  await tick();assert.equal(threads[0].status,'completed');
  const deadline=Date.now()+2500;while(runs.length<2&&Date.now()<deadline)await tick();
  assert.equal(runs.length,2);assert(runs[1].args.includes('original-session'));
  await manager.handle({type:'turn.interrupt',threadId:id});await tick();
  assert.equal(threads[0].status,'interrupted');assert.equal(manager.owns(id),false);
  assert.equal(events.filter(e=>e.type==='user.message').length,2);
  assert.equal(metadata.get(id).tokens.total,17);
  queue.close();
});
