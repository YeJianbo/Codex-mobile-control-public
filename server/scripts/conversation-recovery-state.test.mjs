import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {mergeEvents,retainCompaction,errorMessage,restoreActivityDetails} from '../public/console-core.js';

// Execute the shipped implementations with deterministic delayed HTTP results.
// DOM doubles model state and request ownership only. These checks are not
// browser-frame, animation, layout, or real scroll-physics validation.
const source=(await fs.readFile(process.env.CMC_CONSOLE_SOURCE||new URL('../public/console.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing shipped source section: ${start}`);return source.slice(a,b);}
const shipped={
  connect:section('async function connect(','function connectSocket('),
  disconnect:section('function disconnect()','function sendCommand('),
  threads:section('function conversationThreadKey(','function renderThreads()'),
  navigation:section('async function newThread()','const desktopModelSettings='),
  selection:section('function setConversationSelection(','async function selectProject('),
  history:section('function sameConversationEvents(','const slashCommands='),
  equality:section('function sameConversationData(','let conversationThread ='),
  queue:section('async function refreshQueue(','async function queueAction('),
  drafts:section('function draftKey(','const {trackFilePreview,'),
  recovery:section('function readPendingSubmission()','function showCloudSnapshotImport('),
  restorePending:section('function restorePendingDraft()','function updateContext()'),
  anchor:section('function rememberReadingAnchor()','const conversationResize'),
  input:section('$("prompt").oninput =','$("prompt").onkeydown ='),
};
const retryClick=source.split('\n').find(line=>line.includes("$('historyRetry').onclick="));
assert(retryClick,'Missing shipped inline history retry handler');
const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class Node{
  constructor(tag='div',className='',text=''){
    Object.assign(this,{tag,className,textContent:text||'',value:'',hidden:true,disabled:false,dataset:{},attributes:{},children:[],options:[],offsetWidth:1,scrollTop:800,top:100,bottom:300});
    const classes=new Set(className.split(' ').filter(Boolean));
    this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name)};
  }
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getBoundingClientRect(){return{top:this.top,bottom:this.bottom};}
  focus(){}
}
function fixture({initial='A',cached,saved}={}){
  const elements=new Map(),requests=[],renders=[],toasts=[],sent=[],timers=[],storage=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,new Node());return elements.get(id);};
  const el=(tag,cls,text)=>new Node(tag,cls,text);
  const state={imageDrafts:{},fileDrafts:{},threadId:initial,selection:0,generation:0,harness:'codex',page:'chat',connected:true,connecting:false,token:'fixture-test-token',reconnectTimer:null,reconnectAttempt:0,
    threads:['A','B','receipt'].map(id=>({id,title:id,status:'idle',projectPath:'/fixture-project'})),projects:[{id:'project',path:'/fixture-project'}],chatProject:'project',models:[],drafts:{},draftRevisions:new Map(),draftEpoch:'fixture-current-epoch',composerRevision:0,
    events:new Map(cached===undefined?[]:[[initial,cached]]),hydrating:new Map(),historyLoading:new Set(),historyErrors:new Map(),historyCount:new Map(),historyMore:new Map(),writerLocked:new Set(),queueRequests:new Map(),pending:null,capabilities:['local-task-receipts']};
  if(saved){storage.set('cmc.pendingSubmit',JSON.stringify(saved));state.drafts[saved.key]=saved.text;}
  $('prompt').value=saved?.text||'';
  $('chatModel').value='gpt-6.1-sol';$('chatModel').options=[{value:'gpt-6.1-sol',disabled:false}];
  $('chatEffort').value='high';$('chatEffort').options=[{value:'high'}];
  const messageNode=new Node();messageNode.dataset.messageKey='cached-reader-anchor';messageNode.top=80;
  $('events').append(messageNode);
  const context={state,$,el,AbortController,eventFocus:{reset(){}},focusEventStream:()=>null,cancelActivityReads(){},syncDesktopModelSettings:()=>false,desktopModelSettings:new Map(),mergeEvents,retainCompaction,errorMessage,restoreActivityDetails,comparablePath:value=>value,conversationGeneration:-1,followConversation:true,readingAnchor:null,jumpScrolling:false,
    api:(path,options)=>{const response=deferred();requests.push({path,options,...response,settled:false});options?.signal?.addEventListener('abort',()=>response.reject(new DOMException('Aborted','AbortError')),{once:true});return response.promise;},
    button:(label,action,cls)=>{const node=el('button',cls,label);node.onclick=action;return node;},
    activeThread:()=>state.threads.find(thread=>thread.id===state.threadId),onlineRequired:()=>state.connected,
    safeRead:key=>storage.get(key)||'',safeWrite:(key,value)=>storage.set(key,value),harnessForThread:()=> 'codex',
    renderThreads(){},renderProjects(){},updateControls(){},updateContext(){},queueRender(){},fillModelChoices(){},fillChatEfforts(){},showPage(){},closeDrawer(){},updateHarnessLabel(){},
    saveImageDrafts(){storage.set('cmc.imageDrafts',JSON.stringify(state.imageDrafts));},saveFileDrafts(){storage.set('cmc.fileDrafts',JSON.stringify(state.fileDrafts));},
    desktopRefreshTimer:null,outputImageGrants:new Map(),outputImageDimensions:new Map(),
    resizeComposer(){},renderImageDrafts(){},renderFileDrafts(){},renderSlashCommands(){},followLatestPosition(){},updateConnection(){},closeDialog(){},
    cancelUpload(){},closeFilePreviews(){},syncQueueRestoreCopies(){},queueThreadMatches(){},
    refreshProjects:async()=>{},loadSettings:async()=>{},refreshTerminals:async()=>{},refreshApprovals:async()=>{},refreshDevices:async()=>{},
    connectSocket:async generation=>{if(generation===state.generation)state.connected=true;},
    toast:(...args)=>toasts.push(args),sendCommand:command=>sent.push(command),iconNode:name=>el('svg',name),showMenu(){},restoreQueuedMessage(){},queueAction(){},copy(){},run:action=>action(),
    setTimeout:(action,delay)=>{const timer={action,delay};timers.push(timer);return timer;},clearTimeout(){},
  };
  vm.createContext(context);
  context.renderConversation=()=>{renders.push(state.threadId);context.conversationGeneration=state.generation;vm.runInContext('updateConversationHistoryState();restoreReadingAnchor()',context);};
  vm.runInContext(Object.values(shipped).join('\n')+'\n'+retryClick,context);
  const call=(name,...args)=>{context.__args=args;return vm.runInContext(`${name}(...__args)`,context);};
  const pending=fragment=>requests.filter(request=>!request.settled&&!request.options?.signal?.aborted&&request.path.includes(fragment));
  const settle=(request,value,reject=false)=>{assert(request&&!request.settled,'Expected an outstanding API request');request.settled=true;request[reject?'reject':'resolve'](value);};
  const input=value=>{$('prompt').value=value;return $('prompt').oninput();};
  const seedHistory=(id='A',text='cached body',hasMore=true)=>{state.events.set(id,history(id,text,hasMore).events);state.historyCount.set(id,180);state.historyMore.set(id,hasMore);call('updateConversationHistoryState');};
  return{state,$,context,call,requests,pending,settle,renders,toasts,sent,timers,storage,input,seedHistory};
}
const history=(id,text,hasMore=false)=>({events:[{threadId:id,eventId:`${id}:message`,itemId:'message',type:'message.delta',text}],status:'idle',hasMore});
const savedSubmission=(overrides={})=>({requestId:'fixture-request',threadId:'A',project:'project',key:'thread:A',text:'continue',command:{type:'turn.start',threadId:'A',text:'continue',requestId:'fixture-request'},...overrides});
const health=(capabilities=['local-task-receipts'])=>({ok:true,protocolVersion:1,minAndroidProtocolVersion:1,capabilities});
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
async function completeHistory(f,request,value,queueError){
  f.settle(request,value);await flush();
  for(const queue of f.pending('/queue'))f.settle(queue,queueError||{messages:[]},Boolean(queueError));
  await flush();
}
async function advanceConnection(f,healthRequest=f.pending('/health')[0],capabilities){
  f.settle(healthRequest,health(capabilities));await flush();
  f.settle(f.pending('/api/projects')[0],{projects:f.state.projects});await flush();
  const list=f.pending('/api/threads').filter(request=>request.path==='/api/threads').at(-1);
  if(list)f.settle(list,{threads:f.state.threads});
  await flush();
}

