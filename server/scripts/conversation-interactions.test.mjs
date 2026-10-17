import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {mergeEvents,retainCompaction,errorMessage,restoreActivityDetails,ThreadEventFocus} from '../public/console-core.js';

test('user receipt identity removes duplicate bubbles while keeping distinct identical submissions',()=>{
  const history={type:'user.message',threadId:'t',requestId:'one',eventId:'history:one',text:'继续'};
  const receipt={...history,eventId:'receipt:one'};
  const separate={...receipt,eventId:'receipt:two',requestId:'two'};
  assert.deepEqual(mergeEvents([history,receipt],[receipt,separate]),[history,separate]);
});

// Execute the shipped function bodies. These are logic regressions, not browser
// layout/frame tests; mocks deliberately do not claim CSS or scroll physics QA.
const source=(await fs.readFile(process.env.CMC_CONSOLE_SOURCE||new URL('../public/console.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing source section ${start}`);return source.slice(a,b);}
const keyCode=source.includes('function conversationThreadKey(')?section('function conversationThreadKey(','let threadListRead=null;'):'';
const historyCode=section('function sameConversationData(','let conversationThread =')+section('function sameConversationEvents(','async function loadThread(');
const loadCode=section('async function loadThread(','async function loadOlderMessages()');
function historyFixture(id='cloud-snapshot:test',events){
  const elements=new Map();
  const $=name=>{if(!elements.has(name))elements.set(name,{value:'',hidden:true,textContent:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;}});return elements.get(name);};
  const state={threadId:id,generation:0,selection:0,connected:true,historyErrors:new Map(),hydrating:new Map(),historyLoading:new Set(),models:[],historyCount:new Map(),historyMore:new Map(),events:new Map(events===undefined?[]:[[id,events]]),threads:[{id,status:'idle',readOnly:true}],pending:null};
  let renders=0;const responses=[];
  const context={state,$,api:async()=>responses.shift(),AbortController,cancelActivityReads(){},focusEventStream:()=>null,desktopModelSettings:new Map(),syncDesktopModelSettings:()=>false,conversationGeneration:0,restoreActivityDetails,mergeEvents,retainCompaction,errorMessage,activeThread:()=>state.threads.find(t=>t.id===state.threadId),renderConversation:()=>renders++,refreshQueue:async()=>{}};
  vm.createContext(context);vm.runInContext(keyCode+historyCode+loadCode+section('function setConversationSelection(','async function selectProject('),context);
  return {state,$,responses,context,load:()=>vm.runInContext(`loadThread(${JSON.stringify(id)})`,context),renders:()=>renders};
}
const event=(id,index,text,type='message.delta')=>({threadId:id,eventId:`snapshot:${id}:fixed:${index}`,itemId:`snapshot:${index}`,type,text});
test('focused history waits for subscription acknowledgement and retains events received while waiting',async()=>{
  const f=historyFixture('A',[]);let acknowledge,reads=0;
  f.context.focusEventStream=()=>new Promise(resolve=>{acknowledge=resolve;});
  f.context.api=async()=>{reads++;return {events:[],status:'idle',hasMore:false};};
  const reading=f.load();assert.equal(reads,0);
  f.state.hydrating.get('A').push(event('A',0,'live while subscribing'));
  acknowledge(true);await reading;assert.equal(reads,1);
  assert.equal(f.state.events.get('A')[0].text,'live while subscribing');
});

test('leaving a conversation during focus confirmation cancels history before its HTTP starts',async()=>{
  const f=historyFixture('A',[]),focus=new ThreadEventFocus();let reads=0;
  const socket={readyState:1,send(){},close(){}};
  f.context.focusEventStream=id=>focus.ensure(socket,id);
  f.context.api=async()=>{reads++;return {events:[],status:'idle'};};
  try{
    const reading=f.load();f.context.setConversationSelection('B');await reading;
    assert.equal(reads,0);assert.equal(f.state.hydrating.size,0);assert.equal(f.state.threadId,'B');
  }finally{focus.reset();}
});

test('background history refreshes never change the selected live stream',async()=>{
  const f=historyFixture('A',[]);f.state.threads.push({id:'B',status:'idle',readOnly:true});f.state.events.set('B',[]);
  f.context.focusEventStream=()=>{throw Error('background history must not change focus');};
  f.context.api=async()=>({events:[],status:'idle'});
  await f.context.loadThread('B');assert.equal(f.state.threadId,'A');
});

test('same-size snapshot corrections before the final message render immediately',async()=>{
  const id='cloud-snapshot:test',last=event(id,1,'unchanged final'),f=historyFixture(id,[event(id,0,'old first','user.message'),last]);
  f.responses.push({events:[event(id,0,'corrected first','user.message'),last],status:'idle',hasMore:false});await f.load();
  assert.equal(f.state.events.get(id)[0].text,'corrected first');assert.equal(f.renders(),1);
});
test('expanded snapshot refresh reloads corrected content outside the last 180 messages',async()=>{
  const id='cloud-snapshot:test',old=Array.from({length:200},(_,index)=>event(id,index,`old ${index}`)),revised=old.map((item,index)=>index===0?{...item,text:'corrected first message'}:item),f=historyFixture(id,old);
  f.state.historyCount.set(id,360);let count;
  f.context.api=async path=>{count=Number(new URL(path,'http://fixture.test').searchParams.get('count'));return{events:revised.slice(-count),status:'idle',hasMore:false};};
  await f.load();assert.equal(count,360);assert.equal(f.state.events.get(id)[0].text,'corrected first message');assert.equal(f.renders(),1);
});
test('identical history reloads do not rerender or remount messages',async()=>{
  const id='cloud-snapshot:test',events=[event(id,0,'same')],f=historyFixture(id,events);
  f.responses.push({events:structuredClone(events),status:'idle',hasMore:false});await f.load();assert.equal(f.renders(),0);
});
test('event endpoint metadata refresh rerenders even with identical body',async()=>{
  const id='cloud-snapshot:test',events=[event(id,0,'same')],f=historyFixture(id,events);
  Object.assign(f.state.threads[0],{snapshotStatus:'running',snapshotStale:false,snapshotContentKind:'summary'});
  f.responses.push({events,status:'idle',snapshot:{id,readOnly:true,status:'idle',snapshotStatus:'completed',snapshotStale:true,snapshotContentKind:'messages'}});await f.load();
  assert.equal(f.renders(),1);assert.equal(f.state.threads[0].snapshotStatus,'completed');assert.equal(f.state.threads[0].snapshotStale,true);
});
test('thread-list metadata changes refresh snapshot notice',async()=>{
  const f=historyFixture(),before={...f.state.threads[0],title:'same',snapshotStatus:'running',snapshotStale:false};f.state.threads=[before];let queued=0;
  Object.assign(f.context,{renderThreads(){},updateControls(){},updateContext(){},queueRender:()=>queued++});
  vm.runInContext(section('async function readThreads()','const sidebarThreadRowState='),f.context);
  f.responses.push({threads:[{...before,snapshotStatus:'completed',snapshotStale:true}]});await vm.runInContext('readThreads()',f.context);assert.equal(queued,1);
});
test('first load announces loading, then empty snapshots are explicit',async()=>{
  const f=historyFixture();let resolve;f.context.api=()=>new Promise(r=>resolve=r);const pending=f.load();
  assert.equal(f.$('historySkeleton').hidden,false);assert.equal(f.$('events').attributes['aria-busy'],'true');assert.equal(f.$('historyEmpty').hidden,true);
  resolve({events:[],status:'idle',hasMore:false});await pending;
  assert.equal(f.$('historySkeleton').hidden,true);assert.equal(f.$('historyEmpty').hidden,false);assert.equal(f.$('historyEmpty').textContent,'此快照没有可见消息。');
});
test('refreshing a loaded empty snapshot does not flash the first-load skeleton',async()=>{
  const f=historyFixture(undefined,[]);let resolve;f.context.api=()=>new Promise(r=>resolve=r);const pending=f.load();assert.equal(f.$('historySkeleton').hidden,true);assert.equal(f.$('historyEmpty').hidden,false);resolve({events:[],status:'idle'});await pending;
});
test('an older navigation request cannot clear the newer conversation loading state',async()=>{
  const f=historyFixture('first');const pending=[];f.context.api=()=>new Promise(r=>pending.push(r));const first=f.load();f.state.threadId='second';f.state.threads.push({id:'second',readOnly:true,status:'idle'});
  const second=vm.runInContext("loadThread('second')",f.context);pending[0]({events:[],status:'idle'});await first;assert.equal(f.$('historySkeleton').hidden,false);
  pending[1]({events:[event('second',0,'second body')],status:'idle'});await second;assert.equal(f.$('historySkeleton').hidden,true);assert.equal(f.$('historyEmpty').hidden,true);
});
test('reselecting a conversation retains only its newer history response and loading state',async()=>{
  const f=historyFixture();const responses=[];f.context.api=(_path,{signal})=>new Promise(resolve=>responses.push({resolve,signal}));const first=f.load();f.context.setConversationSelection(f.state.threadId);
  assert.equal(responses[0].signal.aborted,false);const second=f.load();assert.equal(responses[0].signal.aborted,true);assert.equal(responses[1].signal.aborted,false);
  responses[0].resolve({events:[event(f.state.threadId,0,'stale response')],status:'idle'});await first;assert.equal(f.state.events.has(f.state.threadId),false);assert.equal(f.$('historySkeleton').hidden,false);
  responses[1].resolve({events:[event(f.state.threadId,0,'newest response')],status:'idle'});await second;assert.equal(f.state.events.get(f.state.threadId)[0].text,'newest response');assert.equal(f.$('historySkeleton').hidden,true);
});

test('leaving a conversation aborts shared history and cancels its queued refresh without discarding cached text',async()=>{
  const cached=[event('A',0,'cached text')],f=historyFixture('A',cached);let signal,calls=0;
  f.context.api=(_path,options)=>{calls++;signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));};
  const first=f.load(),shared=f.load(),changed=f.context.loadThread('A',{refresh:true});assert.equal(calls,1);
  f.context.setConversationSelection('B');await Promise.all([first,shared,changed]);
  assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(f.state.events.get('A'),cached);
  assert.equal(f.state.historyReads.size,0);assert.equal(f.state.hydrating.size,0);assert.equal(f.state.historyErrors.size,0);
});

