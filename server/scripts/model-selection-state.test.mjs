import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);}
const code=section('async function loadModels()','function fillModelChoices(')+section('function fillModelChoices(','function fillChatEfforts(')+section('function fillChatEfforts(',"$('chatModel').addEventListener")+section('async function loadSettings(','const settingsFields =');
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
 const state={generation:1,threadId,harness:'codex',connected:true,models:catalog,backends:[{agent:'codex',available:true}],settings:{model:'gpt-6-astra',reasoningEffort:'high'},settingsLoaded:false};
 const context={state,Option,JSON,$:id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:''});return nodes.get(id);},safeRead:key=>memory.get(key)||'',fillEfforts(){},fillSettings(){},updateBackendNotice(){},updateControls(){},refreshCodex:async()=>{},errorMessage:error=>error.message};
 context.api=async path=>path.startsWith('/api/models')?{models:structuredClone(models),backends:[{agent:'codex',available:true}]}:path==='/api/settings/user'?{settings:{model:'gpt-6-astra',reasoningEffort:'high'}}:path==='/api/settings/user/raw'?{config:{path:'fixture',content:''}}:path==='/api/settings/approval-summary'?{summary:{summary:''}}:{enabled:false};
 vm.createContext(context);vm.runInContext(code,context);context.fillModelChoices('gpt-6.1-sol');return {context,state,nodes,memory};
}

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
 assert.equal(state.models.length,0);assert.equal(nodes.get('chatModel').disabled,true);assert.equal(nodes.get('chatModel').options[0].textContent,'模型列表加载失败');
});