test('concurrent history refreshes share one read and preserve buffered live events',async()=>{
  const f=fixture(),loading=f.call('loadThread','A'),buffer=f.state.hydrating.get('A');
  const joined=Array.from({length:5},()=>f.call('loadThread','A'));
  assert.equal(f.pending('/A/events').length,1);assert.equal(f.state.hydrating.get('A'),buffer);
  buffer.push({threadId:'A',type:'message.delta',eventId:'live',itemId:'live',text:'arrived while loading'});
  await completeHistory(f,f.pending('/A/events')[0],history('A','loaded history'));
  await Promise.all([loading,...joined]);
  assert.equal(f.state.events.get('A').at(-1).text,'arrived while loading');
  assert.equal(f.requests.filter(request=>request.path.includes('/A/events')).length,1);
  assert.equal(f.state.historyReads.size,0);assert.equal(f.state.hydrating.size,0);
});

test('history invalidations during a read coalesce into one trailing read',async()=>{
  const f=fixture(),loading=f.call('loadThread','A');
  const invalidations=Array.from({length:5},()=>f.call('loadThread','A',{refresh:true}));
  assert.equal(f.pending('/A/events').length,1);
  await completeHistory(f,f.pending('/A/events')[0],history('A','first snapshot'));
  const trailing=f.pending('/A/events')[0];assert(trailing);
  const joined=f.call('loadThread','A');assert.equal(f.pending('/A/events').length,1);
  await completeHistory(f,trailing,history('A','latest snapshot'));
  await Promise.all([loading,joined,...invalidations]);
  assert.equal(f.requests.filter(request=>request.path.includes('/A/events')).length,2);
  assert.equal(f.state.events.get('A')[0].text,'latest snapshot');assert.equal(f.state.historyReads.size,0);
});

