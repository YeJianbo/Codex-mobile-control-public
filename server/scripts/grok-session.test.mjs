import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {grokAcp} from '../src/services/grokAcp.ts';

test('Grok ACP retains every reply chunk, configured executable and saved effort across resume',async()=>{
 const threads=[],metadata=new Map(),events=[],runs=[];
 const store={threads,readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,v)=>metadata.set(id,structuredClone(v)),async upsertThread(v){let row=threads.find(x=>x.id===v.id);if(row)Object.assign(row,v);else threads.push(row={...v});return row;}};
 const launch=(command,args)=>{
  const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();let resolve,closed=false;const done=new Promise(r=>resolve=r),requests=[];
  const line=m=>stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
  const child={stdin,stdout,stderr,then:done.then.bind(done),kill(){if(!closed){closed=true;stdout.end();stderr.end();resolve({exitCode:0});}return true;}};
  stdin.on('finish',()=>child.kill());
  stdin.on('data',data=>{for(const value of data.toString().trim().split('\n')){const m=JSON.parse(value);requests.push(m);queueMicrotask(()=>{
   if(m.method==='initialize')line({id:m.id,result:{protocolVersion:1}});
   else if(m.method==='session/new'||m.method==='session/load')line({id:m.id,result:{sessionId:'fixture-session'}});
   else if(m.method==='session/set_config_option')line({id:m.id,result:{}});
   else if(m.method==='session/prompt'){
    line({method:'session/update',params:{sessionId:'child-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'子代理内容'}}}});
    line({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',_meta:{isReplay:true},content:{type:'text',text:'历史回放'}}}});
    for(const text of ['**','VERIFY_','complete','**'])line({method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
    line({id:m.id,result:{stopReason:'end_turn'}});
   }
  });}});
  runs.push({command,args,requests,child});return child;
 };
 const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch,undefined,undefined,async()=>({command:'configured-grok.exe',source:'configured'}));
 manager.models=async()=>[{model:'grok::default',supportedReasoningEfforts:[]}];
 const settle=async()=>{for(let i=0;i<100;i++){if(!manager.owns(threads[0].id))return;await new Promise(r=>setTimeout(r,5));}throw Error('ACP did not settle');};
 await manager.handle({type:'thread.start',model:'grok::default',projectPath:process.cwd(),permission:'ask',effort:'high',initialText:'fixture'});await settle();
 assert.equal(threads[0].status,'completed');assert.equal(events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),'**VERIFY_complete**');
 assert.equal(runs[0].command,'configured-grok.exe');
 assert.equal(runs[0].args[runs[0].args.indexOf('--permission-mode')+1],'default');
 await manager.handle({type:'turn.start',threadId:threads[0].id,permission:'ask',text:'continue'});await settle();
 assert.equal(runs[1].args[runs[1].args.indexOf('--reasoning-effort')+1],'high');
 assert.equal(runs[1].requests.find(r=>r.method==='session/load').params.sessionId,'fixture-session');
 assert.equal(events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),'**VERIFY_complete****VERIFY_complete**');
});

test('Grok stops through ACP cancellation and waits for closed streams without killing another process',async()=>{
 const requests=[],stdout=new PassThrough(),stderr=new PassThrough(),stdin=new PassThrough();
 let complete,promptId,closed=false;const done=new Promise(resolve=>complete=resolve);
 const line=message=>stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
 const child={stdout,stderr,stdin,pid:12345,then:done.then.bind(done),kill(){if(!closed){closed=true;stdout.end();stderr.end();complete({exitCode:0});}return true;}};
 stdin.on('finish',()=>child.kill());
 stdin.on('data',buffer=>{for(const value of buffer.toString().trim().split('\n')){const m=JSON.parse(value);requests.push(m);queueMicrotask(()=>{
  if(m.method==='initialize')line({id:m.id,result:{protocolVersion:1}});
  if(m.method==='session/new')line({id:m.id,result:{sessionId:'cancel-fixture'}});
  if(m.method==='session/prompt')promptId=m.id;
  if(m.method==='session/cancel')line({id:promptId,result:{stopReason:'cancelled'}});
 });}});
 const adapter=grokAcp({cwd:process.cwd(),content:[{type:'text',text:'fixture'}],approve:async()=>false},()=>child,async()=>{throw Error('Unexpected force kill');});
 for(let i=0;i<100&&!promptId;i++)await new Promise(r=>setTimeout(r,5));assert(promptId);
 await adapter.interrupt();await adapter;
 assert(requests.some(r=>r.method==='session/cancel'&&r.params.sessionId==='cancel-fixture'));assert(closed);
});
