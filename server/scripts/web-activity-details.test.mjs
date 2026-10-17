import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {restoreActivityDetails} from '../public/console-core.js';

async function fileSummaryCode(){
  const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
  const start=source.indexOf('      const changes=new Map();'),end=source.indexOf('      if(!changes.size)',start);
  const opening=source.indexOf('      lazyActivityDetails(card,expanded,content=>{',end);
  const openedStart=source.indexOf('        for(const item of event.activities){',opening),openedEnd=source.indexOf('        updateSummary();',openedStart);
  assert(start>=0&&end>start&&opening>end&&openedStart>opening&&openedEnd>openedStart);
  return {closed:source.slice(start,end),opened:source.slice(openedStart,openedEnd)};
}

test('file cards and their file list reuse metadata without reading cached patch bodies',async()=>{
  const code=await fileSummaryCode();let reads=0;
  const diff=()=>{reads++;return '+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';};
  const context=vm.createContext({event:{activities:[
    {type:'file.changed',fileChanges:[{path:'a.ts',added:2,removed:1}],files:['declared.ts'],get diff(){return diff();}},
    {type:'tool.completed',fileChanges:[{path:'a.ts',removed:9}],get diff(){return diff();}},
  ]}});
  const changes=vm.runInContext(code.closed+code.opened+'changes;',context);
  assert.equal(reads,0,'Metadata-backed file summaries must not rescan raw patches');
  assert.deepEqual(Array.from(changes.values(),file=>({...file})),[{path:'a.ts',added:2,removed:9},{path:'declared.ts'}]);
});

test('legacy file cards defer counts until opening and recognize Windows and CR line endings',async()=>{
  const code=await fileSummaryCode();
  for(const ending of ['\n','\r\n','\r']){
    const diff=['--- a/legacy.ts','+++ b/legacy.ts','@@ -1 +1,2 @@','-old','+new','+second','+++ /dev/null'].join(ending);
    const context=vm.createContext({event:{activities:[{type:'diff.updated',diff}]}});
    let changes=vm.runInContext(code.closed+'changes;',context);
    assert.deepEqual(Array.from(changes.values(),file=>({...file})),[{path:'legacy.ts'}]);
    changes=vm.runInContext(code.opened+'changes;',context);
    assert.deepEqual(Array.from(changes.values(),file=>({...file})),[{path:'legacy.ts',added:2,removed:1}],JSON.stringify(ending));
  }
});

test('selecting a file does not search patch bodies with known file metadata',async()=>{
  const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
  const start=source.indexOf('            const related=event.activities.filter('),end=source.indexOf(';\n',start);
  assert(start>=0&&end>start);let reads=0;
  const context=vm.createContext({file:{path:'b.ts'},event:{activities:[
    {id:'unrelated',fileChanges:[{path:'a.ts'}],get diff(){reads++;return '+++ b/a.ts\n@@\n+import b.ts';}},
    {id:'selected',fileChanges:[{path:'b.ts'}],get diff(){reads++;return '+++ b/b.ts';}},
    {id:'declared',files:['b.ts'],get diff(){reads++;return '+++ b/b.ts';}},
    {id:'legacy',get diff(){reads++;return '+++ b/b.ts';}},
  ]}});
  const result=vm.runInContext(source.slice(start,end+1)+'related;',context);
  assert.equal(reads,1,'Only the legacy source without metadata needs a body search');
  assert.deepEqual(Array.from(result,event=>event.id),['selected','declared','legacy']);
});