test('same-ID navigation gets a new history owner and retires a queued old refresh',async()=>{
  const f=fixture(),loading=f.call('loadThread','A'),old=f.pending('/A/events')[0];
  const invalidation=f.call('loadThread','A',{refresh:true});
  const opening=f.call('openThread',f.state.threads[0]),latest=f.pending('/A/events').find(request=>request!==old);
  assert(latest);const owner=f.state.historyReads.get('A');
  await completeHistory(f,old,history('A','retired selection'));
  await Promise.all([loading,invalidation]);assert.equal(f.state.historyReads.get('A'),owner);
  assert.equal(f.state.hydrating.has('A'),true);
  await completeHistory(f,latest,history('A','current selection'));await opening;
  assert.equal(f.requests.filter(request=>request.path.includes('/A/events')).length,2);
  assert.equal(f.state.events.get('A')[0].text,'current selection');assert.equal(f.state.historyReads.size,0);
});

test('shared history failure releases its owner so an explicit retry can recover',async()=>{
  const f=fixture(),attempts=Array.from({length:3},()=>outcome(f.call('loadThread','A')));
  assert.equal(f.pending('/A/events').length,1);
  f.settle(f.pending('/A/events')[0],Error('shared history offline'),true);
  for(const result of await Promise.all(attempts))assert.match(result.error.message,/shared history offline/);
  assert.equal(f.state.historyReads.size,0);assert.equal(f.state.hydrating.size,0);
  const retry=f.call('loadThread','A');await completeHistory(f,f.pending('/A/events')[0],history('A','recovered'));await retry;
  assert.equal(f.state.events.get('A')[0].text,'recovered');assert.equal(f.state.historyErrors.has('A'),false);
});

test('failed first load shows inline error and its shipped retry recovers the conversation',async()=>{
  const f=fixture(),opening=outcome(f.call('openThread',f.state.threads[0]));
  assert.equal(f.$('historySkeleton').hidden,false);assert.equal(f.$('events').attributes['aria-busy'],'true');
  f.settle(f.pending('/A/events')[0],Error('first load offline'),true);assert.match((await opening).error.message,/first load offline/);
  assert.equal(f.$('historyError').hidden,false);assert.match(f.$('historyErrorText').textContent,/first load offline/);
  assert.equal(f.$('historyEmpty').hidden,true);assert.equal(f.$('historySkeleton').hidden,true);assert.equal(f.$('events').attributes['aria-busy'],'false');
  const retry=f.$('historyRetry').onclick();assert.equal(f.$('historyRetry').disabled,true);assert.equal(f.$('historySkeleton').hidden,false);
  await completeHistory(f,f.pending('/A/events')[0],history('A','recovered body'));await retry;
  assert.equal(f.state.events.get('A')[0].text,'recovered body');assert.equal(f.state.historyErrors.has('A'),false);
  assert.equal(f.$('historyError').hidden,true);assert.equal(f.$('historyRetry').disabled,false);assert.equal(f.$('events').attributes['aria-busy'],'false');
});

