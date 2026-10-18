import {createManagementController} from '../public/management-controller.js';
import {createSettingsController} from '../public/settings-controller.js';
import {modelHarness} from '../public/model-identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {mergeEvents,retainCompaction,errorMessage,restoreActivityDetails} from '../public/console-core.js';

// These delayed-promise regressions execute the shipped source, not alternate
// implementations. DOM mocks cover state/ownership only: no layout, scroll
// physics, animation-frame, or real-browser rendering QA is claimed here.
const source=(await fs.readFile(process.env.CMC_CONSOLE_SOURCE||new URL('../public/console.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing shipped source section: ${start}`);return source.slice(a,b);}
const questionCode=source.slice(source.indexOf('const questionDrafts=new Map();'));
const approvalCode=section('let approvalRefreshTicket=','function fileDirty()');
const threadCode=section('function conversationThreadKey(','function renderThreads()');
const selectionCode=section('function setConversationSelection(','async function selectProject(')+section('function sameConversationData(','let conversationThread =');
const historyCode=section('function sameConversationEvents(','const slashCommands=');
const navigationCode=section('async function newThread()','const desktopModelSettings=');
const queueCode=section('async function refreshQueue(','async function queueAction(');
const restoreQueueCode=section('function markDraftEdited(', 'function storeDraft(')+section('function readPendingSubmission()', 'function bindSubmissionThread(')+section('const restoringQueuedMessages=','let queueSubmitting=');
const enqueueCode=section('let queueSubmitting=','function restorePendingDraft()');
const fileSaveCode=section('const fileSaves=','function diffCode(');
const importCode=section('function showCloudSnapshotImport()',"$('cloudSnapshotImportBtn').onclick");
const queueNavigationLine=source.split('\n').find(line=>line.includes("if($('followupQueue').dataset.thread!==state.threadId)"));
assert(queueNavigationLine,'Missing shipped queue navigation ownership guard');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class MockNode{
  constructor(tag='div',className='',text=''){
    Object.assign(this,{tag,className,textContent:text||'',value:'',hidden:true,disabled:false,style:{},dataset:{},attributes:{},children:[],listeners:new Map(),options:[],files:[],open:false,isConnected:false,parentNode:null,offsetWidth:1,closeCalls:0});
    const classes=new Set(className.split(' ').filter(Boolean));
    this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name),toggle:(name,force)=>{const enabled=force??!classes.has(name);if(enabled)classes.add(name);else classes.delete(name);return enabled;}};
  }
  append(...nodes){for(const node of nodes){if(!node||typeof node!=='object')continue;node.parentNode=this;this.children.push(node);node.connect(this.isConnected);}}
  prepend(...nodes){const previous=[...this.children];this.replaceChildren(...nodes,...previous);}
  replaceChildren(...nodes){for(const child of this.children){child.parentNode=null;child.connect(false);}this.children=[];this.append(...nodes);}
  connect(value){this.isConnected=value;for(const child of this.children)child.connect(value);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,listener,options={}){const list=this.listeners.get(type)||[];list.push({listener,once:Boolean(options.once)});this.listeners.set(type,list);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(entry=>entry.listener!==listener));}
  dispatchEvent(event){event.target ||= this;for(const entry of [...(this.listeners.get(event.type)||[])]){entry.listener(event);if(entry.once)this.listeners.set(event.type,(this.listeners.get(event.type)||[]).filter(other=>other!==entry));}return true;}
  showModal(){this.open=true;}
  close(){this.closeCalls++;if(!this.open)return;this.open=false;this.dispatchEvent({type:'close'});}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;this.connect(false);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector.startsWith('.')?child.classList.contains(selector.slice(1)):child.tag===selector)?[child]:[],...child.querySelectorAll(selector)]);}
  focus(){}
  select(){}
  get childElementCount(){return this.children.length;}
}
function fixture({initial='A',imports=false,restores=false,enqueues=false,saves=false,questions=false,services=false,persisted=[]}={}){
  const elements=new Map(),nodes=[],buttons=new Map(),requests=[],opened=[],toasts=[],renders=[],storage=new Map(persisted);
  const $=id=>{if(!elements.has(id))elements.set(id,new MockNode());return elements.get(id);};
  const el=(tag,className,text)=>{const node=new MockNode(tag,className||'',text);nodes.push(node);return node;};
  const button=(label,action,className)=>{const node=el('button',className,label);node.onclick=action;const list=buttons.get(label)||[];list.push(node);buttons.set(label,list);return node;};
  const body=new MockNode('body');body.connect(true);
  const state={threadId:initial,selection:0,generation:1,approvals:[],threads:['A','B','C'].map(id=>({id,title:id,status:'idle',projectPath:'/project'})),projects:[],models:[],harness:'codex',hydrating:new Map(),historyLoading:new Set(),historyCount:new Map(),historyMore:new Map(),historyErrors:new Map(),events:new Map(),writerLocked:new Set(),pending:null,connected:true,capabilities:['cloud-snapshot-readonly','queue-draft-recovery'],drafts:JSON.parse(storage.get('cmc.drafts')||'{}'),imageDrafts:JSON.parse(storage.get('cmc.imageDrafts')||'{}'),fileDrafts:JSON.parse(storage.get('cmc.fileDrafts')||'{}')};
  $('chatModel').value='gpt-6.1-sol';$('chatModel').options=[{value:'gpt-6.1-sol',disabled:false}];$('chatEffort').value='high';$('chatEffort').options=[{value:'high'}];
  const context={state,$,el,button,AbortController,clearTimeout,setTimeout,modelHarness,restoreActivityDetails,conversationGeneration:-1,focusEventStream:()=>null,cancelActivityReads(){},syncDesktopModelSettings:()=>false,queuedMessageCopyButton:()=>button('复制',()=>{}),document:{body,activeElement:null},desktopModelSettings:new Map(),mergeEvents,retainCompaction,errorMessage,followConversation:true,
    api:(path,options)=>{const response=deferred();requests.push({path,options,...response,settled:false});return response.promise;},
    activeThread:()=>state.threads.find(thread=>thread.id===state.threadId),onlineRequired:()=>true,
    renderThreads(){},renderProjects(){},updateControls(){},updateContext(){},queueRender(){},storeDraft(){},restoreDraft(){},fillModelChoices(){},fillChatEfforts(){},showPage(){},closeDrawer(){},updateHarnessLabel(){},safeRead:key=>storage.get(key)||'',safeWrite:(key,value)=>storage.set(key,value),harnessForThread:()=> 'codex',comparablePath:value=>value,rememberReadingAnchor(){},
    toast:(...args)=>toasts.push(args),iconNode:name=>el('svg',name),showMenu(){},restoreQueuedMessage(){},queueAction(){},copy(){},run:action=>action(),
  };
  if(services)context.confirmAction=async()=>true;
  vm.createContext(context);
  if(restores||enqueues){
    Object.assign(context,{draftKey:()=>`thread:${state.threadId}`,saveImageDrafts(){},saveFileDrafts(){},renderImageDrafts(){},renderFileDrafts(){},resizeComposer(){},slashOptions:()=>({mode:'default'}),requestId:()=> 'queued-id',commitComposerModes(){},run:action=>Promise.resolve(action()).catch(error=>toasts.push(error.message))});
  }
  context.renderConversation=()=>{renders.push(state.threadId);context.conversationGeneration=state.generation;vm.runInContext('updateConversationHistoryState();'+queueNavigationLine,context);};
  vm.runInContext(threadCode+selectionCode+historyCode+navigationCode+queueCode+(imports?importCode:'')+restoreQueueCode+(enqueues?enqueueCode:'')+(saves?fileSaveCode:'')+(questions?approvalCode+questionCode:''),context);
  const call=(name,...args)=>{context.__args=args;return vm.runInContext(`${name}(...__args)`,context);};
  if(imports)context.openThread=async thread=>{opened.push(thread.id);state.threadId=thread.id;state.selection++;};
  const pending=fragment=>requests.filter(request=>!request.settled&&request.path.includes(fragment));
  const settle=(request,value,reject=false)=>{assert(request&&!request.settled,'Expected an outstanding API call');request.settled=true;request[reject?'reject':'resolve'](value);};
  const result={state,$,nodes,buttons,requests,context,storage,call,pending,settle,opened,toasts,renders,dialog:()=>nodes.find(node=>node.tag==='dialog'),input:()=>nodes.find(node=>node.tag==='textarea'),file:()=>nodes.find(node=>node.tag==='input')};
  if(services)installManagement(result);
  return result;
}