test('Web detail readers share requests, chunk IDs and reuse the existing conversation cache',async()=>{
  const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
  const start=source.indexOf('const activityReads=new Map();'),end=source.indexOf('function operationActivityDetails(',start);
  assert(start>=0&&end>start);
  const headers=Array.from({length:101},(_,i)=>({type:'tool.output',threadId:'t',eventId:`e${i}`,itemId:'operation',detailsDeferred:true}));
  const state={generation:1,events:new Map([['t',headers]])},calls=[];
  let release;
  const context=vm.createContext({state,restoreActivityDetails,AbortController,DOMException,
    api:(url,{signal})=>{
      const ids=JSON.parse(new URL(url,'http://localhost').searchParams.get('eventIds'));calls.push(ids);
      return new Promise((resolve,reject)=>{release=()=>resolve({events:ids.map(id=>({...headers.find(e=>e.eventId===id),detailsDeferred:false,text:'body-'+id}))});signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
    }});
  vm.runInContext(source.slice(start,end),context);
  const first=context.readActivityEvents('t',headers),second=context.readActivityEvents('t',headers);
  assert.equal(calls.length,1);assert.equal(calls[0].length,100);release();
  for(let i=0;i<20&&calls.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);assert.deepEqual(Array.from(calls[1]),['e100']);release();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a.length,101);assert.equal(b.at(-1).text,'body-e100');
  assert.equal((await context.readActivityEvents('t',headers)).length,101);assert.equal(calls.length,2);
  const refreshed=restoreActivityDetails(headers,state.events.get('t'));assert(refreshed.every(e=>!e.detailsDeferred));
  const pendingHeader={...headers[0],eventId:'late'};state.events.set('t',[pendingHeader]);
  const pending=context.readActivityEvents('t',[pendingHeader]);
  const rejected=assert.rejects(pending,{name:'AbortError'});context.cancelActivityReads();state.generation++;await rejected;
  assert.equal(state.events.get('t')[0].detailsDeferred,true,'a canceled reader cannot populate a replacement connection');
});

async function activitySelectionFixture({ignoreAbort=false}={}){
  const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
  const start=source.indexOf('const activityReads=new Map();'),end=source.indexOf('function operationActivityNode(',start);
  const selectionStart=source.indexOf('function setConversationSelection('),selectionEnd=source.indexOf('async function selectProject(',selectionStart);
  const newStart=source.indexOf('async function newThread()'),newEnd=source.indexOf('let lastEnteredThread=',newStart);
  assert(start>=0&&end>start&&selectionStart>=0&&selectionEnd>selectionStart&&newStart>=0&&newEnd>newStart);
  const headers=[{type:'tool.output',threadId:'t',eventId:'entry',detailsDeferred:true}];
  const state={generation:1,selection:0,threadId:'t',events:new Map([['t',headers]])},requests=[];
  const context=vm.createContext({state,restoreActivityDetails,AbortController,DOMException,
    cancelHistoryReads(){},focusEventStream:()=>null,onlineRequired:()=>true,storeDraft(){},fillModelChoices(){},restoreDraft(){},showPage(){},renderThreads(){},renderConversation(){},closeDrawer(){},$:()=>({focus(){}}),
    api:(url,{signal})=>{
      const ids=JSON.parse(new URL(url,'http://localhost').searchParams.get('eventIds'));
      const request={signal};requests.push(request);
      return new Promise((resolve,reject)=>{
        request.release=text=>resolve({events:ids.map(eventId=>({...headers[0],eventId,text,detailsDeferred:false}))});
        if(!ignoreAbort)signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
      });
    }});
  vm.runInContext(source.slice(selectionStart,selectionEnd)+source.slice(start,end)+source.slice(newStart,newEnd),context);
  return {context,state,headers,requests};
}

test('leaving a conversation cancels every shared detail reader without restarting the request',async()=>{
  const f=await activitySelectionFixture();
  const first=f.context.readActivityEvents('t',f.headers),second=f.context.readActivityEvents('t',f.headers);
  const rejected=[assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})];
  assert.equal(f.requests.length,1);await f.context.newThread();await Promise.all(rejected);
  assert.equal(f.state.threadId,'');assert.equal(f.state.selection,1);assert.equal(f.requests[0].signal.aborted,true);
  assert.equal(f.requests.length,1);assert.equal(f.state.events.get('t')[0].detailsDeferred,true);
});

test('selecting the same conversation retains its current detail request',async()=>{
  const f=await activitySelectionFixture();const work=f.context.readActivityEvents('t',f.headers);
  f.context.setConversationSelection('t');assert.equal(f.state.selection,1);assert.equal(f.requests[0].signal.aborted,false);
  f.requests[0].release('complete body');assert.equal((await work)[0].text,'complete body');assert.equal(f.requests.length,1);
});