test('failed refresh retains cached history and reader position through inline retry success',async()=>{
  const f=fixture();f.seedHistory();f.context.followConversation=false;f.call('rememberReadingAnchor');
  const cached=f.state.events.get('A'),anchor=f.context.readingAnchor,top=f.$('conversationScroll').scrollTop;
  const refresh=outcome(f.call('loadThread','A'));assert.equal(f.$('historySkeleton').hidden,true);
  f.settle(f.pending('/A/events')[0],Error('refresh failed'),true);await refresh;
  assert.equal(f.state.events.get('A'),cached);assert.equal(f.context.readingAnchor,anchor);assert.equal(f.$('conversationScroll').scrollTop,top);
  assert.equal(f.$('historyError').hidden,false);assert.equal(f.$('historyEmpty').hidden,true);
  const retry=f.call('retryConversationHistory');await completeHistory(f,f.pending('/A/events')[0],history('A','updated body',true));await retry;
  assert.equal(f.state.events.get('A')[0].text,'updated body');assert.equal(f.$('historyError').hidden,true);assert.equal(f.$('conversationScroll').scrollTop,top);
});

test('repeated first-load errors retry to an explicitly empty conversation without stale alerts',async()=>{
  const f=fixture();
  for(const message of ['first outage','second outage']){
    const loading=outcome(f.call('retryConversationHistory'));f.settle(f.pending('/A/events')[0],Error(message),true);
    assert.match((await loading).error.message,new RegExp(message));assert.match(f.$('historyErrorText').textContent,new RegExp(message));
    assert.equal(f.$('historyRetry').disabled,false);assert.equal(f.$('historyEmpty').hidden,true);assert.equal(f.state.events.has('A'),false);
  }
  const retry=f.$('historyRetry').onclick();await completeHistory(f,f.pending('/A/events')[0],{events:[],status:'idle',hasMore:false});await retry;
  assert.equal(f.state.events.get('A').length,0);assert.equal(f.$('historyError').hidden,true);assert.equal(f.$('historyErrorText').textContent,'');
  assert.equal(f.$('historyEmpty').hidden,false);assert.equal(f.$('historyEmpty').textContent,'此会话还没有消息。');assert.equal(f.$('historySkeleton').hidden,true);
});

test('pagination failure and retry preserve count, cached body, and reader anchor until success',async()=>{
  const f=fixture();f.seedHistory();const cached=f.state.events.get('A'),top=f.$('conversationScroll').scrollTop;
  const pagination=outcome(f.call('loadOlderMessages')),first=f.pending('/A/events')[0];
  assert.match(first.path,/[?&]count=360(?:&|$)/);const anchor={...f.context.readingAnchor};
  f.settle(first,Error('older page unavailable'),true);await pagination;
  assert.equal(f.state.historyCount.get('A'),180);assert.equal(f.state.historyMore.get('A'),true);assert.equal(f.state.events.get('A'),cached);
  assert.deepEqual({...f.context.readingAnchor},anchor);assert.equal(f.$('conversationScroll').scrollTop,top);assert.equal(f.context.followConversation,false);
  assert.equal(f.state.historyErrors.get('A').older,true);assert.match(f.$('historyErrorText').textContent,/更早消息加载失败/);
  assert.equal(f.$('loadOlder').disabled,false);assert.equal(f.$('historyRetry').disabled,false);
  const retry=f.$('historyRetry').onclick(),second=f.pending('/A/events')[0];assert.match(second.path,/[?&]count=360(?:&|$)/);
  assert.equal(f.$('loadOlder').disabled,true);assert.equal(f.state.historyCount.get('A'),180);
  await completeHistory(f,second,history('A','expanded body',false));await retry;
  assert.equal(f.state.historyCount.get('A'),360);assert.equal(f.state.historyMore.get('A'),false);assert.equal(f.$('loadOlder').hidden,true);
  assert.deepEqual({...f.context.readingAnchor},anchor);assert.equal(f.$('conversationScroll').scrollTop,top);assert.equal(f.$('historyError').hidden,true);
});