function installManagement(f){
  const context=f.context;
  Object.assign(context,createManagementController({...context,
    api:(...args)=>context.api(...args),confirmAction:(...args)=>context.confirmAction(...args),
    renderProjects:(...args)=>context.renderProjects(...args),refreshProjects:(...args)=>context.refreshProjects(...args),
  }));
}
function installSettings(f){
  const context=f.context;
  Object.assign(context,createSettingsController({...context,
    api:(...args)=>context.api(...args),loadModels:(...args)=>context.loadModels(...args),
    fillModelChoices:(...args)=>context.fillModelChoices(...args),fillChatEfforts:(...args)=>context.fillChatEfforts(...args),
    refreshCodex:(...args)=>context.refreshCodex(...args),
  }));
}
const history=(id,text,hasMore=false)=>({events:[{threadId:id,eventId:`${id}:message`,itemId:'message',type:'message.delta',text}],status:'idle',hasMore});
const message=(text,error)=>({id:text,text,status:error?'failed':'queued',...(error?{error}:{})});
test('file saves preserve request order and coalesce repeated shortcuts for the same content',async()=>{
  const f=fixture({saves:true});f.state.opened={project:'p',path:'note.md',editable:true,original:'old'};
  f.$('editor').value='first';const first=f.call('saveFile');
  f.$('editor').value='latest';const latest=f.call('saveFile'),duplicate=f.call('saveFile');
  await flush();assert.equal(f.requests.length,1,'new writes must wait for the prior write');
  f.settle(f.requests[0],{});await first;await flush();
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.body.content,'latest');
  assert.equal(f.state.opened.original,'first');assert.equal(f.$('editor').value,'latest');
  assert(f.toasts.some(value=>value[0]==='已保存提交的版本，后续修改尚未保存'));
  f.settle(f.requests[1],{});await Promise.all([latest,duplicate]);
  assert.equal(f.state.opened.original,'latest');assert.equal(f.requests.length,2);
});
test('a failed write does not block a later explicitly requested save',async()=>{
  const f=fixture({saves:true});f.state.opened={project:'p',path:'note.md',editable:true,original:'old'};
  f.$('editor').value='first';const first=f.call('saveFile');
  f.$('editor').value='fixed';const second=f.call('saveFile');
  f.settle(f.requests[0],Error('write failed'),true);await assert.rejects(first,/write failed/);await flush();
  assert.equal(f.state.opened.original,'old');assert.equal(f.requests.length,2);
  f.settle(f.requests[1],{});await second;assert.equal(f.state.opened.original,'fixed');
});
test('connection replacement retires queued file saves without modifying another opened file',async()=>{
  const f=fixture({saves:true});f.state.generation=1;f.state.opened={project:'p',path:'note.md',editable:true,original:'old'};
  f.$('editor').value='first';const first=f.call('saveFile');
  f.$('editor').value='queued';const second=f.call('saveFile');
  f.state.generation++;f.state.opened={project:'other',path:'note.md',editable:true,original:'other content'};f.$('editor').value='other edit';
  f.settle(f.requests[0],{});await Promise.all([first,second]);
  assert.equal(f.requests.length,1);assert.equal(f.state.opened.original,'other content');assert.equal(f.$('editor').value,'other edit');
});
test('queue acknowledgement consumes its original draft after navigation and retains later attachments',async()=>{
  const f=fixture({enqueues:true});f.state.drafts['thread:A']='提交内容';f.$('prompt').value='提交内容';
  f.state.fileDrafts['thread:A']=[{id:'submitted'}];
  const enqueue=f.call('enqueueMessage');
  f.state.threadId='B';f.state.selection++;f.$('prompt').value='B 草稿';f.state.drafts['thread:B']='B 草稿';
  f.state.fileDrafts['thread:A']=[{id:'submitted'},{id:'later'}];
  f.settle(f.requests[0],{message:{id:'queued-id'}});await flush();
  f.settle(f.requests[1],{messages:[]});await enqueue;
  assert.equal(f.state.drafts['thread:A'],undefined);assert.equal(f.$('prompt').value,'B 草稿');
  assert.deepEqual(Array.from(f.state.fileDrafts['thread:A'],file=>file.id),['later']);
});
test('accepted queue submission removes files before refresh failure while preserving the new draft',async()=>{
  const f=fixture({enqueues:true});f.state.drafts['thread:A']='提交内容';f.$('prompt').value='提交内容';
  f.state.fileDrafts['thread:A']=[{id:'submitted'}];const enqueue=f.call('enqueueMessage');
  f.$('prompt').value='随后输入';f.state.drafts['thread:A']='随后输入';f.state.draftRevisions=new Map([['thread:A',1]]);
  f.state.fileDrafts['thread:A']=[{id:'submitted'},{id:'later'}];
  f.settle(f.requests[0],{message:{id:'queued-id'}});await flush();
  f.settle(f.requests[1],Error('refresh unavailable'),true);await assert.rejects(enqueue,/refresh unavailable/);
  assert.equal(f.$('prompt').value,'随后输入');assert.equal(f.state.drafts['thread:A'],'随后输入');
  assert.deepEqual(Array.from(f.state.fileDrafts['thread:A'],file=>file.id),['later']);
});
test('restoring a queued message saves its original draft after navigation even when list refresh fails',async()=>{
  const f=fixture({restores:true});f.state.drafts['thread:A']='A 草稿';f.$('prompt').value='A 草稿';
  f.state.pending={key:'thread:A',requestId:'pending'};f.storage.set('cmc.pendingSubmit',JSON.stringify(f.state.pending));
  f.state.fileDrafts['thread:A']=[{id:'original'}];
  const queued={id:'q',text:'取回内容',files:[{id:'queued'}],images:[{id:'image'}]};
  const restore=f.call('restoreQueuedMessage','A',queued);
  await f.call('restoreQueuedMessage','A',queued);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/restore')).length,1);
  f.state.threadId='B';f.state.selection++;f.state.drafts['thread:B']='B 草稿';f.$('prompt').value='B 草稿';
  f.state.fileDrafts['thread:A'].push({id:'later'});
  f.settle(f.requests[0],{message:queued});await flush();f.settle(f.pending('/restore/complete')[0],{});await restore;
  assert.equal(f.state.drafts['thread:A'],'取回内容\n\nA 草稿');assert.equal(f.$('prompt').value,'B 草稿');
  assert.equal(f.state.pending.draftEdited,true);assert.equal(JSON.parse(f.storage.get('cmc.pendingSubmit')).draftEdited,true);
  assert.deepEqual(Array.from(f.state.fileDrafts['thread:A'],file=>file.id),['queued','original','later']);
  assert.equal(f.state.imageDrafts['thread:A'][0].id,'image');
  const refresh=f.requests.find(r=>r.path.endsWith('/queue'));f.settle(refresh,Error('list unavailable'),true);await flush();
  assert.equal(f.state.drafts['thread:A'],'取回内容\n\nA 草稿');
});
test('failed queue removal preserves the draft and permits another restore attempt',async()=>{
  const f=fixture({restores:true});f.state.drafts['thread:A']='原草稿';f.$('prompt').value='原草稿';
  const restore=f.call('restoreQueuedMessage','A',{id:'q',text:'取回内容'});
  f.settle(f.requests[0],Error('delete rejected'),true);await assert.rejects(restore,/delete rejected/);
  assert.equal(f.state.drafts['thread:A'],'原草稿');
  const retry=f.call('restoreQueuedMessage','A',{id:'q',text:'取回内容'});assert.equal(f.requests.filter(r=>r.path.endsWith('/restore')).length,2);
  f.settle(f.pending('/restore')[0],{message:{id:'q',text:'取回内容'}});await flush();f.settle(f.pending('/restore/complete')[0],{});await retry;assert.equal(f.$('prompt').value,'取回内容\n\n原草稿');
});
test('queue restore response loss and reload retain the copy without appending it twice',async()=>{
  const original={id:'q',text:'需要恢复的消息',images:[{id:'image'}],files:[{id:'file'}]};
  const f=fixture({restores:true});f.state.drafts['thread:A']='原草稿';f.$('prompt').value='原草稿';
  const first=f.call('restoreQueuedMessage','A',original);
  f.settle(f.pending('/restore')[0],Error('response lost after the server saved its editing copy'),true);
  await assert.rejects(first,/response lost/);
  f.settle(f.pending('/queue')[0],{canSteer:false,messages:[],drafts:[original]});await flush();
  assert.equal(f.state.drafts['thread:A'],'原草稿');assert.equal(f.buttons.get('继续编辑').length,1);
  const retry=f.call('restoreQueuedMessage','A',original);
  f.settle(f.pending('/restore')[0],{message:original});await flush();
  f.settle(f.pending('/restore/complete')[0],Error('completion response unavailable'),true);
  await assert.rejects(retry,/completion response/);
  assert.equal(f.$('prompt').value,'需要恢复的消息\n\n原草稿');
  const reloaded=fixture({restores:true,persisted:f.storage});
  reloaded.$('prompt').value=reloaded.state.drafts['thread:A'];
  const finish=reloaded.call('restoreQueuedMessage','A',original);
  assert.equal(reloaded.pending('/restore').length,1);assert(reloaded.pending('/restore')[0].path.endsWith('/complete'));
  reloaded.settle(reloaded.pending('/restore/complete')[0],{});await finish;
  assert.equal(reloaded.state.drafts['thread:A'],'需要恢复的消息\n\n原草稿');
  assert.deepEqual(Array.from(reloaded.state.imageDrafts['thread:A'],row=>row.id),['image']);
  assert.deepEqual(Array.from(reloaded.state.fileDrafts['thread:A'],row=>row.id),['file']);
  assert.equal(JSON.parse(reloaded.storage.get('cmc.queueRestoreCopies'))[JSON.stringify(['A','q'])],undefined);
  const partial=fixture({restores:true});partial.state.drafts['thread:A']='保留草稿';partial.$('prompt').value='保留草稿';
  partial.context.safeWrite=(key,value)=>{if(key!=='cmc.fileDrafts')partial.storage.set(key,value);};
  const interrupted=partial.call('restoreQueuedMessage','A',original);
  partial.settle(partial.pending('/restore')[0],{message:original});
  await assert.rejects(interrupted,/草稿未能保存/);
  assert.equal(partial.$('prompt').value,'需要恢复的消息\n\n保留草稿');
  assert.equal(partial.pending('/complete').length,0,'never clear the server copy before every local field is saved');
  const recovered=fixture({restores:true,persisted:partial.storage});
  assert.equal(recovered.state.drafts['thread:A'],'需要恢复的消息\n\n保留草稿');
  assert.equal(recovered.state.fileDrafts['thread:A'][0].id,'file');
  assert.equal(JSON.parse(recovered.storage.get('cmc.queueRestoreCopies'))[JSON.stringify(['A','q'])].phase,'saved');
});
function queueText(f){const host=f.$('followupQueue');return host.hidden?'':host.children[0]?.children[1]?.children[0]?.textContent||'';}

// Thread-list races must not resurrect removed metadata or clear a selection
// based on a response older than the most recent request.
test('overlapping thread refreshes retain the newest list and its active selection',async()=>{
  const f=fixture(),first=f.call('readThreads'),second=f.call('readThreads');
  const [older,newer]=f.pending('/api/threads');
  f.settle(newer,{threads:[{id:'A',title:'new title',status:'running'}]});await second;
  f.settle(older,{threads:[{id:'B',title:'stale list',status:'idle'}]});await first;
  assert.equal(f.state.threadId,'A','an older list must not evict the current conversation');
  assert.equal(f.state.threads[0].title,'new title');
});
test('overlapping metadata refreshes cannot roll a completed snapshot back to running',async()=>{
  const f=fixture();f.state.threads=[{id:'A',readOnly:true,snapshotStatus:'running'}];
  const first=f.call('readThreads'),second=f.call('readThreads');const [older,newer]=f.pending('/api/threads');
  f.settle(newer,{threads:[{id:'A',readOnly:true,snapshotStatus:'completed'}]});await second;
  f.settle(older,{threads:[{id:'A',readOnly:true,snapshotStatus:'running'}]});await first;
  assert.equal(f.state.threads[0].snapshotStatus,'completed');
});

test('old loadOlder finally preserves a new conversation first-load skeleton and aria busy state',async()=>{
  const f=fixture();f.state.events.set('A',history('A','cached').events);f.state.historyMore.set('A',true);
  const older=f.call('loadOlderMessages');const oldRequest=f.pending('/A/events')[0];
  const opening=f.call('openThread',f.state.threads.find(thread=>thread.id==='B'));const newRequest=f.pending('/B/events')[0];
  assert.equal(f.$('historySkeleton').hidden,false);
  f.settle(oldRequest,history('A','older page'));await older;
  assert.equal(f.$('historySkeleton').hidden,false,'A completion cannot hide B loading');
  assert.equal(f.$('events').attributes['aria-busy'],'true');
  f.settle(newRequest,history('B','new body'));await flush();f.settle(f.pending('/B/queue')[0],{messages:[]});await opening;
  assert.equal(f.$('historySkeleton').hidden,true);
});
test('old loadOlder finally cannot enable a newer conversation active pagination control',async()=>{
  const f=fixture();for(const id of ['A','B']){f.state.events.set(id,history(id,'cached').events);f.state.historyMore.set(id,true);}
  const old=f.call('loadOlderMessages'),oldRequest=f.pending('/A/events')[0];
  const opening=f.call('openThread',f.state.threads.find(thread=>thread.id==='B'));
  f.settle(f.pending('/B/events')[0],history('B','loaded',true));await flush();f.settle(f.pending('/B/queue')[0],{messages:[]});await opening;
  const newer=f.call('loadOlderMessages'),newRequest=f.pending('/B/events')[0];assert.equal(f.$('loadOlder').disabled,true);
  f.settle(oldRequest,history('A','older page',true));await old;
  assert.equal(f.$('loadOlder').disabled,true,'B pagination is still active');
  f.settle(newRequest,history('B','older page'));await flush();f.settle(f.pending('/B/queue')[0],{messages:[]});await newer;
  assert.equal(f.$('loadOlder').disabled,false);
});