test('late detail responses cannot populate or clear a newer visit to the same conversation',async()=>{
  const f=await activitySelectionFixture({ignoreAbort:true});
  const old=f.context.readActivityEvents('t',f.headers),waiter=f.context.readActivityEvents('t',f.headers);
  const rejected=[assert.rejects(old,{name:'AbortError'}),assert.rejects(waiter,{name:'AbortError'})];
  f.context.setConversationSelection('next');f.context.setConversationSelection('t');
  const current=f.context.readActivityEvents('t',f.headers);assert.equal(f.requests.length,2);
  f.requests[0].release('old body');await Promise.all(rejected);
  assert.equal(f.state.events.get('t')[0].detailsDeferred,true);
  const shared=f.context.readActivityEvents('t',f.headers);assert.equal(f.requests.length,2,'old finally must retain the new request');
  f.requests[1].release('current body');const results=await Promise.all([current,shared]);
  assert(results.every(events=>events[0].text==='current body'));assert.equal(f.requests.length,2);
});

async function pendingOperation(){
  const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
  const helper=source.indexOf('function renderActivityWhenOpen('),start=source.indexOf('function operationActivityDetails('),end=source.indexOf('function lazyActivityDetails(',start);
  assert(start>=0&&end>start);let release,fail,paints=0,requests=0;
  const response=new Promise((resolve,reject)=>{release=resolve;fail=reject;});
  const listeners=new Map();
  function detail(parent=null){
    const node={open:true,isConnected:true,parentElement:parent,dataset:{},
      closest:()=>node,addEventListener:(_type,listener)=>{let set=listeners.get(node);if(!set)listeners.set(node,set=new Set());set.add(listener);},
      removeEventListener:(_type,listener)=>listeners.get(node)?.delete(listener)};
    return node;
  }
  const outer=detail(),group=detail(outer),node=detail(group);
  const content=()=>({textContent:'',append(){},replaceChildren(){}});
  const context=vm.createContext({state:{generation:1},el:content,
    lazyActivityDetails:(node,_expanded,render)=>{render(content());return node;},
    readActivityEvents:()=>{requests++;return response;},
    activityEntries:()=>[{text:'+++ b/file.ts\n@@\n+new',diff:'+++ b/file.ts\n@@\n+new',title:'编辑文件'}],
    diffCode:()=>{paints++;return {};},markdownNode:()=>{paints++;return {};},button:()=>({}),errorMessage:error=>error.message});
  vm.runInContext((helper<0?'':source.slice(helper,start))+source.slice(start,end),context);
  context.operationActivityDetails(node,new Map(),{activities:[{detailsDeferred:true}]},'t');
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const toggle=detail=>{for(const listener of [...listeners.get(detail)||[]])listener({target:detail});};
  return {context,node,group,outer,release,fail,tick,toggle,paints:()=>paints,requests:()=>requests,
    listeners:()=>[...listeners.values()].reduce((sum,set)=>sum+set.size,0)};
}

test('late operation details wait for every collapsed ancestor before constructing patch content',async()=>{
  const f=await pendingOperation();f.outer.open=false;f.group.open=false;
  f.release([]);await f.tick();assert.equal(f.paints(),0,'collapsed parents must not build a late patch');
  f.outer.open=true;f.toggle(f.outer);assert.equal(f.paints(),0,'an inner closed group still owns visibility');
  f.group.open=true;f.toggle(f.group);assert.equal(f.paints(),1);assert.equal(f.requests(),1);
  f.toggle(f.node);assert.equal(f.paints(),1,'repeated toggles cannot rebuild the loaded content');
  assert.equal(f.listeners(),0,'visibility listeners are released after painting');
});

test('closing an operation defers its response and detached or replaced connections cannot paint it',async()=>{
  for(const stale of ['none','detached','connection']){
    const f=await pendingOperation();f.node.open=false;f.release([]);await f.tick();
    assert.equal(f.paints(),0);
    if(stale==='detached')f.node.isConnected=false;
    if(stale==='connection')f.context.state.generation++;
    f.node.open=true;f.toggle(f.node);
    assert.equal(f.paints(),stale==='none'?1:0,stale);assert.equal(f.listeners(),0);
  }
});