for(const older of [false,true])test(`rapid inline ${older?'pagination':'first-load'} retries issue one request and release retry controls`,async()=>{
  const f=fixture();if(older)f.seedHistory();f.state.historyErrors.set('A',{message:'retry me',older});f.call('updateConversationHistoryState');
  const attempts=Array.from({length:5},()=>f.$('historyRetry').onclick());
  assert.equal(f.pending('/A/events').length,1);assert.equal(f.$('historyRetry').disabled,true);
  await completeHistory(f,f.pending('/A/events')[0],history('A','single retry response'));await Promise.all(attempts);
  assert.equal(f.$('historyRetry').disabled,false);assert.equal(f.$('historyError').hidden,true);assert.equal(f.state.hydrating.size,0);assert.equal(f.state.historyLoading.size,0);
});

test('history recovery succeeds even when the independent queue refresh fails',async()=>{
  const f=fixture();f.state.historyErrors.set('A',{message:'previous history failure',older:false});
  const loading=outcome(f.call('retryConversationHistory'));
  await completeHistory(f,f.pending('/A/events')[0],history('A','history succeeded',true),Error('queue-only offline'));
  assert.equal((await loading).error,undefined);assert.equal(f.state.events.get('A')[0].text,'history succeeded');assert.equal(f.state.historyErrors.has('A'),false);
  assert.equal(f.$('historyError').hidden,true);assert.equal(f.$('events').attributes['aria-busy'],'false');
});

for(const rejection of [false,true])test(`retired-generation history ${rejection?'failure':'success'} cannot retire a newer same-ID reconnect owner`,async()=>{
  const f=fixture(),retired=outcome(f.call('loadThread','A')),old=f.pending('/A/events')[0];
  const reconnecting=f.call('connect');await advanceConnection(f);const current=f.pending('/A/events').find(request=>request!==old);
  assert(current,'reconnect must start current-generation history');const owner=f.state.hydrating.get('A');
  f.settle(old,rejection?Error('retired gateway offline'):history('A','retired body'),rejection);assert.equal((await retired).error,undefined);
  assert.equal(f.state.hydrating.get('A'),owner);assert.equal(f.$('historySkeleton').hidden,false);assert.equal(f.$('events').attributes['aria-busy'],'true');assert.equal(f.state.historyErrors.has('A'),false);
  await completeHistory(f,current,history('A','current gateway body'));await reconnecting;
  assert.equal(f.state.events.get('A')[0].text,'current gateway body');assert.equal(f.state.hydrating.has('A'),false);
});

test('a retired pagination request cannot block current-generation reconnect history',async()=>{
  const f=fixture();f.seedHistory();const retired=outcome(f.call('loadOlderMessages')),old=f.pending('/A/events')[0];
  const reconnecting=f.call('connect');await advanceConnection(f);
  const current=f.pending('/A/events').find(request=>request!==old);
  assert(current,'retired pagination must not suppress reconnect loading for the same ID');
  await completeHistory(f,current,history('A','reconnected body',true));await reconnecting;
  f.settle(old,history('A','retired expanded body',false));await retired;assert.equal(f.state.events.get('A')[0].text,'reconnected body');
});

for(const rejection of [false,true])test(`retired loadOlder ${rejection?'rejection':'finally'} cannot release a newer same-ID pagination owner`,async()=>{
  const f=fixture();f.seedHistory();const retired=outcome(f.call('loadOlderMessages')),old=f.pending('/A/events')[0];
  const reconnecting=f.call('connect');await advanceConnection(f);const current=f.pending('/A/events').find(request=>request!==old);
  assert(current,'reconnect must load independently of retired pagination');await completeHistory(f,current,history('A','reconnected body',true));await reconnecting;
  const newer=f.call('loadOlderMessages'),newRequest=f.pending('/A/events').find(request=>request!==old),owner=f.state.hydrating.get('A');
  assert(newRequest,'the current generation must own new pagination');assert.equal(f.$('loadOlder').disabled,true);
  f.settle(old,rejection?Error('retired page offline'):history('A','retired page'),rejection);assert.equal((await retired).error,undefined);
  assert.equal(f.state.hydrating.get('A'),owner);assert.equal(f.state.historyLoading.has('A'),true);assert.equal(f.$('loadOlder').disabled,true);assert.equal(f.$('historyRetry').disabled,true);
  await completeHistory(f,newRequest,history('A','new owner expanded body'));await newer;assert.equal(f.$('loadOlder').disabled,false);
});