test('navigation to cached B releases the shared pagination control while A still loads older',async()=>{
  const f=fixture();for(const id of ['A','B']){f.state.events.set(id,history(id,'cached').events);f.state.historyMore.set(id,true);}
  const older=f.call('loadOlderMessages'),oldRequest=f.pending('/A/events')[0];
  const opening=f.call('openThread',f.state.threads.find(thread=>thread.id==='B'));
  f.settle(f.pending('/B/events')[0],history('B','cached',true));await flush();f.settle(f.pending('/B/queue')[0],{messages:[]});await opening;
  const disabled=f.$('loadOlder').disabled;f.settle(oldRequest,history('A','older page'));await older;
  assert.equal(disabled,false,'A background pagination must not disable the ready B control');
});
test('A pagination cannot suppress a fresh history request after A to B to A navigation',async()=>{
  const f=fixture();f.state.events.set('A',history('A','cached').events);f.state.historyMore.set('A',true);
  const older=f.call('loadOlderMessages'),old=f.pending('/A/events')[0];
  const b=f.call('openThread',f.state.threads.find(thread=>thread.id==='B')),bRequest=f.pending('/B/events')[0];
  const a=f.call('openThread',f.state.threads.find(thread=>thread.id==='A')),fresh=f.pending('/A/events').at(-1);
  assert.notEqual(fresh,old,'new A selection must own a fresh request');
  f.settle(old,history('A','obsolete pagination'));await older;assert(f.state.hydrating.has('A'));
  f.settle(bRequest,history('B','background B'));await b;
  f.settle(fresh,history('A','fresh A'));await flush();f.settle(f.pending('/A/queue')[0],{messages:[]});await a;
  assert.equal(f.state.events.get('A')[0].text,'fresh A');assert.equal(f.state.historyLoading.has('A'),false);
});
test('a superseded same-generation pagination finally cannot release its newer same-ID owner',async()=>{
  const f=fixture();f.state.events.set('A',history('A','cached').events);f.state.historyMore.set('A',true);
  const oldPage=f.call('loadOlderMessages'),old=f.pending('/A/events')[0];
  await f.call('newThread');const opening=f.call('openThread',f.state.threads.find(thread=>thread.id==='A')),fresh=f.pending('/A/events').at(-1);
  assert.notEqual(fresh,old);f.settle(fresh,history('A','fresh A',true));await flush();f.settle(f.pending('/A/queue')[0],{messages:[]});await opening;
  const newPage=f.call('loadOlderMessages'),newRequest=f.pending('/A/events').at(-1);
  f.settle(old,history('A','obsolete page'));await oldPage;assert.equal(f.state.historyLoading.has('A'),true);assert.equal(f.$('loadOlder').disabled,true);
  f.settle(newRequest,history('A','new page'));await flush();f.settle(f.pending('/A/queue')[0],{messages:[]});await newPage;assert.equal(f.$('loadOlder').disabled,false);
});

test('a superseded history request failure is silent after a newer response succeeds',async()=>{
  const f=fixture(),first=f.call('loadThread','A'),firstOutcome=first.then(()=>null,error=>error);
  f.call('setConversationSelection','A');const second=f.call('loadThread','A');
  const [older,newer]=f.pending('/A/events');f.settle(newer,history('A','newest'));await flush();f.settle(f.pending('/A/queue')[0],{messages:[]});await second;
  f.settle(older,Error('obsolete request offline'),true);const failure=await firstOutcome;
  assert.equal(failure,null,'an obsolete failure must not propagate a false current-conversation error');
  assert.equal(f.state.events.get('A')[0].text,'newest');
});

test('A to B to A history navigation discards the first A history response',async()=>{
  const f=fixture();const a1=f.call('openThread',f.state.threads[0]),b=f.call('openThread',f.state.threads[1]),a2=f.call('openThread',f.state.threads[0]);
  const [oldA,newA]=f.pending('/A/events');f.settle(newA,history('A','newest A'));await flush();f.settle(f.pending('/A/queue')[0],{messages:[]});await a2;
  f.settle(oldA,history('A','obsolete A'));await a1;f.settle(f.pending('/B/events')[0],history('B','B cached'));await b;
  assert.equal(f.state.threadId,'A');assert.equal(f.state.events.get('A')[0].text,'newest A');assert.equal(f.$('events').attributes['aria-busy'],'false');
});
test('A to B to A rejects an old A queue response and obsolete desktop writer lock',async()=>{
  const f=fixture();const a1=f.call('openThread',f.state.threads[0]);f.settle(f.pending('/A/events')[0],history('A','A first'));await flush();const oldQueue=f.pending('/A/queue')[0];
  const b=f.call('openThread',f.state.threads[1]),a2=f.call('openThread',f.state.threads[0]);f.settle(f.pending('/A/events')[0],history('A','A newest'));await flush();
  const newQueue=f.pending('/A/queue').find(request=>request!==oldQueue);f.settle(newQueue,{messages:[message('new queued draft')]});await a2;
  f.settle(oldQueue,{messages:[message('old queued draft','桌面版仍持有写入权')]});await a1;
  f.settle(f.pending('/B/events')[0],history('B','B cached'));await b;
  assert.equal(queueText(f),'new queued draft');assert.equal(f.state.writerLocked.has('A'),false);
});
test('same-selection overlapping queue refreshes retain only the latest result',async()=>{
  const f=fixture(),first=f.call('refreshQueue','A'),second=f.call('refreshQueue','A');const [oldQueue,newQueue]=f.pending('/A/queue');
  f.settle(newQueue,{messages:[message('new queue')]});await second;
  f.settle(oldQueue,{messages:[message('obsolete queue','桌面版仍持有')]});await first;
  assert.equal(queueText(f),'new queue');assert.equal(f.state.writerLocked.has('A'),false);
});
test('queue refresh for a thread left behind cannot change a different selection',async()=>{
  const f=fixture(),old=f.call('refreshQueue','A');const request=f.pending('/A/queue')[0];await f.call('newThread');
  f.settle(request,{messages:[message('old queue','桌面版仍持有')]});await old;
  assert.equal(queueText(f),'');assert.equal(f.state.writerLocked.has('A'),false);assert.equal(f.state.threadId,'');
});

function seededRandom(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function shuffle(items,seed){const output=[...items],random=seededRandom(seed);for(let i=output.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[output[i],output[j]]=[output[j],output[i]];}return output;}
for(const seed of [1,7,42,126])test(`seed ${seed}: multi-step shipped navigation preserves latest queue ownership`,async()=>{
  const f=fixture(),operations=[],queueRequests=[];const sequence=['A','B','A','C','B','A','B','C','A'];
  for(const [index,id] of sequence.entries()){
    operations.push(f.call('openThread',f.state.threads.find(thread=>thread.id===id)));
    f.settle(f.pending(`/${id}/events`)[0],history(id,`history ${index}`));await flush();queueRequests.push({request:f.pending(`/${id}/queue`).at(-1),id,index});
  }
  const latest=queueRequests.at(-1);let latestResolved=false;
  for(const item of shuffle(queueRequests,seed)){
    const current=item===latest;f.settle(item.request,{messages:[message(current?'latest A queue':`obsolete ${item.id} ${item.index}`,current?undefined:'桌面版仍持有')]});await flush();latestResolved ||= current;
    assert.equal(queueText(f),latestResolved?'latest A queue':'',`seed ${seed}, delayed result ${item.id}/${item.index} must respect selection ownership`);
    assert.equal(f.state.writerLocked.has('A'),false,`seed ${seed}: obsolete writer lock must never be applied`);
  }
  await Promise.all(operations);assert.equal(f.state.threadId,'A');assert.equal(f.state.events.get('A')[0].text,'history 8');
});

function showImport(f){f.call('showCloudSnapshotImport');f.input().value=JSON.stringify({schemaVersion:1,snapshots:[{externalId:'requested'}]});return f.buttons.get('导入').at(-1);}
const imported={imported:1,threads:[{id:'cloud-snapshot:requested',readOnly:true}]};
async function finishImport(f,promise){f.settle(f.pending('/cloud-snapshots/import')[0],imported);await flush();for(const request of f.pending('/api/threads'))f.settle(request,{threads:[...f.state.threads,...imported.threads]});await promise;}
test('canceling a submitted snapshot import prevents delayed completion from opening a thread',async()=>{
  const f=fixture({imports:true}),submit=showImport(f),promise=submit.onclick();f.buttons.get('取消').at(-1).onclick();assert.equal(f.dialog().isConnected,false);
  await finishImport(f,promise);assert.deepEqual(f.opened,[]);assert.equal(f.state.threadId,'A');
});
test('leaving the import initiating selection prevents delayed completion from stealing navigation',async()=>{
  const f=fixture({imports:true}),submit=showImport(f),promise=submit.onclick();await f.call('newThread');
  await finishImport(f,promise);assert.deepEqual(f.opened,[]);assert.equal(f.state.threadId,'');
});
test('canceling import while its thread-list refresh is pending prevents the later open',async()=>{
  const f=fixture({imports:true}),promise=showImport(f).onclick();f.settle(f.pending('/cloud-snapshots/import')[0],imported);await flush();assert.equal(f.pending('/api/threads').length,1);
  f.dialog().close();f.settle(f.pending('/api/threads')[0],{threads:[...f.state.threads,...imported.threads]});await promise;assert.deepEqual(f.opened,[]);
});
test('a completed import opens its submitted member when the user remains in context',async()=>{
  const f=fixture({imports:true}),promise=showImport(f).onclick();await finishImport(f,promise);assert.deepEqual(f.opened,['cloud-snapshot:requested']);assert.equal(f.dialog().open,false);
});
test('successful snapshot import invalidates an older read before a same-time authoritative reload',async()=>{
  const id='cloud-snapshot:requested',f=fixture({initial:id,imports:true});f.state.threads=[{id,status:'idle',readOnly:true}];f.state.events.set(id,history(id,'cached old').events);
  const oldLoad=f.call('loadThread',id),old=f.pending('/events')[0];const importing=showImport(f).onclick();f.dialog().close();
  f.settle(f.pending('/cloud-snapshots/import')[0],imported);await flush();f.settle(f.pending('/api/threads').find(request=>request.path==='/api/threads'),{threads:f.state.threads});await importing;
  const latest=f.call('loadThread',id),latestRequest=f.pending('/events').at(-1);f.settle(latestRequest,history(id,'imported correction'));await flush();f.settle(f.pending('/queue')[0],{messages:[]});await latest;
  f.settle(old,history(id,'obsolete before import'));await oldLoad;assert.equal(f.state.events.get(id)[0].text,'imported correction');assert.equal(f.state.threadId,id);
});
test('two rapid snapshot file selections retain the newer file even when its read finishes first',async()=>{
  const f=fixture({imports:true});showImport(f);const first=deferred(),second=deferred();
  f.file().files=[{size:100,text:()=>first.promise}];const a=f.file().onchange();f.file().files=[{size:100,text:()=>second.promise}];const b=f.file().onchange();
  second.resolve('new selected JSON');await b;first.resolve('old selected JSON');await a;assert.equal(f.input().value,'new selected JSON');
});
test('pending snapshot file read cannot overwrite a subsequent manual JSON edit',async()=>{
  const f=fixture({imports:true});showImport(f);const read=deferred();f.file().files=[{size:100,text:()=>read.promise}];const pending=f.file().onchange();
  f.input().value='manually corrected JSON';f.input().dispatchEvent({type:'input'});read.resolve('earlier file JSON');await pending;assert.equal(f.input().value,'manually corrected JSON');
});
test('oversize snapshot file rejection does not overwrite the existing JSON draft',async()=>{
  const f=fixture({imports:true});showImport(f);const before=f.input().value;let read=false;f.file().files=[{size:900001,text:()=>{read=true;return Promise.resolve('bad');}}];
  await f.file().onchange();assert.match(f.nodes.find(node=>node.className==='error').textContent,/900 KB/);assert.equal(read,false);assert.equal(f.input().value,before);
});

function questionEvent(threadId='A'){return {type:'approval.requested',approvalType:'question',threadId,approvalId:'shared',detail:JSON.stringify({questions:[{id:'q',question:'What next?'}]})};}
function questionForm(f,event=questionEvent()){
  const card=f.call('questionCard',event),form=card.children.find(node=>node.tag==='form');
  const input=form?.querySelectorAll('input')[0],submit=form?.children.find(node=>node.tag==='button');
  return {card,form,input,submit,error:form?.children.find(node=>node.className==='error')};
}
test('question submission remains locked across edits and rerenders and preserves a failed draft',async()=>{
  const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
  const a=questionForm(f);a.input.value='first answer';a.input.oninput();
  const pending=a.form.onsubmit({preventDefault(){}});
  a.input.value='later draft';a.input.oninput();assert.equal(a.submit.disabled,true);
  const redraw=questionForm(f);assert.equal(redraw.submit.disabled,true);assert.equal(redraw.form.children[0].disabled,true);
  await redraw.form.onsubmit({preventDefault(){}});assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].options.body.answers.q.answers[0],'first answer');
  f.settle(f.requests[0],Error('answer failed'),true);await pending;
  const retry=questionForm(f);assert.equal(retry.input.value,'later draft');assert.equal(retry.submit.disabled,false);assert.equal(retry.error.textContent,'answer failed');
});
test('question acceptance remains resolved when the following approval refresh fails',async()=>{
  const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
  const view=questionForm(f);view.input.value='accepted answer';view.input.oninput();const pending=view.form.onsubmit({preventDefault(){}});
  f.settle(f.requests[0],{});await flush();assert.equal(f.state.approvals[0].status,'accepted');
  f.settle(f.requests[1],Error('refresh failed'),true);await pending;
  const resolved=questionForm(f);assert.equal(resolved.form,undefined);assert.equal(resolved.card.children[0].textContent,'已回答');
  assert.match(f.toasts[0][0],/回答已提交/);
});
test('question drafts and delayed failures stay with their original conversation',async()=>{
  const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
  const a=questionForm(f);a.input.value='A draft';a.input.oninput();const pending=a.form.onsubmit({preventDefault(){}});
  f.state.threadId='B';f.state.approvals=[{id:'shared',threadId:'B',status:'pending'}];
  const b=questionForm(f,questionEvent('B'));assert.equal(b.input.value,'');b.input.value='B draft';b.input.oninput();
  f.settle(f.requests[0],Error('A failed'),true);await pending;assert.equal(f.toasts.length,0);
  assert.equal(questionForm(f,questionEvent('B')).input.value,'B draft');
  f.state.threadId='A';f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];const restored=questionForm(f);
  assert.equal(restored.input.value,'A draft');assert.equal(restored.error.textContent,'A failed');
});
test('approval refresh ignores old conversations and older requests',async()=>{
  const f=fixture({questions:true});const a=f.call('refreshApprovals');f.state.threadId='B';const b=f.call('refreshApprovals');
  f.settle(f.requests[1],{approvals:[{id:'B'}]});await b;f.settle(f.requests[0],{approvals:[{id:'A'}]});await a;assert.equal(f.state.approvals[0].id,'B');
  const older=f.call('refreshApprovals'),newer=f.call('refreshApprovals');f.settle(f.requests[3],{approvals:[{id:'latest'}]});await newer;f.settle(f.requests[2],{approvals:[{id:'older'}]});await older;assert.equal(f.state.approvals[0].id,'latest');
  const stale=f.call('refreshApprovals');f.state.threadId='C';f.settle(f.requests[4],Error('old query failed'),true);await stale;assert.equal(f.state.approvals[0].id,'latest');
  const current=f.call('refreshApprovals');f.settle(f.requests[5],Error('current query failed'),true);await assert.rejects(current,/current query failed/);
});