test('an ignored history abort cannot replace cached text or clear a newer visit to the same conversation',async()=>{
  const cached=[event('A',0,'cached text')],f=historyFixture('A',cached),requests=[];
  f.context.api=(_path,{signal})=>new Promise(resolve=>requests.push({signal,resolve}));
  const old=f.load();f.context.setConversationSelection('B');f.context.setConversationSelection('A');const current=f.load();
  assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);assert.equal(requests[1].signal.aborted,false);
  const owner=f.state.historyReads.get('A');requests[0].resolve({events:[event('A',0,'old body')],status:'idle'});await old;
  assert.equal(f.state.events.get('A'),cached);assert.equal(f.state.historyReads.get('A'),owner);assert.equal(f.state.hydrating.has('A'),true);
  requests[1].resolve({events:[event('A',0,'current body')],status:'idle'});await current;
  assert.equal(f.state.events.get('A')[0].text,'current body');assert.equal(f.state.historyReads.size,0);assert.equal(f.state.historyErrors.size,0);
});
test('failed first load clears busy state without inventing empty history',async()=>{
  const f=historyFixture();f.context.api=async()=>{throw Error('fixture offline');};await assert.rejects(f.load(),/fixture offline/);assert.equal(f.$('historySkeleton').hidden,true);assert.equal(f.$('historyEmpty').hidden,true);assert.equal(f.$('events').attributes['aria-busy'],'false');assert.equal(f.$('historyError').hidden,false);assert.match(f.$('historyErrorText').textContent,/fixture offline/);assert.equal(f.$('historyRetry').disabled,false);
});
test('unchanged history status text is not rewritten on repeated streaming renders',()=>{
  const f=historyFixture(),node=f.$('historyErrorText');let text='',writes=0;
  Object.defineProperty(node,'textContent',{get:()=>text,set:value=>{text=value;writes++;}});
  f.state.historyErrors.set(f.state.threadId,{message:'fixture offline',older:false});
  for(let index=0;index<50;index++)vm.runInContext('updateConversationHistoryState()',f.context);
  assert.equal(writes,1,'stable alert content should not create repeated live-region text mutations');assert.match(text,/fixture offline/);
});
test('import opens a member of the submitted batch, not the globally newest snapshot',async()=>{
  const nodes=[],actions=new Map();let opened;
  const el=(tag)=>{const node={tag,value:'',append(){},setAttribute(){},addEventListener(){},showModal(){},close(){},focus(){}};nodes.push(node);return node;};
  const context={state:{capabilities:['cloud-snapshot-readonly'],threads:[],generation:0,selection:0,page:'chat'},onlineRequired:()=>true,el,button:(name,action)=>{actions.set(name,action);return{};},document:{body:{append(){}}},run:f=>f(),toast(){},refreshThreads:async()=>{},openThread:async thread=>opened=thread.id,errorMessage,api:async()=>({imported:1,threads:[{id:'cloud-snapshot:newer-unrelated'},{id:'cloud-snapshot:requested'}]})};
  vm.createContext(context);vm.runInContext(section('function showCloudSnapshotImport()',"$('cloudSnapshotImportBtn').onclick"),context);vm.runInContext('showCloudSnapshotImport()',context);
  nodes.find(node=>node.tag==='textarea').value=JSON.stringify({schemaVersion:1,snapshots:[{externalId:'requested'}]});await actions.get('导入')();assert.equal(opened,'cloud-snapshot:requested');
});
function scrollingFixture(){
  let now=100,anchorCalls=0;const listeners=new Map(),frames=new Map();let next=0;
  const scroll={scrollTop:1500,scrollHeight:2000,clientHeight:500,addEventListener:(type,fn)=>listeners.set(type,fn),scrollTo({top}){this.scrollTop=top;},getBoundingClientRect:()=>({right:500})};
  const jump={hidden:true},welcome={hidden:true};
  const c={$:name=>name==='conversationScroll'?scroll:name==='welcome'?welcome:jump,performance:{now:()=>now},matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),rememberReadingAnchor:()=>anchorCalls++,followConversation:true,jumpScrolling:false,jumpScrollingUntil:0,userScrollUntil:0,readingAnchor:null,run(){},loadOlderMessages(){}};
  vm.createContext(c);vm.runInContext(section('let followFrame=','function rememberReadingAnchor()'),c);
  vm.runInContext(section('$("conversationScroll").onscroll =',"$('loadOlder').onclick"),c);
  if(source.includes('function beginConversationReview('))vm.runInContext(section('function beginConversationReview(',"$('conversationScroll').addEventListener('wheel'"),c);
  const key=(key,closest=null,extra={})=>listeners.get('keydown')?.({key,target:{closest:selector=>closest&&selector.includes(closest)?{}:null},...extra});
  return {c,scroll,key,frames,anchorCalls:()=>anchorCalls,setNow:value=>now=value};
}
test('keyboard PageUp pauses streaming follow before the next frame',()=>{
  const f=scrollingFixture();f.scroll.scrollTop=1300;vm.runInContext('followLatestPosition()',f.c);assert.equal(f.frames.size,1);
  f.key('PageUp');f.scroll.scrollTop=1000;f.scroll.onscroll();vm.runInContext('followLatestPosition()',f.c);
  assert.equal(f.c.followConversation,false);assert.equal(f.frames.size,0);assert.equal(f.scroll.scrollTop,1000);assert(f.anchorCalls()>0);
});
test('End rejoins following only after actually reaching latest',()=>{
  const f=scrollingFixture();f.c.followConversation=false;f.key('End');f.scroll.scrollTop=1500;f.scroll.onscroll();assert.equal(f.c.followConversation,true);
});
test('composer, controls, summary Space and modifier keys keep their native behavior',()=>{
  for(const [key,closest,extra] of [['ArrowUp','input',{}],['Home','textarea',{}],['ArrowDown','select',{}],[' ','summary',{}],['PageUp',null,{ctrlKey:true}],['Home',null,{isComposing:true}]]){
    const f=scrollingFixture();f.key(key,closest,extra);assert.equal(f.c.followConversation,true);assert.equal(f.anchorCalls(),0);
  }
});
test('keyboard review interrupts jump-to-latest at its current position',()=>{
  const f=scrollingFixture();f.c.jumpScrolling=true;f.c.jumpScrollingUntil=2500;f.scroll.scrollTop=900;f.key('Home');assert.equal(f.c.jumpScrolling,false);assert.equal(f.c.followConversation,false);assert.equal(f.scroll.scrollTop,900);
});
test('a changed message height preserves the current reading anchor through a render',()=>{
  let messageTop=80;
  const node={dataset:{messageKey:'stable-message'},getBoundingClientRect:()=>({top:messageTop,bottom:messageTop+200})};
  const scroll={scrollTop:1000,getBoundingClientRect:()=>({top:100})};
  const c={$:id=>id==='events'?{children:[node]}:scroll,followConversation:false,jumpScrolling:false,readingAnchor:null,followLatestPosition(){throw Error('reader must not be followed');}};
  vm.createContext(c);vm.runInContext(section('function rememberReadingAnchor()','const conversationResize'),c);vm.runInContext('rememberReadingAnchor()',c);
  messageTop=140;vm.runInContext('restoreReadingAnchor()',c);assert.equal(scroll.scrollTop,1060);assert.equal(c.readingAnchor.key,'stable-message');
});
test('reduced motion follows latest immediately without scheduling animation frames',()=>{
  const f=scrollingFixture();f.scroll.scrollTop=1000;f.c.matchMedia=()=>({matches:true});vm.runInContext('followLatestPosition()',f.c);assert.equal(f.scroll.scrollTop,1500);assert.equal(f.frames.size,0);
});
test('conversation navigation clears the old follow and jump animation state',()=>{
  const f=scrollingFixture();Object.assign(f.c,{state:{threadId:'new',pending:null},conversationThread:'old',conversationCache:new Map(),outgoingMessageKeys:new Map()});f.c.jumpScrolling=true;f.c.userScrollUntil=1600;f.scroll.scrollTop=1000;vm.runInContext('followLatestPosition()',f.c);
  const line=source.split('\n').find(line=>line.includes('if (conversationThread !== state.threadId)'));assert(line);vm.runInContext(line,f.c);assert.equal(f.c.jumpScrolling,false);assert.equal(f.c.userScrollUntil,0);assert.equal(f.c.followConversation,true);assert.equal(f.frames.size,0);
});
test('an explicit gpt-6.1-sol choice remains high without changing global settings',()=>{
  const models=['gpt-6-sol','gpt-6.1-sol','gpt-6-astra'].map(model=>({model,displayName:model,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}));
  const elements=new Map(),saved=new Map([['cmc.model.codex','gpt-6.1-sol']]);
  const $=id=>{if(!elements.has(id))elements.set(id,{value:'',options:[],dataset:{},replaceChildren(...options){this.options=options;this.value='';},add(option){this.options.push(option);}});return elements.get(id);};
  class Option{constructor(text,value){this.text=text;this.value=value;this.dataset={};}}
  const settings={model:'gpt-6-sol',reasoningEffort:'medium'},c={state:{models,harness:'codex',connected:true,settings},$,Option,safeRead:key=>saved.get(key)||'',fillEfforts(){},updateBackendNotice(){}};
  vm.createContext(c);vm.runInContext(section('function fillModelChoices(',"$('chatModel').addEventListener('change'"),c);vm.runInContext('fillModelChoices()',c);
  assert.equal($('chatModel').value,'gpt-6.1-sol');assert.equal($('chatEffort').value,'high');assert.deepEqual(settings,{model:'gpt-6-sol',reasoningEffort:'medium'});
  $('chatModel').value='gpt-6-astra';vm.runInContext('fillChatEfforts()',c);assert.equal($('chatEffort').value,'medium');
  saved.set('cmc.effort.gpt-6-astra','high');vm.runInContext('fillChatEfforts()',c);assert.equal($('chatEffort').value,'medium','an unchanged model keeps the current control selection');
  $('chatModel').value='gpt-6.1-sol';vm.runInContext('fillChatEfforts()',c);
  $('chatModel').value='gpt-6-astra';vm.runInContext('fillChatEfforts()',c);assert.equal($('chatEffort').value,'high');
});
