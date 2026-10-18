import {renderModelChoices,renderModelEfforts} from '../public/model-controls.js';
import {createSettingsController} from '../public/settings-controller.js';
import {modelHarness} from '../public/model-identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);}
const code=section('async function loadModels()','function fillModelChoices(')+section('function fillModelChoices(','function fillChatEfforts(')+section('function fillChatEfforts(',"$('chatModel').addEventListener");
const models=[
 {model:'gpt-6.1-sol',displayName:'Sol',defaultReasoningEffort:'high',supportedReasoningEfforts:['low','high','xhigh'].map(reasoningEffort=>({reasoningEffort}))},
 {model:'gpt-6-astra',displayName:'Astra',defaultReasoningEffort:'medium',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))},
];
class Option{constructor(text,value){this.textContent=text;this.value=value;this.dataset={};this.disabled=false;}}
class Select{
 constructor(){this.options=[];this.dataset={};this.disabled=false;this._value='';}
 get value(){return this._value;}
 set value(value){this._value=this.options.some(option=>option.value===value)?value:'';}
 replaceChildren(...options){this.options=options;this._value=options[0]?.value||'';}
 prepend(option){this.options.unshift(option);}
 add(option){this.options.push(option);if(this.options.length===1)this._value=option.value;}
}
function fixture({threadId='thread-one',catalog=structuredClone(models)}={}){
 const nodes=new Map(['chatModel','chatEffort','settingModel'].map(id=>[id,new Select()])),memory=new Map([['cmc.effort.gpt-6.1-sol','high']]);
 const timers=[];
 const state={generation:1,threadId,harness:'codex',connected:true,models:catalog,backends:[{agent:'codex',available:true}],settings:{model:'gpt-6-astra',reasoningEffort:'high'},settingsLoaded:false};
 const context={renderModelChoices,renderModelEfforts,modelHarness,clearTimeout:timer=>{if(timer)timer.cancelled=true;},setTimeout:(action,delay)=>{const timer={action,delay,cancelled:false};timers.push(timer);return timer;},state,Option,JSON,$:id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',replaceChildren(){}});return nodes.get(id);},safeRead:key=>memory.get(key)||'',fillEfforts(){},updateBackendNotice(){},syncDesktopModelSettings(){return false;},updateControls(){},refreshCodex:async()=>{},errorMessage:error=>error.message};
 context.api=async path=>path.startsWith('/api/models')?{models:structuredClone(models),backends:[{agent:'codex',available:true}]}:path==='/api/settings/user'?{settings:{model:'gpt-6-astra',reasoningEffort:'high'}}:path==='/api/settings/user/raw'?{config:{path:'fixture',content:''}}:path==='/api/settings/approval-summary'?{summary:{summary:''}}:{enabled:false};
 vm.createContext(context);vm.runInContext(code,context);
 Object.assign(context,createSettingsController({...context,api:(...args)=>context.api(...args)}));
 context.fillModelChoices('gpt-6.1-sol');return {context,state,nodes,memory,timers};
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('transient and empty catalog failures preserve the usable catalog and current controls',async()=>{
 const {context,state,nodes}=fixture(),catalog=state.models,backends=state.backends,options=nodes.get('chatModel').options;nodes.get('chatEffort').value='xhigh';
 context.api=async()=>{throw Error('models timeout');};await assert.rejects(()=>context.loadModels(),/timeout/);
 assert.equal(state.models,catalog);assert.equal(state.backends,backends);assert.equal(nodes.get('chatModel').options,options);assert.equal(nodes.get('chatModel').disabled,false);assert.equal(nodes.get('chatEffort').value,'xhigh');
 context.api=async()=>({models:[]});await assert.rejects(()=>context.loadModels(),/可选模型/);assert.equal(state.models,catalog);assert.equal(nodes.get('chatModel').value,'gpt-6.1-sol');
});

test('catalog refresh keeps the current thread effort while a different thread or model chooses its own setting',async()=>{
 const {context,state,nodes}=fixture();nodes.get('chatEffort').value='xhigh';await context.loadModels();assert.equal(nodes.get('chatEffort').value,'xhigh');
 state.threadId='thread-two';context.fillModelChoices();assert.equal(nodes.get('chatEffort').value,'high');
 nodes.get('chatModel').value='gpt-6-astra';context.fillChatEfforts();assert.equal(nodes.get('chatEffort').value,'medium');
});

test('reading global settings cannot replace an existing conversation model',async()=>{
 const existing=fixture();existing.nodes.get('chatEffort').value='xhigh';await existing.context.loadSettings();
 assert.equal(existing.nodes.get('chatModel').value,'gpt-6.1-sol');assert.equal(existing.nodes.get('chatEffort').value,'xhigh');
 const fresh=fixture({threadId:''});await fresh.context.loadSettings();assert.equal(fresh.nodes.get('chatModel').value,'gpt-6-astra');
});

test('first-load failure remains explicit when no usable catalog has been read',async()=>{
 const {context,state,nodes}=fixture({catalog:[]});context.api=async()=>{throw Error('offline');};await assert.rejects(()=>context.loadModels(),/offline/);
 assert.equal(state.models.length,0);assert.equal(nodes.get('chatModel').disabled,true);assert.equal(nodes.get('chatModel').options[0].textContent,'模型读取失败，请刷新');
});

test('partial catalogs retain pending harness models and backend availability until their result arrives',async()=>{
 const claude={model:'claude::held',displayName:'Held',supportedReasoningEfforts:[]};
 const {context,state,timers}=fixture({catalog:[...structuredClone(models),claude,{model:'grok::gone',displayName:'Gone'}]});
 const pendingBackend={agent:'claude',available:true,supportsImages:false};state.backends.push(pendingBackend);
 context.api=async()=>({models:structuredClone(models),pending:['claude'],backends:[{agent:'codex',available:true},{agent:'claude',available:false}]});
 await context.loadModels();
 assert.deepEqual(Array.from(state.models,row=>row.model),['gpt-6.1-sol','gpt-6-astra','claude::held']);
 assert.equal(state.backends.find(row=>row.agent==='claude'),pendingBackend);assert.deepEqual(state.modelPending,['claude']);assert.equal(timers.length,1);assert.equal(timers[0].delay,600);
});

test('a completed catalog poll preserves model and effort selected during partial loading',async()=>{
 const {context,state,nodes,timers}=fixture();let reads=0;
 context.api=async()=>++reads===1?{models:[],pending:['codex'],backends:[{agent:'codex',available:false}]}:{models:structuredClone(models),pending:[],backends:[{agent:'codex',available:true}]};
 await context.loadModels();nodes.get('chatModel').value='gpt-6-astra';context.fillChatEfforts();nodes.get('chatEffort').value='high';
 timers[0].action();await flush();
 assert.equal(reads,2);assert.equal(nodes.get('chatModel').value,'gpt-6-astra');assert.equal(nodes.get('chatEffort').value,'high');assert.deepEqual(state.modelPending,[]);assert.equal(timers.length,1);
});

test('a changed connection retires scheduled polls and ignores an in-flight partial catalog reply',async()=>{
 const {context,state,timers}=fixture();let reads=0,release;
 context.api=async()=>{reads++;if(reads===1)return {models:[],pending:['codex'],backends:[]};return new Promise(resolve=>{release=resolve;});};
 await context.loadModels();const oldTimer=timers[0];oldTimer.action();await flush();assert.equal(reads,2);
 state.generation++;context.api=async()=>({models:structuredClone(models),pending:[],backends:[{agent:'codex',available:true}]});
 await context.loadModels();const currentModels=state.models;assert.equal(oldTimer.cancelled,true);
 release({models:[{model:'obsolete',displayName:'Obsolete'}],pending:[],backends:[]});await flush();
 assert.equal(state.models,currentModels);assert.equal(state.backends[0].agent,'codex');
 oldTimer.action();await flush();assert.equal(reads,2);
});

test('a failed completion poll ends loading, preserves usable choices and clears its error after recovery',async()=>{
 const {context,state,nodes,timers}=fixture();let reads=0;
 context.api=async()=>{if(++reads===1)return {models:structuredClone(models),pending:['claude'],backends:[{agent:'codex',available:true}]};throw Error('poll timeout');};
 await context.loadModels();nodes.get('chatEffort').value='xhigh';
 const catalog=state.models,options=nodes.get('chatModel').options;
 timers[0].action();await flush();
 assert.equal(state.modelPending.length,0);assert.equal(state.modelLoadFailed,true);assert.equal(state.modelsTimer,null);assert.equal(timers.length,1);
 assert.equal(state.models,catalog);assert.equal(nodes.get('chatModel').options,options);assert.equal(nodes.get('chatModel').value,'gpt-6.1-sol');assert.equal(nodes.get('chatEffort').value,'xhigh');
 state.harness='claude';context.fillModelChoices();
 assert.equal(nodes.get('chatModel').disabled,true);assert.equal(nodes.get('chatModel').options[0].textContent,'模型读取失败，请刷新');
 const claude={model:'claude::recovered',displayName:'Recovered',supportedReasoningEfforts:[]};
 context.api=async()=>({models:[...structuredClone(models),claude],pending:[],backends:[{agent:'codex',available:true},{agent:'claude',available:true}]});
 await context.loadModels();assert.equal(state.modelLoadFailed,false);assert.equal(nodes.get('chatModel').disabled,false);assert.equal(nodes.get('chatModel').value,claude.model);
 let rejectOld;context.api=()=>new Promise((_,reject)=>{rejectOld=reject;});const stale=context.loadModels();
 state.generation++;state.modelPending=['new-connection'];rejectOld(Error('retired failure'));await stale;
 assert.equal(state.modelLoadFailed,false);assert.deepEqual(state.modelPending,['new-connection']);assert.equal(nodes.get('chatModel').value,claude.model);
});