test('approval decisions stay mutually exclusive across rerenders and failures remain retryable',async()=>{
  const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
  const event={...questionEvent(),approvalType:'command',title:'Test approval',detail:'echo mock'};
  const pending=f.call('resolveApproval','shared','accept','A');
  await f.call('resolveApproval','shared','decline','A');assert.equal(f.requests.length,1);
  const busy=f.call('approvalCard',event);assert(busy.querySelectorAll('button').every(node=>node.disabled));
  f.settle(f.requests[0],Error('decision failed'),true);await pending;
  const retry=f.call('approvalCard',event);assert(retry.querySelectorAll('button').every(node=>!node.disabled));
  assert.equal(retry.children.find(node=>node.className==='error').textContent,'decision failed');
});
test('approval confirmation remains handled when its refresh fails',async()=>{
  const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
  const pending=f.call('resolveApproval','shared','decline','A');f.settle(f.requests[0],{});await flush();
  assert.equal(f.state.approvals[0].status,'declined');f.settle(f.requests[1],Error('refresh failed'),true);await pending;
  const card=f.call('approvalCard',{...questionEvent(),approvalType:'command'});assert.equal(card.children[0].textContent,'已拒绝');assert.equal(card.querySelectorAll('button').length,0);
  await f.call('resolveApproval','shared','accept','A');assert.equal(f.requests.length,2);assert.match(f.toasts[0][0],/决定已提交/);
});
test('approval responses do not update or notify a newly selected conversation',async()=>{
  for(const failure of [false,true]){
    const f=fixture({questions:true});f.state.approvals=[{id:'shared',threadId:'A',status:'pending'}];
    const pending=f.call('resolveApproval','shared','accept','A');f.state.threadId='B';f.state.approvals=[{id:'shared',threadId:'B',status:'pending'}];
    f.settle(f.requests[0],failure?Error('A failed'):{},failure);await pending;
    assert.equal(f.state.approvals[0].status,'pending');assert.equal(f.requests.length,1);assert.equal(f.toasts.length,0);
    const card=f.call('approvalCard',{...questionEvent('B'),approvalType:'command'});assert(card.querySelectorAll('button').every(node=>!node.disabled));
  }
});

test('Codex service ignores an older status after a newer start and keeps startup disabled',async()=>{
  const f=fixture({services:true});const read=f.call('refreshCodex');
  const start=f.call('operateCodex','start');assert.equal(f.$('codexStartBtn').disabled,true);assert.equal(f.$('codexRestartBtn').disabled,true);
  await f.call('operateCodex','restart');assert.equal(f.requests.length,2);
  f.settle(f.requests[1],{codex:{running:true,cliVersion:'fixture'}});await start;
  assert.equal(f.$('codexStartBtn').disabled,true);assert.equal(f.$('codexRestartBtn').disabled,false);
  f.settle(f.requests[0],{codex:{running:false}});await read;assert.equal(f.state.codex.running,true);assert.equal(f.$('codexStartBtn').disabled,true);
});
test('Codex service keeps restart confirmation and ignores a changed connection during confirmation',async()=>{
  const f=fixture({services:true});f.context.confirmAction=async()=>false;
  await f.call('operateCodex','restart');assert.equal(f.requests.length,0);assert.equal(f.$('codexRestartBtn').disabled,false);
  const decision=deferred();f.context.confirmAction=()=>decision.promise;const restart=f.call('operateCodex','restart');
  f.state.generation++;f.call('renderCodexStatus');decision.resolve(true);await restart;
  assert.equal(f.requests.length,0);assert.equal(f.$('codexStartBtn').disabled,false);
});
test('Codex service isolates old action replies and recovers a failed current status check',async()=>{
  const f=fixture({services:true});const start=f.call('operateCodex','start');f.state.generation++;
  const read=f.call('refreshCodex');f.settle(f.requests[1],Error('temporary status failure'),true);await read;
  assert.match(f.$('codexStatus').children[0].textContent,/无法检查 Codex/);assert.equal(f.$('codexRefreshBtn').disabled,false);
  f.settle(f.requests[0],{codex:{running:true}});await start;assert.equal(f.state.codex,null);
  const retry=f.call('refreshCodex');f.settle(f.requests[2],{codex:{running:false}});await retry;
  assert.match(f.$('codexStatus').children[0].textContent,/尚未启动/);assert.equal(f.$('codexStartBtn').disabled,false);
});

function textFormFixture(){
  const f=fixture();
  vm.runInContext(section('async function askText(', 'async function deleteThread()'),f.context);
  return f;
}
test('text form preserves failed input, blocks duplicate saves and closes after retry',async()=>{
  const f=textFormFixture(),attempts=[];
  const result=f.call('askText','目标','原内容',200000,value=>{const request=deferred();attempts.push({value,...request});return request.promise;});
  const dialog=f.dialog(),form=dialog.children[0],input=form.children[1],error=form.children[2],cancel=form.children[3].children[0];
  input.value=' 新目标 ';const event={preventDefault(){}};
  const saving=form.onsubmit(event);await form.onsubmit(event);dialog.oncancel(event);cancel.onclick();
  assert.equal(attempts.length,1);assert.equal(attempts[0].value,'新目标');assert(dialog.isConnected);assert(input.disabled);
  attempts[0].reject(Error('网络失败'));await saving;
  assert(dialog.isConnected);assert.equal(input.value,' 新目标 ');assert.equal(error.hidden,false);assert.match(error.textContent,/网络失败/);assert.equal(input.disabled,false);
  const retry=form.onsubmit(event);attempts[1].resolve();await retry;
  assert.equal(await result,'新目标');assert.equal(dialog.isConnected,false);
});
test('text form rejects blank values and replaced connections without writing',async()=>{
  const f=textFormFixture();let writes=0;
  const result=f.call('askText','名称','old',160,()=>writes++),dialog=f.dialog(),form=dialog.children[0];
  form.children[1].value='   ';await form.onsubmit({preventDefault(){}});assert.equal(writes,0);
  form.children[1].value='new';f.state.generation++;await form.onsubmit({preventDefault(){}});assert.equal(writes,0);assert.match(form.children[2].textContent,/连接已改变/);
  form.children[3].children[0].onclick();assert.equal(await result,null);
});
test('text form rename commits locally before reporting refresh failure',async()=>{
  const f=textFormFixture();f.context.refreshThreads=async()=>{throw Error('刷新失败');};
  const result=f.call('renameSelectedThread',f.state.threads[0]),form=f.dialog().children[0];form.children[1].value='新名称';
  const saving=form.onsubmit({preventDefault(){}});assert.equal(f.requests.length,1);f.settle(f.requests[0],{});await saving;await result;
  assert.equal(f.state.threads[0].title,'新名称');assert.equal(f.dialog().isConnected,false);assert(f.toasts.some(args=>args[0].includes('名称已保存，列表刷新失败')));
});