test('retired health response cannot overwrite current connection capabilities or start old projects',async()=>{
  const f=fixture({initial:''}),first=f.call('connect'),old=f.pending('/health')[0],second=f.call('connect'),latest=f.pending('/health').find(request=>request!==old);
  await advanceConnection(f,latest,['cloud-snapshot-readonly','local-task-receipts']);await second;
  f.settle(old,health(['obsolete-capability']));await flush();
  const oldProjects=f.pending('/api/projects');for(const request of oldProjects)f.settle(request,{projects:[]});await first;
  assert.deepEqual(Array.from(f.state.capabilities),['cloud-snapshot-readonly','local-task-receipts']);assert.equal(oldProjects.length,0,'retired health must stop before authenticated project retrieval');
});

test('a connect retired during boot refresh cannot start same-ID history over a newer owner',async()=>{
  const f=fixture(),retired=f.call('connect');f.settle(f.pending('/health')[0],health());await flush();f.settle(f.pending('/api/projects')[0],{projects:f.state.projects});await flush();
  const oldList=f.pending('/api/threads').find(request=>request.path==='/api/threads');assert(oldList);
  const reconnecting=f.call('connect');await advanceConnection(f);const current=f.pending('/A/events')[0],owner=f.state.hydrating.get('A');assert(current);
  f.settle(oldList,{threads:f.state.threads});await flush();const extra=f.pending('/A/events').filter(request=>request!==current);
  assert.equal(extra.length,0,'retired boot completion must not enqueue history in the new generation');assert.equal(f.state.hydrating.get('A'),owner);
  await completeHistory(f,current,history('A','current boot body'));await reconnecting;await retired;
});

test('disconnect retires loading presentation and a late history failure stays silent',async()=>{
  const f=fixture(),loading=outcome(f.call('loadThread','A')),request=f.pending('/A/events')[0];f.call('disconnect');
  assert.equal(f.$('historySkeleton').hidden,true,'retired connection must not leave a first-load skeleton');assert.equal(f.$('events').attributes['aria-busy'],'false');
  f.settle(request,Error('disconnected request'),true);assert.equal((await loading).error,undefined);assert.equal(f.state.historyErrors.has('A'),false);
});

test('accepted receipt after newer same-ID navigation preserves the new continue draft and selection',async()=>{
  const saved=savedSubmission(),f=fixture({saved}),recovering=f.call('recoverLocalSubmission'),receipt=f.pending('/api/local-tasks/')[0];
  const newer=f.call('openThread',f.state.threads[0]);await completeHistory(f,f.pending('/A/events')[0],history('A','new selected history'));await newer;f.input('continue');const selection=f.state.selection;
  f.settle(receipt,{request:{state:'accepted',threadId:'receipt'}});await flush();
  for(const request of f.pending('/api/threads').filter(request=>request.path==='/api/threads'))f.settle(request,{threads:f.state.threads});await flush();
  for(const request of f.pending('/receipt/events'))await completeHistory(f,request,history('receipt','old receipt body'));await recovering;
  assert.equal(f.state.threadId,'A');assert.equal(f.state.selection,selection);assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.drafts['thread:A'],'continue');
});

test('navigation while receipt thread-list refresh is delayed prevents the later receipt open',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission');f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted',threadId:'receipt'}});await flush();
  const list=f.pending('/api/threads').find(request=>request.path==='/api/threads');assert(list);
  const navigation=f.call('openThread',f.state.threads[1]);await completeHistory(f,f.pending('/B/events')[0],history('B','new selection'));await navigation;f.input('continue');const selection=f.state.selection;
  f.settle(list,{threads:f.state.threads});await flush();for(const request of f.pending('/receipt/events'))await completeHistory(f,request,history('receipt','old receipt body'));await recovering;
  assert.equal(f.state.threadId,'B');assert.equal(f.state.selection,selection);assert.equal(f.$('prompt').value,'continue');
});

test('an edited then identical continue draft survives a delayed accepted receipt in the same selection',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission');f.input('continue with a different request');f.input('continue');const selection=f.state.selection;
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await recovering;
  assert.equal(f.state.selection,selection);assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.drafts['thread:A'],'continue','accepted old text must not delete a newly edited identical draft');
});

