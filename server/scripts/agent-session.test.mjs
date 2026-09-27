import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {FollowupQueue} from '../src/services/followupQueue.ts';

test('AGY exact model survives stale effort from an older client',async()=>{
  const threads=[],meta=new Map();let args;
  const store={threads,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,v)=>meta.set(id,v),async upsertThread(v){const t=threads.find(t=>t.id===v.id);if(t)Object.assign(t,v);else threads.push(v);return t||v;}};
  const launch=(_cmd,values)=>{args=values;const stdout=new PassThrough(),stderr=new PassThrough();stdout.end();return {stdout,stderr,then:Promise.resolve({exitCode:0}).then.bind(Promise.resolve({exitCode:0}))};};
  const manager=new AgentSessions(store,{publish(){}},launch);
  manager.models=async()=>[{model:'antigravity::gemini-3.8-flash-high'}];
  await manager.handle({type:'thread.start',model:'antigravity::gemini-3.8-flash-high',effort:'medium',initialText:'test'});
  assert.equal(args[args.indexOf('--model')+1],'gemini-3.8-flash-high');
  assert(!args.includes('--effort'));
});

test('external sessions retain identity, queue in order, stop and reject cross-agent sends',async()=>{
  const threads=[],events=[],metadata=new Map(),followups=new Map(),runs=[];
  const store={threads,readAgentMeta:id=>metadata.get(id),writeAgentMeta:(id,v)=>metadata.set(id,structuredClone(v)),readFollowups:()=>[],writeFollowup:(id,v)=>followups.set(id,v),removeFollowup:id=>followups.delete(id),async upsertThread(value){let t=threads.find(t=>t.id===value.id);if(t)Object.assign(t,value);else threads.push(t={...value});return t;}};
  const launch=(_command,args)=>{
    let resolve;const done=new Promise(r=>resolve=r),stdout=new PassThrough(),stderr=new PassThrough();
    const child={stdout,stderr,then:done.then.bind(done),kill(){stdout.end();resolve({exitCode:1})},line(value){stdout.write(JSON.stringify(value)+'\n')},finish(){stdout.end();resolve({exitCode:0})}};runs.push({child,args});return child;
  };
  const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch);
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