function goalActionFixture(){
  const f=fixture();f.state.threads[0].goal={objective:'目标',status:'active',goalId:'goal-A',timeUsedSeconds:10};
  Object.assign(f.context,{changingGoals:new Set(),isRunning:()=>false,requestId:()=> 'continue-id',slashOptions:()=>({}),refreshThreads:async()=>{}});
  vm.runInContext(section('function updateGoalControls()', 'function updateControls()')+section('async function changeGoalStatus(', "$('toggleGoal').onclick"),f.context);
  return f;
}
test('goal actions serialize controls and apply replies to refreshed thread objects',async()=>{
  const f=goalActionFixture(),first=f.call('changeGoalStatus');
  for(const id of ['toggleGoal','editGoal','closeGoal'])assert.equal(f.$(id).disabled,true);
  await f.call('changeGoalStatus',true);assert.equal(f.requests.length,1);
  f.state.threads=f.state.threads.map(row=>({...row,title:'更新后的名称'}));
  f.settle(f.requests[0],{goal:{status:'paused'}});await first;
  assert.equal(f.state.threads[0].goal.status,'paused');assert.equal(f.state.threads[0].goal.goalId,'goal-A');assert.equal(f.state.threads[0].title,'更新后的名称');
  for(const id of ['toggleGoal','editGoal','closeGoal'])assert.equal(f.$(id).disabled,false);
  const close=f.call('changeGoalStatus',true);await f.call('changeGoalStatus',true);assert.equal(f.requests.length,2);
  f.settle(f.requests[1],{goal:null});await close;assert.equal(f.state.threads[0].goal,null);assert.equal(f.$('closeGoal').disabled,true);
});
test('goal actions retain write errors and distinguish refresh failures',async()=>{
  const f=goalActionFixture();let refreshes=0;f.context.refreshThreads=async()=>{refreshes++;throw Error('刷新故障');};
  const failed=f.call('changeGoalStatus');f.settle(f.requests[0],Error('暂停失败'),true);await assert.rejects(failed,/暂停失败/);
  assert.equal(refreshes,0);assert.equal(f.state.threads[0].goal.status,'active');assert.equal(f.$('toggleGoal').disabled,false);
  const saved=f.call('changeGoalStatus');f.settle(f.requests[1],{goal:{status:'paused'}});await saved;
  assert.equal(refreshes,1);assert.equal(f.state.threads[0].goal.status,'paused');assert(f.toasts.some(args=>args[0].includes('目标操作已提交，列表刷新失败')));
});
test('goal actions ignore replaced connections and prevent resume during a running turn',async()=>{
  const f=goalActionFixture(),old=f.call('changeGoalStatus',true);f.state.generation++;f.state.threads[0].goal={objective:'新连接目标',status:'paused'};
  f.settle(f.requests[0],{goal:null});await old;assert.equal(f.state.threads[0].goal.objective,'新连接目标');
  f.context.isRunning=()=>true;await f.call('changeGoalStatus');assert.equal(f.requests.length,1);f.call('updateGoalControls');assert.equal(f.$('toggleGoal').disabled,true);
  f.context.isRunning=()=>false;const resume=f.call('changeGoalStatus');assert.equal(f.requests[1].path,'/api/threads/A/goal/continue');assert.equal(f.requests[1].options.body.requestId,'continue-id');
  f.settle(f.requests[1],{goal:{status:'active'}});await resume;assert.equal(f.state.threads[0].goal.status,'active');
});

function fileListFixture(){
  const f=fixture();Object.assign(f.state,{fileProject:'p',fileMode:'files',filePath:'old',listRequest:0,files:[{name:'old.txt',path:'old/old.txt',kind:'file',size:1}],diffFiles:[]});
  Object.assign(f.context,{AbortController,formatSize:value=>String(value)});vm.runInContext(section('let fileListRead=', 'async function openFile('),f.context);return f;
}
test('file listing keeps loading and failure states while the filter changes',async()=>{
  const f=fileListFixture(),loading=f.call('loadFiles','next');assert.equal(f.$('filePathLabel').textContent,'next');
  f.$('fileSearch').value='old';f.call('renderFiles');assert.equal(f.$('files').children[0].textContent,'正在读取…');assert.equal(f.$('files').children.length,1);
  f.settle(f.requests[0],Error('目录读取失败'),true);await assert.rejects(loading,/目录读取失败/);f.$('fileSearch').value='';f.call('renderFiles');
  assert.equal(f.$('files').children[0].textContent,'目录读取失败');assert.equal(f.$('files').children[1].textContent,'重试');
  const retry=f.$('files').children[1].onclick();assert(f.requests[1].path.endsWith('path=next'));f.settle(f.requests[1],{files:[{name:'new.txt',path:'next/new.txt',kind:'file',size:2}]});await retry;
  assert.equal(f.state.fileListError,'');assert.equal(f.$('files').children[0].title,'next/new.txt');
});
test('file listing old requests cannot clear a newer loading state',async()=>{
  const f=fileListFixture(),first=f.call('loadFiles','one'),second=f.call('loadFiles','two');
  f.settle(f.requests[0],Error('旧错误'),true);await first;assert.equal(f.state.fileListLoading,true);assert.equal(f.state.fileListError,'');
  f.settle(f.requests[1],{files:[]});await second;assert.equal(f.state.fileListLoading,false);assert.equal(f.$('files').children[0].textContent,'当前目录为空。');
});
test('file listing clears an error when the selected project is removed',async()=>{
  const f=fileListFixture();f.state.fileListError='之前的错误';f.state.fileListLoading=true;f.state.fileProject='';await f.call('loadFiles');
  assert.equal(f.requests.length,0);assert.equal(f.state.fileListError,'');assert.equal(f.state.fileListLoading,false);assert.equal(f.$('files').children[0].textContent,'选择一个项目以浏览文件。');
});

function previewFixture(){
  const f=fixture();Object.assign(f.state,{fileProject:'p',fileRequest:0,opened:{project:'p',path:'photo.png',kind:'image'}});
  f.context.updateDiffControls=()=>{};
  const heading=new MockNode('h2'),description=new MockNode('p');f.$('fileEmpty').querySelector=tag=>tag==='h2'?heading:description;
  Object.assign(f.context,{AbortController,allowFileLeave:async()=>true,diffCode:text=>f.context.el('pre','',text),renderFiles(){}});
  vm.runInContext(section('let filePreviewRead=', 'async function switchFileMode(')+section('async function previewFile()', 'const fileSaves=')+section('async function openDiff(', 'async function applyDiff('),f.context);
  return f;
}
test('file preview image errors can retry and stale image callbacks are ignored',async()=>{
  const f=previewFixture();await f.call('previewFile');const first=f.$('filePreview').children[1];assert.equal(f.$('filePreview').children[0].textContent,'正在加载图片…');assert.equal(first.hidden,true);
  first.onerror();assert.match(f.$('filePreview').children[0].textContent,/图片加载失败/);await f.$('filePreview').children[1].onclick();
  const second=f.$('filePreview').children[1];first.onload();assert.equal(second.hidden,true);second.onload();assert.equal(second.hidden,false);assert.equal(f.$('filePreview').children.length,1);
  f.state.generation++;second.onerror();assert.equal(f.$('filePreview').children[0],second);
});
test('file preview diff errors show a retry for the original file',async()=>{
  const f=previewFixture(),file={path:'file.txt'},first=f.call('openDiff',file);await flush();
  assert.equal(f.$('fileEmpty').querySelector('h2').textContent,'正在读取改动…');f.settle(f.requests[0],Error('读取故障'),true);f.settle(f.requests[1],{hunks:[]});await first;
  assert.equal(f.$('fileEmpty').hidden,true);assert.equal(f.$('diffView').hidden,false);assert.match(f.$('diffView').children[0].textContent,/读取故障/);
  const retry=f.$('diffView').children[1].onclick();await flush();assert(f.requests[2].path.includes('path=file.txt'));f.settle(f.requests[2],{diff:'修改内容'});f.settle(f.requests[3],{hunks:[]});await retry;
  assert.equal(f.state.diffSelected,file);assert.equal(f.$('diffView').children[1].textContent,'修改内容');
});
test('file preview old diff errors cannot replace the current file',async()=>{
  const f=previewFixture(),first=f.call('openDiff',{path:'old.txt'});await flush();const second=f.call('openDiff',{path:'new.txt'});await flush();
  f.settle(f.requests[2],{diff:'新文件改动'});f.settle(f.requests[3],{hunks:[]});await second;
  f.settle(f.requests[0],Error('旧请求失败'),true);f.settle(f.requests[1],{hunks:[]});await first;
  assert.equal(f.$('diffView').children[1].textContent,'新文件改动');assert.equal(f.$('openedFileName').textContent,'new.txt');
});

function diffActionFixture(){
  const f=fixture();Object.assign(f.state,{fileProject:'p',fileRequest:1,diffSelected:{path:'file.txt'},diffFiles:[]});
  const action=new MockNode('button');f.$('diffView').append(action);
  Object.assign(f.context,{confirmAction:async()=>true,resetFile(){f.state.fileRequest++;f.state.diffSelected=null;},loadFiles:async()=>{},openDiff:async()=>{}});
  vm.runInContext(section('const diffWrites=', 'function isInteractive('),f.context);f.action=action;return f;
}
test('diff actions block repeated writes and release controls after failure',async()=>{
  const f=diffActionFixture(),file=f.state.diffSelected,first=f.call('applyDiff','accept',file);
  assert.equal(f.action.disabled,true);await f.call('applyDiff','accept',file);assert.equal(f.requests.length,1);
  f.settle(f.requests[0],Error('暂存失败'),true);await assert.rejects(first,/暂存失败/);assert.equal(f.action.disabled,false);
  f.action.dataset.unavailable='true';f.call('updateDiffControls');assert.equal(f.action.disabled,true);
});
test('diff actions preserve confirmation cancellation and reject changed selection',async()=>{
  const f=diffActionFixture(),confirm=deferred(),file=f.state.diffSelected;f.context.confirmAction=()=>confirm.promise;
  const first=f.call('applyDiff','revert',file);await f.call('applyDiff','revert',file);assert.equal(f.requests.length,0);assert.equal(f.action.disabled,true);
  confirm.resolve(false);await first;assert.equal(f.action.disabled,false);assert.equal(f.requests.length,0);
  f.context.confirmAction=async()=>{f.state.fileRequest++;return true;};await f.call('applyDiff','revert',file);assert.equal(f.requests.length,0);
});
test('diff actions identify completed unstaging when list refresh fails',async()=>{
  const f=diffActionFixture(),file=f.state.diffSelected;f.context.loadFiles=async()=>{throw Error('列表离线');};
  const operation=f.call('applyDiff','revert',file,{source:'staged',index:1});await flush();assert(f.requests[0].path.includes('/hunk/revert'));
  f.state.fileRequest++;f.state.diffSelected={path:file.path};f.settle(f.requests[0],{});await operation;
  assert.equal(f.state.diffSelected,null);assert(f.toasts.some(args=>args[0]==='已取消暂存，列表刷新失败：列表离线'));assert.equal(f.action.disabled,false);
});

function terminalActionFixture(){
  const f=fixture();Object.assign(f.state,{terminalProject:'p',terminalRequest:0,activeTerminal:'old',terminalCommands:[],terminalSubmitting:false});
  Object.assign(f.context,{isInteractive:record=>Boolean(record?.interactive),renderTerminalList(){},syncTerminalOutput(){},selectTerminal:id=>{f.state.activeTerminal=id;}});
  vm.runInContext(section('async function refreshTerminals(', 'function renderTerminalList()')+section('async function newTerminal()', 'const terminalStops='),f.context);return f;
}
test('terminal actions ignore old list replies and replaced connections',async()=>{
  const f=terminalActionFixture(),first=f.call('refreshTerminals'),second=f.call('refreshTerminals');f.settle(f.requests[1],{commands:[{commandId:'latest'}]});await second;
  f.settle(f.requests[0],{commands:[{commandId:'old'}]});await first;assert.equal(f.state.terminalCommands[0].commandId,'latest');
  const disconnected=f.call('refreshTerminals');f.state.generation++;f.settle(f.requests[2],{commands:[]});await disconnected;assert.equal(f.state.terminalCommands[0].commandId,'latest');
});
test('terminal actions preserve failed command drafts and clear accepted commands before refresh',async()=>{
  const f=terminalActionFixture();f.$('commandInput').value='echo hello';const first=f.call('runTerminalCommand');await f.call('runTerminalCommand');assert.equal(f.requests.length,1);
  f.settle(f.requests[0],Error('提交失败'),true);await assert.rejects(first,/提交失败/);assert.equal(f.$('commandInput').value,'echo hello');assert.equal(f.state.terminalSubmitting,false);
  const retry=f.call('runTerminalCommand');f.settle(f.requests[1],{commandId:'created'});await flush();assert.equal(f.$('commandInput').value,'');
  f.settle(f.requests[2],Error('刷新失败'),true);await retry;assert(f.toasts.some(args=>args[0]==='命令已提交，列表刷新失败：刷新失败'));assert.equal(f.state.terminalSubmitting,false);
});
test('terminal actions preserve later input and the user terminal selection',async()=>{
  const f=terminalActionFixture();f.$('commandInput').value='first';const run=f.call('runTerminalCommand');f.$('commandInput').value='next';f.state.activeTerminal='chosen';
  f.settle(f.requests[0],{commandId:'created'});await flush();f.settle(f.requests[1],{commands:[]});await run;assert.equal(f.$('commandInput').value,'next');assert.equal(f.state.activeTerminal,'chosen');
});
test('terminal actions serialize creation and report creation separately from refresh failure',async()=>{
  const f=terminalActionFixture(),create=f.call('newTerminal');await f.call('newTerminal');assert.equal(f.requests.length,1);
  f.settle(f.requests[0],{sessionId:'created'});await flush();f.settle(f.requests[1],Error('刷新失败'),true);await create;
  assert.equal(f.state.terminalSubmitting,false);assert(f.toasts.some(args=>args[0]==='终端已创建，列表刷新失败：刷新失败'));
});