test('new continue input during receipt-owned history loading is not cleared on recovery completion',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission');f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted',threadId:'receipt'}});await flush();
  f.settle(f.pending('/api/threads').find(request=>request.path==='/api/threads'),{threads:f.state.threads});await flush();const request=f.pending('/receipt/events')[0];assert(request);
  f.input('continue with new work');f.input('continue');await completeHistory(f,request,history('receipt','receipt body'));await recovering;
  assert.equal(f.state.threadId,'receipt');assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.drafts['thread:receipt'],'continue');
});

test('delayed 404 retry cannot resend the saved command from a newer same-text selection',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission',true);await f.call('newThread');f.input('continue');
  f.settle(f.pending('/api/local-tasks/')[0],Object.assign(Error('not found'),{status:404}),true);await recovering;
  assert.equal(f.sent.length,0,'new same-text draft does not authorize resending the old command');assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.pending,null);assert(f.storage.get('cmc.pendingSubmit'));
});

test('retired-generation receipt does not clear a newer pending request or its persisted record',async()=>{
  const old=savedSubmission(),f=fixture({saved:old}),recovering=f.call('recoverLocalSubmission'),request=f.pending('/api/local-tasks/')[0];
  f.call('disconnect');const latest=savedSubmission({requestId:'fixture-new-request',text:'new work'});f.state.pending={...latest,selection:f.state.selection};f.storage.set('cmc.pendingSubmit',JSON.stringify(latest));f.input('new work');
  f.settle(request,{request:{state:'accepted'}});await recovering;
  assert.equal(f.state.pending.requestId,latest.requestId);assert.equal(JSON.parse(f.storage.get('cmc.pendingSubmit')).requestId,latest.requestId);assert.equal(f.$('prompt').value,'new work');
});

test('rapid receipt recovery coalesces one lookup and accepted recovery clears only its untouched draft',async()=>{
  const f=fixture({saved:savedSubmission()}),first=f.call('recoverLocalSubmission'),second=f.call('recoverLocalSubmission');assert.equal(f.pending('/api/local-tasks/').length,1);
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await Promise.all([first,second]);
  assert.equal(f.storage.get('cmc.pendingSubmit'),'');assert.equal(f.$('prompt').value,'');assert.equal(f.state.drafts['thread:A'],undefined);assert.equal(f.sent.length,0);
});

test('untouched accepted receipt opens its confirmed thread and retires only the submitted draft',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission');f.state.drafts['thread:B']='other draft';
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted',threadId:'receipt'}});await flush();
  f.settle(f.pending('/api/threads').find(request=>request.path==='/api/threads'),{threads:f.state.threads});await flush();
  await completeHistory(f,f.pending('/receipt/events')[0],history('receipt','confirmed conversation'));await recovering;
  assert.equal(f.state.threadId,'receipt');assert.equal(f.state.events.get('receipt')[0].text,'confirmed conversation');
  assert.equal(f.state.drafts['thread:A'],undefined);assert.equal(f.state.drafts['thread:B'],'other draft');assert.equal(f.storage.get('cmc.pendingSubmit'),'');
});

test('retired receipt finally cannot clear a newer recovery owner or duplicate its current lookup',async()=>{
  const f=fixture({saved:savedSubmission()}),retired=f.call('recoverLocalSubmission'),old=f.pending('/api/local-tasks/')[0];
  const latest=savedSubmission({requestId:'fixture-current-request',text:'current submitted text'});f.storage.set('cmc.pendingSubmit',JSON.stringify(latest));f.state.pending={...latest,selection:f.state.selection};f.input(latest.text);
  const reconnecting=f.call('connect');await advanceConnection(f);await completeHistory(f,f.pending('/A/events')[0],history('A','current gateway body'));
  const current=f.pending('/api/local-tasks/').find(request=>request!==old);assert(current,'the current generation must recover its persisted request');
  f.settle(old,{request:{state:'accepted'}});await retired;
  assert.equal(JSON.parse(f.storage.get('cmc.pendingSubmit')).requestId,latest.requestId);assert.equal(f.state.pending.requestId,latest.requestId);
  const joined=f.call('recoverLocalSubmission');assert.equal(f.pending('/api/local-tasks/').length,1,'old finally must not clear the new coalescing owner');
  f.settle(current,{request:{state:'accepted'}});await Promise.all([reconnecting,joined]);assert.equal(f.storage.get('cmc.pendingSubmit'),'');assert.equal(f.state.pending,null);assert.equal(f.sent.length,0);
});

