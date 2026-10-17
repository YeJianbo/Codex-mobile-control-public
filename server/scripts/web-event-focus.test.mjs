import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ThreadEventFocus} from '../public/console-core.js';

function socket(){return {readyState:1,sent:[],closed:0,send(raw){this.sent.push(JSON.parse(raw));},close(){this.closed++;this.readyState=3;}};}
function acknowledge(focus,ws){const request=ws.sent.at(-1);return focus.acknowledge(ws,request.requestId,request.threadId);}

test('focus reads share one request and accept only the matching socket, request and thread',async()=>{
  const focus=new ThreadEventFocus(),ws=socket();
  try{
    const ready=focus.ensure(ws,'A');assert.equal(focus.ensure(ws,'A'),ready);assert.equal(ws.sent.length,1);
    const request=ws.sent[0];
    assert.equal(focus.acknowledge(socket(),request.requestId,'A'),false);
    assert.equal(focus.acknowledge(ws,'old','A'),false);
    assert.equal(focus.acknowledge(ws,request.requestId,'B'),false);
    assert(acknowledge(focus,ws));assert(await ready);assert.equal(focus.ensure(ws,'A'),ready);
  }finally{focus.reset();}
});

test('switching thread or socket cancels old waiters and a late close cannot clear the replacement',async()=>{
  const focus=new ThreadEventFocus(),first=socket(),second=socket();
  try{
    const old=focus.ensure(first,'A'),next=focus.ensure(first,'B');assert.equal(await old,false);
    const current=focus.ensure(second,'B');assert.equal(await next,false);
    focus.reset(first);assert(acknowledge(focus,second));assert(await current);
    const empty=focus.ensure(second,'');assert.equal(second.sent.at(-1).threadId,'');
    assert(acknowledge(focus,second));assert(await empty);assert.equal(first.closed,0);
  }finally{focus.reset();}
});

test('missing focus acknowledgement closes its own socket so normal reconnect can recover',async()=>{
  const focus=new ThreadEventFocus(5),ws=socket();
  assert.equal(await focus.ensure(ws,'A'),false);assert.equal(ws.closed,1);assert.equal(focus.current,null);
});

test('failed sends and closed sockets never leave a successful focus cached',async()=>{
  const focus=new ThreadEventFocus(),ws=socket();ws.send=()=>{throw Error('closed send');};
  assert.equal(await focus.ensure(ws,'A'),false);assert.equal(ws.closed,1);
  const replacement=socket();const ready=focus.ensure(replacement,'A');acknowledge(focus,replacement);assert(await ready);
  replacement.readyState=3;assert.equal(await focus.ensure(replacement,'A'),false);assert.equal(focus.current,null);
});

const source=fs.readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
function browserFixture(capabilities=['focused-thread-stream']){
  const sockets=[],received=[],focus=new ThreadEventFocus();
  class WebSocket {
    static OPEN=1;
    constructor(url){Object.assign(this,socket(),{url:String(url)});sockets.push(this);}
    emit(event){this.onmessage({data:JSON.stringify(event)});}
  }
  const state={generation:1,selection:0,token:'fixture',threadId:'A',capabilities,connected:false,pending:null,threads:[],projects:[]};
  const context=vm.createContext({state,eventFocus:focus,WebSocket,URL,location:{href:'https://fixture.test/console'},setTimeout,clearTimeout,
    queueThreadMatches(){},scheduleDesktopRefresh(){},updateConnection(){},cancelActivityReads(){},cancelHistoryReads(){},
    scheduleReconnect(){},toast(){},receiveEvent:event=>received.push(event),
    moveNewConversationDraft(){},moveGoalAttachments(){},queueThreadRefresh(){},safeWrite(){},$:()=>({value:'model'}),
    fillModelChoices(){},comparablePath:value=>value,renderImageDrafts(){},renderFileDrafts(){},renderThreads(){},queueRender(){}});
  vm.runInContext(section('function connectSocket(', 'function scheduleReconnect(')+
    section('function focusEventStream(', 'async function selectProject(')+section('function bindSubmissionThread(', 'function moveNewConversationDraft('),context);
  return {context,state,focus,sockets,received};
}
function emitAcknowledgement(ws){const request=ws.sent.at(-1);ws.emit({type:'thread.focused',threadId:request.threadId,requestId:request.requestId});}

test('shipped socket wiring focuses selection, consumes acknowledgement and clears pending focus on close',async()=>{
  const f=browserFixture();
  try{
    const opening=f.context.connectSocket(1),ws=f.sockets[0];
    assert.equal(new URL(ws.url).searchParams.get('streamThread'),'A');
    ws.emit({type:'connected'});await opening;assert.equal(ws.sent.length,1);
    emitAcknowledgement(ws);assert(await f.context.focusEventStream('A'));assert.equal(f.received.length,0);
    f.context.setConversationSelection('B');const selected=f.context.focusEventStream('B');
    assert.equal(ws.sent.length,2);emitAcknowledgement(ws);assert(await selected);
    f.context.setConversationSelection('');assert.equal(ws.sent.at(-1).threadId,'');
    const pending=f.context.focusEventStream('');ws.onclose({code:1000});assert.equal(await pending,false);
    assert.equal(f.focus.current,null);
  }finally{f.focus.reset();}
});

test('legacy gateways omit focus options and retain their original connection flow',async()=>{
  const f=browserFixture([]);
  try{
    const opening=f.context.connectSocket(1),ws=f.sockets[0];assert.equal(new URL(ws.url).searchParams.has('streamThread'),false);
    ws.emit({type:'connected'});await opening;assert.equal(ws.sent.length,0);assert.equal(f.context.focusEventStream(),null);
    f.context.setConversationSelection('B');assert.equal(ws.sent.length,0);
  }finally{f.focus.reset();}
});

test('the first submission binds its new thread into the focused stream without another selection',async()=>{
  const f=browserFixture();f.state.threadId='';f.state.selection=3;
  try{
    const opening=f.context.connectSocket(1),ws=f.sockets[0];ws.emit({type:'connected'});await opening;
    const submission={threadId:'',selection:3,text:'fixture',project:'p'};
    f.context.bindSubmissionThread(submission,'new-thread');assert.equal(f.state.threadId,'new-thread');
    assert.equal(ws.sent.at(-1).threadId,'new-thread');assert.equal(f.state.selection,3);
    emitAcknowledgement(ws);assert(await f.context.focusEventStream('new-thread'));
  }finally{f.focus.reset();}
});