function terminalStopFixture(){
  const f=terminalActionFixture();f.state.terminalCommands=[{commandId:'old',status:'running',interactive:true},{commandId:'other',status:'running'}];
  vm.runInContext(section('const terminalStops=', 'const {loadSettings} ='),f.context);f.context.refreshTerminals=async()=>{};return f;
}
test('terminal stop blocks duplicate requests and restores the button on failure',async()=>{
  const f=terminalStopFixture(),stop=f.call('stopTerminal');await f.call('stopTerminal');assert.equal(f.requests.length,1);assert.equal(f.$('stopTerminalBtn').disabled,true);assert.equal(f.$('stopTerminalBtn').attributes['aria-busy'],'true');assert(f.requests[0].path.includes('/sessions/old/stop'));
  f.settle(f.requests[0],Error('停止失败'),true);await assert.rejects(stop,/停止失败/);assert.equal(f.$('stopTerminalBtn').disabled,false);assert.equal(f.$('stopTerminalBtn').attributes['aria-busy'],'false');
});
test('terminal stop tracks each terminal and distinguishes refresh failure',async()=>{
  const f=terminalStopFixture(),first=f.call('stopTerminal');f.state.activeTerminal='other';f.call('updateTerminalStopControl');assert.equal(f.$('stopTerminalBtn').disabled,false);
  const second=f.call('stopTerminal');assert(f.requests[1].path.endsWith('/terminal/other/stop'));f.context.refreshTerminals=async()=>{throw Error('列表离线');};
  f.settle(f.requests[0],{ok:true});await first;assert.equal(f.$('stopTerminalBtn').disabled,true);
  f.settle(f.requests[1],{ok:true});await second;assert.equal(f.$('stopTerminalBtn').disabled,false);assert(f.toasts.some(args=>args[0]==='停止请求已提交，列表刷新失败：列表离线'));assert.equal(f.state.terminalCommands[1].status,'running');
});
test('terminal stop ignores old connection errors and does not stop completed records',async()=>{
  const f=terminalStopFixture(),first=f.call('stopTerminal');f.state.generation++;f.settle(f.requests[0],Error('旧连接错误'),true);await first;assert.equal(f.toasts.length,0);
  f.state.terminalCommands[0].status='completed';await f.call('stopTerminal');assert.equal(f.requests.length,1);f.call('updateTerminalStopControl');assert.equal(f.$('stopTerminalBtn').disabled,true);
});

function settingsSaveFixture({autoRead=true}={}){
  const f=fixture();Object.assign(f.state,{settingsLoaded:true,rawSettingsLoaded:true,settingsDirty:true,rawDirty:true,settings:{}});
  f.context.loadModels=async()=>{};f.context.refreshCodex=async()=>{};
  if(autoRead){const api=f.context.api;f.context.api=(url,options)=>options?.method==='PUT'?api(url,options):f.context.settingsReadError?Promise.reject(f.context.settingsReadError):Promise.resolve(settingsReadValue(url));}
  installSettings(f);return f;
}
test('settings save preserves edits made while the submitted version is pending',async()=>{
  const f=settingsSaveFixture();f.$('settingModel').value='first';const saving=f.call('saveSettings');f.$('settingModel').value='next';await f.call('saveSettings');await f.call('saveRawConfig');assert.equal(f.requests.length,1);
  f.settle(f.requests[0],{settings:{model:'first'}});await saving;assert.equal(f.state.settingsDirty,true);assert.equal(f.$('settingModel').value,'next');assert.equal(f.state.settingsSaving,false);assert(f.toasts.some(args=>args[0].includes('后续修改尚未保存')));
});
test('settings save raw content keeps ordinary settings and newer raw input dirty',async()=>{
  const f=settingsSaveFixture();f.$('rawConfig').value='first';const saving=f.call('saveRawConfig');f.$('rawConfig').value='next';f.settle(f.requests[0],{config:{content:'first'}});await saving;
  assert.equal(f.state.settingsDirty,true);assert.equal(f.state.rawDirty,true);assert.equal(f.$('rawConfig').value,'next');
});
test('settings save preserves failed drafts and separates post-save refresh failure',async()=>{
  const f=settingsSaveFixture(),first=f.call('saveSettings');f.settle(f.requests[0],Error('写入失败'),true);await assert.rejects(first,/写入失败/);assert.equal(f.state.settingsDirty,true);assert.equal(f.state.settingsSaving,false);
  f.context.settingsReadError=Error('刷新失败');const retry=f.call('saveSettings');f.settle(f.requests[1],{settings:{}});await retry;
  assert.equal(f.state.settingsDirty,false);assert(f.toasts.some(args=>args[0]==='设置已保存，部分设置读取失败，请在设置页重试。'));
});
test('settings save ignores a replaced connection',async()=>{
  const f=settingsSaveFixture(),saving=f.call('saveSettings');f.state.generation++;
  f.settle(f.requests[0],{settings:{model:'old connection'}});await saving;assert.equal(f.state.settingsDirty,true);assert.equal(f.state.settings.model,undefined);assert.equal(f.toasts.length,0);
});

function modelListFixture(){
  const f=fixture();f.context.Option=function(label,value){const node=new MockNode('option','',label);node.value=value;return node;};
  vm.runInContext(section('async function loadModels()', 'function fillModelChoices('),f.context);return f;
}
test('model listing ignores an older failure after new model choices arrive',async()=>{
  const f=modelListFixture(),first=f.call('loadModels'),second=f.call('loadModels');
  f.settle(f.requests[1],{models:[{model:'current'}],backends:[{id:'current-backend'}]});await second;f.settle(f.requests[0],Error('旧请求失败'),true);await first;
  assert.equal(f.state.models[0].model,'current');assert.equal(f.state.backends[0].id,'current-backend');assert.equal(f.$('chatModel').disabled,false);assert.equal(f.toasts.length,0);
});
test('model listing preserves current failure state and ignores replaced connections',async()=>{
  const f=modelListFixture(),first=f.call('loadModels'),second=f.call('loadModels');f.state.backends=[{id:'old-backend'}];
  f.settle(f.requests[1],Error('当前读取失败'),true);await assert.rejects(second,/当前读取失败/);f.settle(f.requests[0],{models:[{model:'outdated'}]});await first;
  assert.equal(f.state.models.length,0);assert.equal(f.state.backends.length,0);assert.equal(f.$('chatModel').disabled,true);assert.equal(f.toasts.length,0);
  const third=f.call('loadModels');f.state.generation++;f.state.models=[{model:'new-connection'}];f.settle(f.requests[2],Error('断开的请求'),true);await third;
  assert.equal(f.state.models[0].model,'new-connection');assert.equal(f.toasts.length,0);
});

function localPreviewFixture(){
  const f=fixture(),control=new MockNode('button'),heading=new MockNode('h2'),detail=new MockNode('p');
  f.$('previewForm').querySelector=()=>control;f.$('previewEmpty').querySelector=tag=>tag==='h2'?heading:detail;f.context.validatePreview=value=>value;f.$('previewUrl').value='http://localhost:5173';
  vm.runInContext(section('let localPreviewTicket=', 'let drawerReturnFocus;'),f.context);return{...f,control,heading,detail};
}
test('local preview ignores duplicate submissions and older successful replies',async()=>{
  const f=localPreviewFixture(),first=f.call('previewLocal');await f.call('previewLocal');assert.equal(f.requests.length,1);assert.equal(f.control.attributes['aria-busy'],'true');
  f.$('previewUrl').value='http://localhost:5174';const second=f.call('previewLocal');f.settle(f.requests[1],{url:'/new-preview'});await second;
  f.settle(f.requests[0],{url:'/old-preview'});await first;assert.equal(f.$('preview').src,'/new-preview');assert.equal(f.control.textContent,'打开预览');assert.equal(f.control.attributes['aria-busy'],'false');
});
test('local preview failures preserve existing content and replaced connections',async()=>{
  const f=localPreviewFixture(),initial=f.call('previewLocal');f.settle(f.requests[0],Error('无法连接'),true);await assert.rejects(initial,/无法连接/);assert.equal(f.heading.textContent,'无法打开预览');assert.equal(f.detail.textContent,'无法连接');
  const retry=f.call('previewLocal');f.settle(f.requests[1],{url:'/working'});await retry;
  const failed=f.call('previewLocal');f.settle(f.requests[2],Error('新请求失败'),true);await assert.rejects(failed,/新请求失败/);assert.equal(f.$('preview').src,'/working');assert.equal(f.$('preview').hidden,false);
  const old=f.call('previewLocal');f.state.generation++;f.settle(f.requests[3],{url:'/old-connection'});await old;assert.equal(f.$('preview').src,'/working');assert.equal(f.control.attributes['aria-busy'],'false');
});

function upgradeFixture(){
  const f=fixture();installManagement(f);return f;
}
test('upgrade check distinguishes unknown versions from current versions',async()=>{
  const f=upgradeFixture(),unknown=f.call('checkUpgrade');await f.call('checkUpgrade');assert.equal(f.requests.length,1);assert.equal(f.$('checkUpgradeBtn').disabled,true);
  f.settle(f.requests[0],{upgrade:{installedVersion:null,latestVersion:'1.2.3',updateAvailable:false}});await unknown;assert.match(f.$('upgradeStatus').textContent,/未能读取当前版本/);assert(!f.$('upgradeStatus').textContent.includes('已是最新'));assert.equal(f.$('checkUpgradeBtn').disabled,false);
  const same=f.call('checkUpgrade');f.settle(f.requests[1],{upgrade:{installedVersion:'1.2.3',latestVersion:'1.2.3',updateAvailable:false}});await same;assert.equal(f.$('upgradeStatus').textContent,'当前已是最新版本 1.2.3');
});
test('upgrade check can retry failures and ignores old connection results',async()=>{
  const f=upgradeFixture(),failed=f.call('checkUpgrade');f.settle(f.requests[0],Error('网络故障'),true);await failed;assert.equal(f.$('upgradeStatus').textContent,'检查更新失败：网络故障');assert.equal(f.$('checkUpgradeBtn').disabled,false);
  const old=f.call('checkUpgrade');f.state.generation++;f.call('updateUpgradeControl');assert.equal(f.$('upgradeStatus').textContent,'');
  const current=f.call('checkUpgrade');f.settle(f.requests[1],{upgrade:{installedVersion:'0.1.0',latestVersion:'0.1.0'}});await old;assert.equal(f.$('checkUpgradeBtn').disabled,true);assert.equal(f.$('upgradeStatus').textContent,'正在检查更新…');
  f.settle(f.requests[2],{upgrade:{error:'升级检查已关闭'}});await current;assert.equal(f.$('upgradeStatus').textContent,'检查更新失败：升级检查已关闭');assert.equal(f.$('checkUpgradeBtn').disabled,false);
});