test('a failed receipt after navigation does not restore old text into a new empty draft',async()=>{
  const f=fixture({saved:savedSubmission()}),recovering=f.call('recoverLocalSubmission');await f.call('newThread');
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'failed',error:'fixture receipt failed'}});await recovering;
  assert.equal(f.state.threadId,'');assert.equal(f.$('prompt').value,'');assert.equal(f.state.drafts['thread:A'],'continue');assert.equal(f.sent.length,0);
});

test('an untouched same-epoch submitted revision is cleaned after receipt acceptance',async()=>{
  const f=fixture({saved:savedSubmission()});f.input('continue');
  const submitted=savedSubmission({draftEpoch:f.state.draftEpoch,draftRevision:f.state.draftRevisions.get('thread:A')});f.storage.set('cmc.pendingSubmit',JSON.stringify(submitted));
  assert.equal(submitted.draftRevision,1,'the shipped input handler must create submitted revision ownership');
  const revision=f.state.draftRevisions.get('thread:A'),recovering=f.call('recoverLocalSubmission');
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await recovering;
  assert.equal(f.$('prompt').value,'');assert.equal(f.state.drafts['thread:A'],undefined);assert.equal(f.storage.get('cmc.pendingSubmit'),'');assert.equal(f.state.draftRevisions.get('thread:A'),revision);
});

test('same-text edits already made before lookup preserve the newer same-epoch draft',async()=>{
  const f=fixture({saved:savedSubmission()});f.input('continue');
  const submitted=savedSubmission({draftEpoch:f.state.draftEpoch,draftRevision:f.state.draftRevisions.get('thread:A')});f.storage.set('cmc.pendingSubmit',JSON.stringify(submitted));
  f.input('continue with different work');f.input('continue');assert(f.state.draftRevisions.get('thread:A')>submitted.draftRevision);
  const recovering=f.call('recoverLocalSubmission');f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await recovering;
  assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.drafts['thread:A'],'continue');assert.equal(f.storage.get('cmc.pendingSubmit'),'');
});

for(const legacy of [false,true])test(`an untouched reloaded ${legacy?'legacy':'prior-epoch'} draft is still cleaned after acceptance`,async()=>{
  const submitted=savedSubmission(legacy?{}:{draftEpoch:'fixture-prior-epoch',draftRevision:8}),f=fixture({saved:submitted});
  assert.equal(f.state.draftRevisions.has('thread:A'),false);const recovering=f.call('recoverLocalSubmission');
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await recovering;
  assert.equal(f.$('prompt').value,'');assert.equal(f.state.drafts['thread:A'],undefined);assert.equal(f.storage.get('cmc.pendingSubmit'),'');
});

test('a reloaded edited draft survives a coincidentally equal prior-epoch submitted revision',async()=>{
  const submitted=savedSubmission({draftEpoch:'fixture-prior-epoch',draftRevision:2}),f=fixture({saved:submitted});
  f.input('continue with new work');f.input('continue');assert.equal(f.state.draftRevisions.get('thread:A'),submitted.draftRevision);assert.notEqual(f.state.draftEpoch,submitted.draftEpoch);
  const recovering=f.call('recoverLocalSubmission');f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'accepted'}});await recovering;
  assert.equal(f.$('prompt').value,'continue');assert.equal(f.state.drafts['thread:A'],'continue');assert.equal(f.storage.get('cmc.pendingSubmit'),'');
});


test('failed receipt after navigation stores the original text and attachments in its created conversation',async()=>{
  const saved={...savedSubmission(),files:[{id:'original-file',name:'original.txt'}]};
  const f=fixture({saved});f.state.fileDrafts[saved.key]=saved.files;
  const recovering=f.call('recoverLocalSubmission');
  f.call('newThread');f.input('next project draft');
  f.settle(f.pending('/api/local-tasks/')[0],{request:{state:'failed',threadId:'receipt'}});
  await recovering;
  assert.equal(f.$('prompt').value,'next project draft');
  assert.equal(f.state.drafts['thread:receipt'],saved.text);
  assert.equal(f.state.fileDrafts['thread:receipt'][0].id,'original-file');
  assert.equal(f.state.fileDrafts[saved.key].length,0);
});
