import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {sidebarThreadRoots,sidebarInactiveAgents,threadFamilyRunning} from '../public/thread-family.js';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;return {promise:new Promise((done,fail)=>{resolve=done;reject=fail;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('history equality reuses structural comparison without serializing loaded bodies',()=>{
 let serializedCharacters=0;
 const context=vm.createContext({JSON:{stringify:value=>{const text=JSON.stringify(value);serializedCharacters+=text.length;return text;}}});
 const equalityStart=source.indexOf('function sameConversationData('),equalityEnd=source.indexOf('let conversationThread =',equalityStart);
 const eventsStart=source.indexOf('function sameConversationEvents('),eventsEnd=source.indexOf('function updateConversationHistoryState()',eventsStart);
 assert(equalityStart>=0&&equalityEnd>equalityStart&&eventsStart>=0&&eventsEnd>eventsStart);
 vm.runInContext(source.slice(equalityStart,equalityEnd)+source.slice(eventsStart,eventsEnd),context);
 const body='long message and command output\n'.repeat(12000);
 const before=[{type:'message.delta',eventId:'answer',text:body},
  {type:'file.changed',eventId:'patch',diff:'+++ b/a.ts\n@@\n+'+body,fileChanges:[{path:'a.ts',added:12000,removed:0}]},
  {type:'tool.output',eventId:'command',text:body,detailsDeferred:false}];
 const after=structuredClone(before);
 assert.equal(context.sameConversationEvents(before,after),true);
 assert.equal(serializedCharacters,0,`Unchanged history comparison serialized ${serializedCharacters} characters`);
 const changed=structuredClone(after);changed[1].fileChanges[0].added++;
 assert.equal(context.sameConversationEvents(before,changed),false);
 assert.equal(context.sameConversationEvents(before,after.slice(1)),false);
 assert.equal(context.sameConversationEvents(before,[after[1],after[0],after[2]]),false);
 changed[1].fileChanges[0].added--;changed[2].text+='new output';
 assert.equal(context.sameConversationEvents(before,changed),false);
 const reordered=after.map(event=>Object.fromEntries(Object.entries(event).reverse()));
 assert.equal(context.sameConversationEvents(before,reordered),true);
});

test('inactive agent section opens on the first click and creates rows only while open or searching',()=>{
 const nodes=new Map(),rendered=new Map(),persisted=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{id,dataset:{},value:'',hidden:false,querySelectorAll:()=>[]});
  return nodes.get(id);
 };
 const attributes=new Map(),count={textContent:''};
 const toggle={dataset:{collapse:'inactiveAgents'},setAttribute:(name,value)=>attributes.set(name,value),querySelector:()=>count};
 const context=vm.createContext({state:{harness:'codex',connected:true,threads:[
  {id:'main',title:'任务'},{id:'child',title:'检查',status:'completed',subagent:{parentThreadId:'main',nickname:'Sol'}}]},
  $:node,document:{querySelectorAll:()=>[toggle]},collapsedSections:{},requestAnimationFrame:()=>{},updateSidebarScrollbar:()=>{},
  safeWrite:(key,value)=>persisted.push(JSON.parse(value)),harnessForThread:()=> 'codex',sidebarThreadRoots,sidebarInactiveAgents,threadFamilyRunning,
  reconcileThreadSection:(host,rows)=>rendered.set(host.id,rows.map(row=>row.id))});
 const sectionsStart=source.indexOf('function applySidebarSections(){'),sectionsEnd=source.indexOf('const sidebarScroller=',sectionsStart);
 const renderStart=source.indexOf('function renderThreads() {'),renderEnd=source.indexOf('const harnessNames=',renderStart);
 assert(sectionsStart>=0&&sectionsEnd>sectionsStart&&renderStart>=0&&renderEnd>renderStart);
 vm.runInContext(source.slice(sectionsStart,sectionsEnd)+source.slice(renderStart,renderEnd),context);
 context.renderThreads();assert.deepEqual(Array.from(rendered.get('inactiveAgents')),[]);
 assert.equal(node('inactiveAgents').hidden,true);assert.equal(count.textContent,'1');
 toggle.onclick();assert.deepEqual(Array.from(rendered.get('inactiveAgents')),['child']);assert.equal(node('inactiveAgents').hidden,false);
 assert.equal(attributes.get('aria-expanded'),'true');assert.equal(persisted.at(-1).inactiveAgents,false);
 toggle.onclick();assert.deepEqual(Array.from(rendered.get('inactiveAgents')),[]);assert.equal(node('inactiveAgents').hidden,true);
 node('search').value='Sol';context.renderThreads();assert.deepEqual(Array.from(rendered.get('inactiveAgents')),['child']);assert.equal(node('inactiveAgents').hidden,false);
 node('search').value='';context.renderThreads();assert.deepEqual(Array.from(rendered.get('inactiveAgents')),[]);
});

test('sidebar readers share work, queue one changed snapshot and isolate old connections',async()=>{
 const reads=[],context=vm.createContext({state:{generation:1},readThreads:()=>{const read=deferred();reads.push(read);return read.promise;}});
 const start=source.indexOf('let threadListRead=null;'),end=source.indexOf('async function readThreads()',start);
 assert(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
 const first=context.refreshThreads();assert.equal(context.refreshThreads({changed:false}),first);assert.equal(reads.length,1);
 context.refreshThreads({changed:true});context.refreshThreads({changed:true});reads[0].resolve();await tick();
 assert.equal(reads.length,2,'multiple changes need only one follow-up');reads[1].resolve();await first;
 const old=context.refreshThreads();context.state.generation++;
 const current=context.refreshThreads();assert.equal(reads.length,4);reads[2].resolve();await old;
 assert.equal(context.refreshThreads({changed:false}),current,'old finally cannot clear the new reader');
 reads[3].resolve();await current;
});

test('current conversation restores while sidebar requests are still waiting',async()=>{
 const threads=deferred(),projects=deferred(),calls=[];
 const context=vm.createContext({document:{hidden:false},state:{connected:true,threadId:'t',page:'chat',historyErrors:new Map(),historyLoading:new Set()},
  refreshThreads:()=>threads.promise,refreshProjects:()=>projects.promise,loadThread:async id=>calls.push(id),scheduleDesktopRefresh:()=>{}});
 const start=source.indexOf('async function refreshDesktop(){'),end=source.indexOf('const desktopPair=',start);
 assert(start>=0&&end>start);vm.runInContext('let refreshingDesktop=false,desktopRefreshTimer=null;'+source.slice(start,end),context);
 const work=context.refreshDesktop();await tick();assert.deepEqual(calls,['t']);
 threads.resolve();projects.resolve();await work;
});

function connectionFixture(){
 const history=deferred(),auxiliary=deferred(),calls=[];
 const context=vm.createContext({state:{generation:0,token:'token',threadId:'t',hydrating:new Map(),historyLoading:new Set(),historyErrors:new Map()},
  clearTimeout,desktopRefreshTimer:null,outputImageGrants:new Map(),outputImageDimensions:new Map(),
  eventFocus:{reset(){}},cancelActivityReads:()=>{},cancelUpload:()=>{},closeFilePreviews:()=>{},updateConversationHistoryState:()=>{},
  updateConnection:()=>{},renderProjects:()=>{},safeWrite:()=>{},$:()=>({}),closeDialog:()=>{},
  api:async path=>path==='/health'?{ok:true,protocolVersion:1,minAndroidProtocolVersion:1}:{projects:[]},
  connectSocket:async()=>{context.state.connected=true;},
  loadThread:id=>{calls.push('history:'+id);return history.promise;},
  recoverLocalSubmission:async()=>{calls.push('receipt');},
  refreshProjects:()=>{calls.push('projects');return auxiliary.promise;},refreshThreads:()=>auxiliary.promise,
  loadSettings:()=>auxiliary.promise,refreshTerminals:()=>auxiliary.promise,refreshApprovals:()=>auxiliary.promise});
 const start=source.indexOf('async function connect(token ='),end=source.indexOf('function connectSocket(',start);
 const cancelStart=source.indexOf('function cancelHistoryReads()'),cancelEnd=source.indexOf('async function loadThread(',cancelStart);
 assert(start>=0&&end>start&&cancelStart>=0&&cancelEnd>cancelStart);vm.runInContext(source.slice(cancelStart,cancelEnd)+source.slice(start,end),context);
 return {context,history,auxiliary,calls};
}

test('socket connection restores history and receipts before auxiliary reads finish',async()=>{
 const {context,history,auxiliary,calls}=connectionFixture();
 const old=new AbortController();context.state.historyReads=new Map([['old',{controller:old}]]);context.state.hydrating.set('old',[]);
 let finished=false;const work=context.connect().then(()=>{finished=true;});await tick();
 assert.equal(old.signal.aborted,true);assert.equal(context.state.historyReads.size,0);assert.equal(context.state.hydrating.size,0);
 assert.equal(context.state.connected,true);assert.equal(context.state.connecting,false);
 assert.deepEqual(calls,['history:t','projects']);
 history.resolve();await tick();assert.equal(calls.at(-1),'receipt');assert.equal(finished,false);
 auxiliary.resolve();await work;
});

test('conversation history failure keeps the socket connected and still checks the receipt',async()=>{
 const {context,history,auxiliary,calls}=connectionFixture();
 const work=context.connect();await tick();
 history.reject(Error('history timeout'));await tick();
 assert.equal(context.state.connected,true);assert.equal(calls.at(-1),'receipt');
 auxiliary.resolve();await work;assert.equal(context.state.connected,true);
});

test('an old connection cannot start receipt recovery after its history completes',async()=>{
 const {context,history,auxiliary,calls}=connectionFixture();
 const work=context.connect();await tick();context.state.generation++;
 history.resolve();await tick();assert.equal(calls.includes('receipt'),false);
 auxiliary.resolve();await work;
});

function modelFixture(){
 const nodes=new Map(),listeners=new Map(),stored=new Map(),catalog=deferred();let controls=0,renders=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',options:[],addEventListener:(event,listener)=>listeners.set(id,listener)});return nodes.get(id);};
 const context=vm.createContext({clearTimeout,setTimeout,conversationGeneration:1,state:{threadId:'t',generation:1,selection:1,chatModelRevision:0,models:[],harness:'codex',
   hydrating:new Map(),historyCount:new Map(),historyMore:new Map(),historyErrors:new Map(),events:new Map(),threads:[],historyLoading:new Set()},
  $:node,safeWrite:(key,value)=>stored.set(key,value),api:async path=>path.startsWith('/api/models')?catalog.promise:{events:[],settings:{model:'desktop',effort:'high'}},
  fillChatEfforts:()=>{node('chatEffort').options=[{value:'low'},{value:'high'}];node('chatEffort').value='low';},
  fillModelChoices:()=>{node('chatModel').options=context.state.models.map(model=>({value:model.model}));node('chatModel').value='fallback';context.fillChatEfforts();},
  updateControls:()=>controls++,renderConversation:()=>{renders++;context.conversationGeneration=context.state.generation;},updateConversationHistoryState:()=>{},restoreActivityDetails:events=>events,retainCompaction:(_old,events)=>events,
  focusEventStream:()=>null,mergeEvents:events=>events,conversationThreadKey:()=>'',sameConversationEvents:()=>true,refreshQueue:async()=>{},errorMessage:error=>error.message});
 const helperStart=source.indexOf('const desktopModelSettings=new Map();'),helperEnd=source.indexOf('function sameConversationEvents(',helperStart);
 const historyStart=source.indexOf('async function readThreadHistory('),historyEnd=source.indexOf('async function loadOlderMessages()',historyStart);
 const catalogStart=source.indexOf('async function loadModels()'),catalogEnd=source.indexOf('function fillModelChoices(',catalogStart);
 const listenersStart=source.indexOf("$('chatModel').addEventListener('change'"),listenersEnd=source.indexOf('function fillEfforts()',listenersStart);
 assert(helperStart>=0&&helperEnd>helperStart&&historyStart>=0&&historyEnd>historyStart&&catalogStart>=0&&catalogEnd>catalogStart&&listenersStart>=0&&listenersEnd>listenersStart);
 vm.runInContext(source.slice(helperStart,helperEnd)+source.slice(historyStart,historyEnd)+source.slice(catalogStart,catalogEnd)+source.slice(listenersStart,listenersEnd),context);
 return {context,node,listeners,stored,controls:()=>controls,renders:()=>renders,releaseCatalog:()=>catalog.resolve({models:[{model:'fallback'},{model:'desktop'}]})};
}

test('unchanged history replaces old connection components once, then resumes skipping unchanged polls',async()=>{
 const {context,renders}=modelFixture();context.conversationGeneration=0;
 await context.readThreadHistory('t');assert.equal(renders(),1,'a new connection must replace components owned by the previous generation');
 await context.readThreadHistory('t');assert.equal(renders(),1,'same-connection polls still preserve the mounted conversation');
 context.state.generation++;await context.readThreadHistory('t');assert.equal(renders(),2);
});

test('history settings wait for the model catalog and controls update as soon as it arrives',async()=>{
 const {context,node,stored,controls,releaseCatalog}=modelFixture();
 const loading=context.loadModels();await context.readThreadHistory('t');
 assert.equal(node('chatModel').value,'');assert.equal(controls(),0);
 releaseCatalog();await loading;
 assert.equal(node('chatModel').value,'desktop');assert.equal(node('chatEffort').value,'high');
 assert.equal(stored.get('cmc.threadModel.t'),'desktop');assert.equal(controls(),1);
});

test('late model catalogs preserve manual model or effort changes',async()=>{
 for(const id of ['chatModel','chatEffort']){
  const {context,node,listeners,stored,releaseCatalog}=modelFixture();
  const loading=context.loadModels();await context.readThreadHistory('t');
  node('chatModel').value='fallback';node('chatEffort').value='low';listeners.get(id)();
  assert.equal(context.state.chatModelRevision,1);
  releaseCatalog();await loading;
  assert.equal(node('chatModel').value,'fallback');assert.equal(node('chatEffort').value,'low');
  assert.notEqual(stored.get('cmc.threadModel.t'),'desktop');
  await context.readThreadHistory('t');assert.equal(node('chatModel').value,'fallback','unchanged server settings cannot overwrite manual choice on polling');
 }
});

test('pending model settings cannot cross a connection or conversation selection',async()=>{
 for(const field of ['generation','selection']){
  const {context,node,releaseCatalog}=modelFixture();
  await context.readThreadHistory('t');context.state[field]++;
  const loading=context.loadModels();releaseCatalog();await loading;
  assert.equal(node('chatModel').value,'fallback');assert.equal(node('chatEffort').value,'low');
 }
});

function projectFixture(){
 const project={id:'p',name:'项目',path:'F:/project',trusted:true};
 const reads=[],renders=[],notices=[];
 const context=vm.createContext({state:{generation:1,projects:[project],sidebarProjects:[project],threadId:'',chatProject:'p'},
  api:path=>{const read=deferred();reads.push({path,...read});return read.promise;},
  renderProjects:()=>renders.push({projects:context.state.projects,sidebar:context.state.sidebarProjects,selected:context.state.chatProject}),
  activeThread:()=>({projectPath:'F:/project'}),comparablePath:path=>path?.toLowerCase(),errorMessage:error=>error.message,
  toast:message=>notices.push(message)});
 const start=source.indexOf('let projectListRead=null;'),end=source.indexOf('function renderProjects()',start);
 const equalityStart=source.indexOf('function sameConversationData('),equalityEnd=source.indexOf('let conversationThread =',equalityStart);
 assert(start>=0&&end>start&&equalityStart>=0&&equalityEnd>equalityStart);
 vm.runInContext(source.slice(equalityStart,equalityEnd)+source.slice(start,end),context);
 const resolve=(offset,projects=[project],sidebar=projects)=>{
  reads[offset].resolve({projects:structuredClone(projects)});reads[offset+1].resolve({projects:structuredClone(sidebar)});
 };
 return {context,project,reads,renders,notices,resolve};
}

test('unchanged project polls preserve existing picker data while real changes still render',async()=>{
 const {context,project,renders,resolve}=projectFixture();
 const previousProjects=context.state.projects,previousSidebar=context.state.sidebarProjects;
 const poll=context.refreshProjects({changed:false});
 // Property insertion order alone is not a changed project.
 resolve(0,[{trusted:true,path:project.path,name:project.name,id:project.id}]);await poll;
 assert.equal(renders.length,0,'an unchanged poll must not rebuild open pickers');
 assert.equal(context.state.projects,previousProjects);assert.equal(context.state.sidebarProjects,previousSidebar);
 const rename=context.refreshProjects({changed:false});resolve(2,[{...project,name:'新名称'}]);await rename;
 assert.equal(renders.length,1);assert.equal(context.state.projects[0].name,'新名称');
 context.state.threadId='t';context.state.chatProject='';
 const bind=context.refreshProjects({changed:false});resolve(4,[{...project,name:'新名称'}]);await bind;
 assert.equal(context.state.chatProject,'p');assert.equal(renders.length,2,'binding the active conversation still updates project controls');
});

test('project polling shares requests, queues one mutation refresh and isolates old connections',async()=>{
 const {context,reads,resolve}=projectFixture();
 const first=context.refreshProjects({changed:false});
 assert.equal(context.refreshProjects({changed:false}),first);assert.equal(reads.length,2);
 context.refreshProjects();context.refreshProjects();resolve(0);await tick();
 assert.equal(reads.length,4,'mutations need one follow-up pair, not a request per caller');resolve(2);await first;
 const old=context.refreshProjects({changed:false});context.state.generation++;
 const current=context.refreshProjects({changed:false});assert.equal(reads.length,8);
 resolve(4,[]);await old;assert.equal(context.state.projects.length,1,'old responses cannot replace the new connection state');
 assert.equal(context.refreshProjects({changed:false}),current,'old cleanup cannot clear a newer shared request');
 resolve(6);await current;
});

test('project removal invalidates an in-flight poll and a failed sidebar keeps authorized projects',async()=>{
 const {context,reads,renders,notices,resolve}=projectFixture();
 const first=context.refreshProjects({changed:false});
 context.state.projectsRequest++;context.state.projects=[];context.state.sidebarProjects=[];
 context.refreshProjects();resolve(0);await tick();
 assert.equal(context.state.projects.length,0,'the pre-removal snapshot must stay invalidated');
 resolve(2,[]);await first;assert.equal(renders.length,0);
 for(let attempt=0;attempt<2;attempt++){
  const work=context.refreshProjects({changed:false}),offset=4+attempt*2;
  reads[offset].resolve({projects:[{id:'allowed',name:'授权项目',path:'F:/allowed',trusted:true}]});
  reads[offset+1].reject(Error('sidebar timeout'));await work;
 }
 assert.equal(context.state.sidebarProjects[0].id,'allowed');assert.equal(renders.length,1);
 assert.equal(notices.length,1,'identical optional errors should not repeat notifications');
});