function projectListFixture(){
  const f=fixture();Object.assign(f.state,{projects:[{id:'old',path:'/old',trusted:true}],sidebarProjects:[{id:'old',path:'/old',trusted:true}],chatProject:'old'});
  f.projectRenders=[];f.context.renderProjects=()=>f.projectRenders.push(f.state.projects.map(project=>project.id));vm.runInContext(section('let projectListRead=', 'function renderProjects()'),f.context);return f;
}
test('project listing applies allowed projects when the sidebar fails',async()=>{
  const f=projectListFixture(),load=f.call('readProjects');f.settle(f.requests[0],{projects:[{id:'allowed',path:'/allowed',trusted:true}]});await flush();assert.equal(f.state.projects[0].id,'old');
  f.settle(f.requests[1],Error('侧边栏故障'),true);await load;assert.equal(f.state.projects[0].id,'allowed');assert.equal(f.state.sidebarProjects[0].id,'allowed');assert.equal(f.projectRenders.length,1);assert.equal(f.toasts.length,1);
  const again=f.call('readProjects');f.settle(f.requests[2],{projects:f.state.projects});f.settle(f.requests[3],Error('侧边栏故障'),true);await again;assert.equal(f.toasts.length,1);
});
test('project listing retains both old lists when the primary read fails',async()=>{
  const f=projectListFixture(),load=f.call('readProjects');f.settle(f.requests[0],Error('项目读取失败'),true);f.settle(f.requests[1],{projects:[{id:'sidebar-new'}]});await assert.rejects(load,/项目读取失败/);
  assert.equal(f.state.projects[0].id,'old');assert.equal(f.state.sidebarProjects[0].id,'old');assert.equal(f.state.chatProject,'old');assert.equal(f.projectRenders.length,0);
});
test('project listing ignores older refreshes and replaced connections',async()=>{
  const f=projectListFixture(),old=f.call('readProjects'),current=f.call('readProjects');f.settle(f.requests[2],{projects:[{id:'new'}]});f.settle(f.requests[3],{projects:[{id:'new'}]});await current;
  f.settle(f.requests[0],{projects:[]});f.settle(f.requests[1],{projects:[]});await old;assert.equal(f.state.projects[0].id,'new');
  const disconnected=f.call('readProjects');f.state.generation++;f.settle(f.requests[4],Error('旧连接'),true);f.settle(f.requests[5],{projects:[]});await disconnected;assert.equal(f.state.projects[0].id,'new');assert.equal(f.projectRenders.length,1);
});

function projectSubmitFixture(){
  const f=fixture();Object.assign(f.state,{projects:[],sidebarProjects:[]});
  for(const id of ['projectSubmitBtn','projectPath','projectCreate','projectName']){f.$(id).tag=id==='projectSubmitBtn'?'button':'input';f.$('projectForm').append(f.$(id));}
  f.$('projectPath').value='/work';f.$('projectCreate').onchange=()=>{};f.$('projectDialog').showModal();
  Object.assign(f.context,{showInline:(id,text)=>f.$(id).textContent=text,closeDialog:id=>f.$(id).close(),refreshProjects:async()=>{},selectProject:async project=>{f.state.chatProject=project.id;}});
  vm.runInContext(section('let projectSubmitting=', '$("prompt").oninput'),f.context);return f;
}
test('project submit preserves failures and blocks repeated requests',async()=>{
  const f=projectSubmitFixture(),event={preventDefault(){}},first=f.call('submitProject',event);await f.call('submitProject',event);assert.equal(f.requests.length,1);assert.equal(f.$('projectPath').disabled,true);
  let prevented=false;f.$('projectDialog').oncancel({preventDefault(){prevented=true;}});assert(prevented);
  f.settle(f.requests[0],Error('添加失败'),true);await first;assert.equal(f.$('projectPath').value,'/work');assert.equal(f.$('projectDialog').open,true);assert.equal(f.$('projectPath').disabled,false);assert.equal(f.$('projectError').textContent,'添加失败');
});
test('project submit commits locally and closes before a failed refresh',async()=>{
  const f=projectSubmitFixture();f.context.refreshProjects=async()=>{assert.equal(f.$('projectDialog').open,false);throw Error('列表离线');};
  const first=f.call('submitProject',{preventDefault(){}});f.settle(f.requests[0],{project:{id:'added',path:'/work',trusted:true}});await first;
  assert.equal(f.state.projects[0].id,'added');assert.equal(f.state.sidebarProjects[0].id,'added');assert.equal(f.state.chatProject,'added');assert.equal(f.$('projectPath').value,'');assert.equal(f.toasts.at(-1)[0],'项目已添加，列表刷新失败：列表离线');
});
test('project submit ignores an old connection and preserves later navigation',async()=>{
  const f=projectSubmitFixture(),first=f.call('submitProject',{preventDefault(){}});f.state.generation++;f.settle(f.requests[0],{project:{id:'old'}});await first;assert.equal(f.state.projects.length,0);assert.equal(f.$('projectDialog').open,true);
  const next=f.call('submitProject',{preventDefault(){}});f.state.selection++;f.state.chatProject='chosen';f.settle(f.requests[1],{project:{id:'added',path:'/work',trusted:true}});await next;assert.equal(f.state.chatProject,'chosen');assert.equal(f.state.projects[0].id,'added');
});

function rootRemovalFixture(){
  const f=fixture();Object.assign(f.state,{projects:[{id:'project',name:'测试项目',path:'/work'}],sidebarProjects:[{id:'project',path:'/work'}]});Object.assign(f.context,{confirmAction:async()=>true,refreshProjects:async()=>{}});
  installManagement(f);return f;
}
test('root removal preserves cancellation and validates the confirmed connection',async()=>{
  const f=rootRemovalFixture(),project=f.state.projects[0];f.context.confirmAction=async()=>false;await f.call('removeProjectRoot',project,1);assert.equal(f.requests.length,0);assert.equal(f.state.projects.length,1);
  const confirmation=deferred();f.context.confirmAction=()=>confirmation.promise;const remove=f.call('removeProjectRoot',project,1);f.state.generation++;confirmation.resolve(true);await remove;assert.equal(f.requests.length,0);assert.equal(f.state.projects.length,1);
});
test('root removal serializes duplicate actions and restores controls after failure',async()=>{
  const f=rootRemovalFixture(),project=f.state.projects[0],remove=f.call('removeProjectRoot',project,1);await flush();await f.call('removeProjectRoot',project,1);assert.equal(f.requests.length,1);assert.equal(f.$('projectRoots').children[0].children[1].disabled,true);
  f.settle(f.requests[0],Error('移除失败'),true);await assert.rejects(remove,/移除失败/);assert.equal(f.state.projects.length,1);assert.equal(f.$('projectRoots').children[0].children[1].disabled,false);
});
test('root removal keeps committed state when the subsequent list refresh fails',async()=>{
  const f=rootRemovalFixture();f.context.refreshProjects=async()=>{throw Error('列表离线');};const remove=f.call('removeProjectRoot',f.state.projects[0],1);await flush();f.settle(f.requests[0],{});await remove;
  assert.equal(f.state.projects.length,0);assert.equal(f.state.sidebarProjects.length,0);assert(f.toasts.some(args=>args[0]==='项目访问权限已移除，列表刷新失败：列表离线'));assert.equal(f.$('projectRoots').children[0].textContent,'还没有添加项目目录。');
});

function copyFixture(){
  const f=fixture();f.context.navigator={clipboard:{writeText:async()=>{throw Error('clipboard blocked');}}};f.context.document.querySelector=()=>null;
  vm.runInContext(section('async function copy(', 'let approvalRefreshTicket='),f.context);return f;
}
test('clipboard fallback uses the active dialog and restores focused input selection',async()=>{
  const f=copyFixture(),dialog=new MockNode('dialog'),input=new MockNode('input');dialog.connect(true);dialog.append(input);Object.assign(input,{selectionStart:1,selectionEnd:3,selectionDirection:'forward',closest:()=>dialog});
  let focused=false,selection;input.focus=()=>{focused=true;};input.setSelectionRange=(...args)=>{selection=args;};f.context.document.activeElement=input;
  f.context.document.execCommand=command=>{assert.equal(command,'copy');assert.equal(dialog.children.at(-1).tag,'textarea');assert.equal(dialog.children.at(-1).value,'copy text');return true;};
  await f.call('copy','copy text');assert.equal(dialog.children.length,1);assert(focused);assert.deepEqual(selection,[1,3,'forward']);assert.equal(f.toasts[0][0],'已复制');
});
test('clipboard fallback removes temporary input when copying throws',async()=>{
  const f=copyFixture();f.context.document.execCommand=()=>{throw Error('copy unavailable');};await assert.rejects(f.call('copy','text'),/复制失败，请手动选择文本复制/);
  assert(!f.nodes.some(node=>node.tag==='textarea'&&node.isConnected));assert.equal(f.toasts.length,0);
  f.context.navigator.clipboard.writeText=async()=>{};await f.call('copy','text',false);assert.equal(f.toasts.length,0);
});

function threadDeleteFixture(){
  const f=fixture();f.restored=0;Object.assign(f.context,{confirmAction:async()=>true,refreshThreads:async()=>{},restoreDraft:()=>{f.restored++;}});
  vm.runInContext(section('const deletingThreads=', 'function showThreadMenu('),f.context);return f;
}
test('thread removal prevents duplicate confirmation and checks the connection before writing',async()=>{
  const f=threadDeleteFixture(),confirmation=deferred();f.context.confirmAction=()=>confirmation.promise;const thread=f.state.threads[0],pending=f.call('deleteSelectedThread',thread);await f.call('deleteSelectedThread',thread);assert.equal(f.requests.length,0);
  f.state.generation++;confirmation.resolve(true);await pending;assert.equal(f.requests.length,0);assert.equal(f.state.threads.length,3);
  f.context.confirmAction=async()=>false;await f.call('deleteSelectedThread',thread);assert.equal(f.requests.length,0);
});
test('thread removal commits the selected thread before a failed refresh',async()=>{
  const f=threadDeleteFixture();f.state.events.set('A',[]);f.context.refreshThreads=async()=>{assert.equal(f.state.threadId,'');throw Error('刷新离线');};
  const pending=f.call('deleteSelectedThread',f.state.threads[0]);await flush();await f.call('deleteSelectedThread',f.state.threads[0]);assert.equal(f.requests.length,1);f.settle(f.requests[0],{});await pending;
  assert.equal(f.state.threads.length,2);assert.equal(f.state.events.has('A'),false);assert.equal(f.state.selection,1);assert.equal(f.restored,1);assert(f.toasts.some(args=>args[0]==='会话已移除，列表刷新失败：刷新离线'));
});
test('thread removal preserves another selected conversation and permits retry after failure',async()=>{
  const f=threadDeleteFixture(),thread=f.state.threads[0],first=f.call('deleteSelectedThread',thread);await flush();f.settle(f.requests[0],Error('移除失败'),true);await assert.rejects(first,/移除失败/);assert.equal(f.state.threads.length,3);
  const retry=f.call('deleteSelectedThread',thread);await flush();f.state.threadId='B';f.$('prompt').value='正在编辑';f.settle(f.requests[1],{});await retry;
  assert.equal(f.state.threadId,'B');assert.equal(f.$('prompt').value,'正在编辑');assert.equal(f.restored,0);assert.equal(f.state.threads.length,2);
});

