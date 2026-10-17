import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {conversationBlocks,retainCompleteConversationEvents} from '../public/console-core.js';
const sha=text=>createHash('sha256').update(text).digest('hex');
function fixture(t){
 const threads=[],events=[],meta=new Map();let child;
 const store={threads,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,value)=>meta.set(id,value),async upsertThread(value){let row=threads.find(r=>r.id===value.id);if(row)Object.assign(row,value);else threads.push(value);return row;}};
 const launch=()=>{let resolve;const done=new Promise(r=>resolve=r),stdout=new PassThrough(),stderr=new PassThrough();child={stdin:new PassThrough(),stdout,stderr,then:done.then.bind(done),exitBeforeDrain(){resolve({exitCode:0});},write(value){stdout.write(JSON.stringify(value)+'\n');},end(value,newline=true){if(value)stdout.write(JSON.stringify(value)+(newline?'\n':''));stdout.end();resolve({exitCode:0});},kill(){stdout.end();resolve({exitCode:1});}};return child;};
 const manager=new AgentSessions(store,{publish:e=>events.push(e)},launch,undefined,undefined,async()=>({command:'agy',source:'path'}));manager.models=async()=>[{model:'antigravity::default'}];
 const start=async()=>{await manager.handle({type:'thread.start',initialText:'fixture',model:'antigravity::default',permission:'auto'});return threads[0].id;};
 const settle=async()=>{for(let i=0;i<200&&threads.some(row=>manager.owns(row.id));i++)await new Promise(r=>setTimeout(r,5));assert(threads.every(row=>!manager.owns(row.id)));};
 t.after(async()=>{child?.end();await settle();});return {events,threads,start,settle,get child(){return child}};
}
const delta=(text,index=1)=>({event:'step_update',step_update:{step_type:'agent_response',step_index:index,text_delta:text}});
const final=text=>({event:'result',result:{status:'SUCCESS',response:text}});
test('AGY final complete response fills only the missing streamed suffix',async t=>{
 const f=fixture(t),id=await f.start(),expected='中文🙂前半\n后半必须保留 END';f.child.write(delta(expected.slice(0,8)));f.child.end(final(expected));await f.settle();
 const actual=conversationBlocks(f.events,id).filter(b=>b.type==='message.delta').map(b=>b.text).join('');assert.equal(actual,expected);assert.equal(f.threads[0].status,'completed');assert.equal(f.events.filter(e=>e.type==='message.delta').at(-1).itemId,f.events.find(e=>e.type==='message.delta').itemId);
});
test('AGY Unicode byte chunks and final line without newline survive early process exit notification',async t=>{
 const f=fixture(t),id=await f.start(),expected='开始汉字👨‍👩‍👧‍👦🙂\n'.repeat(100)+'尾部 END';const partial=expected.slice(0,800);
 const bytes=Buffer.from(JSON.stringify(delta(partial))+'\n'+JSON.stringify(final(expected)));
 f.child.exitBeforeDrain();for(let offset=0;offset<bytes.length;offset+=3)f.child.stdout.write(bytes.subarray(offset,offset+3));f.child.stdout.end();await f.settle();
 assert.equal(sha(f.events.filter(e=>e.type==='message.delta').map(e=>e.text).join('')),sha(expected));assert.equal(f.threads[0].status,'completed');
});
test('AGY interleaved tools, duplicate final and late partial preserve the final answer exactly once',async t=>{
 const f=fixture(t),id=await f.start();f.child.write(delta('分析前言',1));f.child.write({event:'step_update',step_update:{step_type:'tool',step_index:2,tool_name:'view_file',state:'DONE',tool_info:{output:'fixture'}}});
 f.child.write(delta('最终回答',3));f.child.write(final('最终回答及尾部'));f.child.write(final('最终回答及尾部'));f.child.write(delta('及',3));f.child.end();await f.settle();
 const text=conversationBlocks(f.events,id).filter(b=>b.type==='message.delta').map(b=>b.text).join('');assert.equal(text,'分析前言最终回答及尾部');assert.equal(f.threads[0].status,'completed');
});
test('AGY inconsistent final content becomes an explicit error rather than a false completion',async t=>{
 const f=fixture(t);await f.start();f.child.write(delta('不同内容'));f.child.end(final('最终内容'));await f.settle();assert.equal(f.threads[0].status,'error');assert(f.events.some(e=>e.type==='error'&&e.message.includes('不一致')));
});
test('long streamed replies remain whole when the live Web event buffer exceeds its old limit',()=>{
 const id='antigravity-fixture',expected=Array.from({length:12050},(_,i)=>'汉🙂'+i+'|').join('');
 const rows=[{type:'user.message',threadId:id,text:'fixture'},...Array.from({length:12050},(_,i)=>({type:'message.delta',threadId:id,itemId:'answer',text:'汉🙂'+i+'|'}))];
 const retained=retainCompleteConversationEvents(rows,10000);assert.equal(retained[0].type,'user.message');assert.equal(sha(conversationBlocks(retained,id).filter(b=>b.type==='message.delta').map(b=>b.text).join('')),sha(expected));
});