function pinFixture(){
  const f=fixture();f.context.refreshThreads=async()=>{};vm.runInContext(section('const pinningThreads=', 'function showThreadMenu('),f.context);return f;
}
test('thread pin updates the list once and distinguishes refresh failure',async()=>{
  const f=pinFixture(),thread=f.state.threads[0];f.state.threads[1].pinnedIndex=2;f.context.refreshThreads=async()=>{throw Error('列表离线');};
  const first=f.call('setThreadPinned',thread);await f.call('setThreadPinned',thread);assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.body.pinned,true);
  f.state.threads[0]={...thread,title:'更新后的标题'};f.settle(f.requests[0],{ok:true,pinned:true});await first;
  assert.equal(f.state.threads[0].pinnedIndex,3);assert.equal(f.state.threads[0].title,'更新后的标题');assert(f.toasts.some(args=>args[0]==='已置顶，列表刷新失败：列表离线'));
  const unpin=f.call('setThreadPinned',f.state.threads[0]);f.settle(f.requests[1],{ok:true,pinned:false});await unpin;assert.equal(f.state.threads[0].pinnedIndex,null);
});
test('thread pin preserves the prior state after failure or connection replacement',async()=>{
  const f=pinFixture(),first=f.call('setThreadPinned',f.state.threads[0]);f.settle(f.requests[0],Error('置顶失败'),true);await assert.rejects(first,/置顶失败/);assert.equal(f.state.threads[0].pinnedIndex,undefined);
  const retry=f.call('setThreadPinned',f.state.threads[0]);f.state.generation++;f.settle(f.requests[1],{ok:true,pinned:true});await retry;assert.equal(f.state.threads[0].pinnedIndex,undefined);assert.equal(f.toasts.length,0);
});

function threadSearchFixture(){
  const f=fixture();Object.assign(f.context,{setTimeout:()=>1,clearTimeout(){},snippetWithHits:text=>f.context.el('span','',text)});
  vm.runInContext(section('let threadMatchesTimer=', 'function snippetWithHits(')+section('async function loadThreadMatches(', '$("refreshThreads").onclick'),f.context);return f;
}
test('thread search invalidates older results during the debounce interval',async()=>{
  const f=threadSearchFixture();f.$('search').value='first';const old=f.call('loadThreadMatches','first');f.$('search').value='second';f.call('queueThreadMatches');f.settle(f.requests[0],{matches:[{threadId:'A',title:'旧结果'}]});await old;
  assert.equal(f.$('threadMatches').children[0].textContent,'正在搜索正文…');assert.equal(f.$('threadMatchesCount').textContent,'');
  f.$('search').value='';f.call('queueThreadMatches');assert.equal(f.$('threadMatchesHeading').hidden,true);assert.equal(f.$('threadMatches').children.length,0);
});
test('thread search distinguishes failure from no results and supports retry',async()=>{
  const f=threadSearchFixture();f.$('search').value='query';const first=f.call('loadThreadMatches','query');f.settle(f.requests[0],Error('搜索离线'),true);await first;assert.match(f.$('threadMatches').children[0].textContent,/正文搜索失败/);
  const retry=f.$('threadMatches').children[1].onclick();f.settle(f.requests[1],{matches:[]});await retry;assert.equal(f.$('threadMatches').children[0].textContent,'未找到匹配的正文。');
});
test('thread search ignores replaced assistants and shows disconnected state',async()=>{
  const f=threadSearchFixture();f.$('search').value='query';const first=f.call('loadThreadMatches','query');f.state.harness='claude';f.settle(f.requests[0],{matches:[{threadId:'A',title:'旧助手'}]});await first;
  assert.equal(f.$('threadMatches').children[0].textContent,'正在搜索正文…');f.state.connected=false;f.call('queueThreadMatches');assert.equal(f.$('threadMatches').children[0].textContent,'连接后搜索正文。');assert.equal(f.requests.length,1);
});

function confirmationFixture(){
  const f=fixture();f.context.openDialog=id=>f.$(id).showModal();f.context.closeDialog=id=>{f.$(id).open=false;};
  f.deliverClose=()=>f.$('confirmDialog').dispatchEvent({type:'close'});
  vm.runInContext(section('let confirmationQueue=', 'function updateConnection()'),f.context);return f;
}
test('confirmation queue waits for the actual close event before showing the next request',async()=>{
  const f=confirmationFixture(),first=f.call('confirmAction','第一个操作','说明一'),second=f.call('confirmAction','第二个操作','说明二');await flush();assert.equal(f.$('confirmTitle').textContent,'第一个操作');
  f.$('confirmCancel').onclick();await flush();assert.equal(f.$('confirmTitle').textContent,'第一个操作');assert.equal(f.$('confirmDialog').open,false);
  f.deliverClose();assert.equal(await first,false);await flush();assert.equal(f.$('confirmTitle').textContent,'第二个操作');assert.equal(f.$('confirmDialog').open,true);
  f.$('confirmAccept').onclick();f.deliverClose();assert.equal(await second,true);assert.equal(f.$('confirmAccept').onclick,null);
});
test('confirmation queue handles Escape, external close and obsolete connections',async()=>{
  const f=confirmationFixture(),escape=f.call('confirmAction','操作','说明');await flush();let prevented=false;f.$('confirmDialog').dispatchEvent({type:'cancel',preventDefault(){prevented=true;}});assert(prevented);f.deliverClose();assert.equal(await escape,false);
  const external=f.call('confirmAction','关闭测试','说明');await flush();f.$('confirmDialog').open=false;f.deliverClose();assert.equal(await external,false);
  const active=f.call('confirmAction','旧操作','说明'),queued=f.call('confirmAction','旧排队操作','说明');await flush();f.state.generation++;f.$('confirmAccept').onclick();f.deliverClose();assert.equal(await active,false);assert.equal(await queued,false);assert.equal(f.$('confirmDialog').open,false);
});

function apiResponseFixture(){
  const f=fixture();f.cleared=0;Object.assign(f.context,{AbortController,setTimeout:()=>1,clearTimeout:()=>{f.cleared++;},fetch:async()=>f.response});
  vm.runInContext(section('async function api(', 'function onlineRequired()'),f.context);return f;
}
test('api response rejects malformed success and preserves response-body timeouts',async()=>{
  const f=apiResponseFixture();f.response={ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token');}};
  await assert.rejects(f.call('api','/mock'),/响应格式异常/);assert.equal(f.cleared,1);
  const abort=Object.assign(new Error('read aborted'),{name:'AbortError'});f.response.json=async()=>{throw abort;};await assert.rejects(f.call('api','/mock'),error=>error===abort);assert.equal(f.cleared,2);
});
test('api response accepts explicit empty success and retains HTTP error status',async()=>{
  const f=apiResponseFixture();f.response={ok:true,status:204,json:async()=>{throw new SyntaxError('empty');}};const empty=await f.call('api','/mock');assert.equal(Object.keys(empty).length,0);
  f.response={ok:false,status:502,json:async()=>{throw new SyntaxError('html response');}};await assert.rejects(f.call('api','/mock'),error=>error.status===502&&error.message==='请求失败（HTTP 502）');
  f.response={ok:false,status:401,json:async()=>null};await assert.rejects(f.call('api','/mock'),error=>error.status===401&&error.message.includes('访问凭据无效'));
});

test('control refresh updates terminal shortcuts without interrupting other controls',()=>{
  const f=fixture();Object.assign(f.state,{imageDrafts:{},fileDrafts:{},terminalProject:'p',activeTerminal:'terminal',terminalCommands:[{commandId:'terminal',interactive:true,status:'running'}]});
  const submit=new MockNode('button'),shortcut=new MockNode('button');f.$('commandForm').querySelector=()=>submit;f.$('terminalShortcuts').append(shortcut);f.context.document.querySelector=()=>new MockNode();
  Object.assign(f.context,{changingGoals:new Set(),pendingStops:new Set(),queueSubmitting:false,isRunning:()=>false,draftKey:()=> 'draft',icon:()=>'',fileDirty:()=>false,isInteractive:record=>Boolean(record?.interactive),scheduleUploadDraftSync(){},renderSlashCommands(){},renderCodexStatus(){}});
  vm.runInContext(section('function updateGoalControls()', 'const eventFocus=')+section('const terminalStops=', 'async function stopTerminal()'),f.context);
  installManagement(f);f.call('updateControls');assert.equal(shortcut.disabled,false);assert.equal(f.$('stopTerminalBtn').disabled,false);assert.equal(submit.disabled,false);
  f.state.settingsLoaded=true;f.state.rawSettingsLoaded=false;f.call('updateControls');assert.equal(f.$('saveSettingsBtn').disabled,false);assert.equal(f.$('saveRawBtn').disabled,true);
  f.state.settingsLoaded=false;f.state.rawSettingsLoaded=true;f.call('updateControls');assert.equal(f.$('saveSettingsBtn').disabled,true);assert.equal(f.$('saveRawBtn').disabled,false);
  f.state.terminalCommands[0].status='completed';f.call('updateControls');assert.equal(shortcut.disabled,true);assert.equal(f.$('stopTerminalBtn').disabled,true);
  f.state.connected=false;f.call('updateControls');assert.equal(submit.disabled,true);assert.equal(f.$('newTerminalBtn').disabled,true);
});

function settingsLoadFixture(){
  return settingsSaveFixture({autoRead:false});
}
function settingsReadValue(url){
  return url==='/api/settings/user'?{settings:{model:'test-model'}}:url==='/api/settings/user/raw'?{config:{path:'/test',content:'saved'}}:url==='/api/settings/approval-summary'?{summary:{summary:'summary'}}:url==='/api/settings/remote-approval'?{desktopAutoApprove:false}:url==='/api/settings/capacity-retry'?{enabled:false}:{agents:[]};
}
function settleSettingsRead(f,start=0,failed=-1){
  for(let index=0;index<6;index++){const request=f.requests[start+index];f.settle(request,index===failed?Error('读取失败'):settingsReadValue(request.path),index===failed);}
}

test('settings load disables only the failed configuration and retry restores readiness',async()=>{
  const f=settingsLoadFixture();f.$('rawConfig').value='unsaved';const first=f.call('loadSettings');assert.equal(f.state.settingsLoaded,false);assert.equal(f.state.rawSettingsLoaded,false);settleSettingsRead(f,0,1);const result=await first;
  assert.equal(f.state.settingsLoaded,true);assert.equal(f.state.rawSettingsLoaded,false);assert.match(f.$('settingsLoadMessage').textContent,/完整配置/);assert.equal(f.$('retrySettings').hidden,false);assert.equal(result.errors.length,1);assert.equal(f.$('rawConfig').value,'unsaved');
  const retry=f.call('loadSettings');settleSettingsRead(f,6);await retry;assert.equal(f.state.rawSettingsLoaded,true);assert.equal(f.$('settingsLoadStatus').hidden,true);assert.equal(f.$('rawConfig').value,'unsaved');
});
test('settings load still reads raw configuration after model and ordinary settings failures',async()=>{
  const f=settingsLoadFixture();f.context.loadModels=async()=>{throw Error('模型失败');};const first=f.call('loadSettings');settleSettingsRead(f,0,0);const result=await first;
  assert.equal(f.state.settingsLoaded,false);assert.equal(f.state.rawSettingsLoaded,true);assert.equal(result.errors.length,2);assert.match(f.$('settingsLoadMessage').textContent,/模型.*普通设置/);
});
test('settings load cannot mark an old connection as ready',async()=>{
  const f=settingsLoadFixture(),first=f.call('loadSettings');f.state.generation++;settleSettingsRead(f);await first;
  assert.equal(f.state.settingsLoaded,false);assert.equal(f.state.rawSettingsLoaded,false);assert.equal(f.state.settings.model,undefined);
});
