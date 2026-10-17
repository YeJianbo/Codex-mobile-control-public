import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {activityEntries,activitySummary} from '../public/console-core.js';

const source=fs.readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
class Node {
  constructor(tag='div',classes='',text=''){this.tagName=tag.toUpperCase();this.classes=classes.split(' ');this.children=[];this.dataset={};this.parentElement=null;this.open=false;this.root=false;this.listeners=new Map();this.text=text||'';this.classList={toggle(){}};}
  get isConnected(){return this.root||Boolean(this.parentElement?.isConnected);}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set textContent(text){this.text=String(text);for(const child of [...this.children])child.remove();}
  append(...nodes){for(const node of nodes){if(node.tagName==='#FRAGMENT'){this.append(...[...node.children]);continue;}node.remove();this.children.push(node);node.parentElement=this;}}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null;}}
  replaceChildren(...nodes){this.text='';for(const child of [...this.children])child.remove();this.append(...nodes);}
  setAttribute(){}
  addEventListener(type,callback){let set=this.listeners.get(type);if(!set)this.listeners.set(type,set=new Set());set.add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  toggle(open){this.open=open;for(const callback of [...this.listeners.get('toggle')||[]])callback({target:this});}
  closest(selector){for(let node=this;node;node=node.parentElement)if(selector==='details'&&node.tagName==='DETAILS')return node;return null;}
  query(selector){const result=[];for(const child of this.children){if(selector.startsWith('.')?child.classes.includes(selector.slice(1)):child.tagName===selector.toUpperCase())result.push(child);result.push(...child.query(selector));}return result;}
}
function fixture(){
  const outer=new Node('details');outer.root=true;outer.open=true;const host=new Node();outer.append(host);let paints=0,requests=0,release;
  const expanded=new Map([['group',true]]);
  const context=vm.createContext({state:{threadId:'t',generation:1,chatProject:'p',approvals:[],events:new Map()},
    activityEntries,activitySummary,conversationCache:new Map(),outgoingMessageKeys:new Map(),approvalFeedback:new Map(),running:true,
    el:(tag,classes,text)=>new Node(tag,classes,text),document:{createDocumentFragment:()=>new Node('#fragment')},
    button:(text)=>new Node('button','',text),diffCode:text=>{paints++;return new Node('pre','',text);},markdownNode:text=>new Node('div','',text),
    errorMessage:error=>error.message,
    readActivityEvents:()=>{requests++;return new Promise(resolve=>{release=resolve;});}});
  vm.runInContext(section('function userMessageSignature(','let conversationThread =')+
    section('function operationActivityNode(','let goalClockKey='),context);
  context.createBlock=event=>context.createActivityGroup(event,expanded);
  const loop=section('  const knownKeys=new Set(conversationCache.keys());','  if (pending&&!pending.goal)');
  vm.runInContext('globalThis.renderBlocks=()=>{'+loop+'conversationCache=nextCache;return nodes;};',context);
  return {context,host,outer,paints:()=>paints,requests:()=>requests,release:events=>release(events),render:activities=>{
    context.blocks=[{type:'activity.group',threadId:'t',eventId:'group',activities}];
    const [node]=context.renderBlocks();if(host.children[0]!==node)host.replaceChildren(node);return node;
  }};
}
const operation=(id,diff='+++ b/file.ts\n@@\n+'+id)=>({type:'tool.completed',threadId:'t',eventId:id,itemId:id,title:'apply_patch',status:'ok',diff});

test('appending operations keeps the open node and its loaded text, including while the group is closed',()=>{
  const f=fixture(),one=operation('one'),group=f.render([one]),detail=group.query('.tool-entry')[0];
  assert.equal(f.paints(),0);detail.toggle(true);const body=detail.query('pre')[0];assert(body);assert.equal(f.paints(),1);
  assert.equal(f.render([one,operation('two')]),group);assert.equal(group.query('.tool-entry')[0],detail);assert.equal(detail.query('pre')[0],body);
  assert.equal(f.paints(),1,'unchanged open output must not be constructed again');
  group.toggle(false);f.render([one,operation('two'),operation('three')]);assert.equal(group.query('.tool-entry').length,2);
  group.toggle(true);assert.equal(group.query('.tool-entry').length,3);assert.equal(detail.query('pre')[0],body);assert.equal(f.paints(),1);
});

test('real changes to an existing operation still replace its displayed content',()=>{
  const f=fixture(),one=operation('one'),group=f.render([one]);group.query('.tool-entry')[0].toggle(true);
  const replacement=f.render([operation('one','+++ b/file.ts\n@@\n+updated'),operation('two')]);
  assert.notEqual(replacement,group);assert.match(replacement.query('pre')[0].textContent,/updated/);assert.equal(f.paints(),2);
});

test('a closed outer process coalesces additions until every disclosure is open',()=>{
  const f=fixture(),one=operation('one'),group=f.render([one]);group.query('.tool-entry')[0].toggle(true);
  f.outer.toggle(false);
  f.render([one,operation('two')]);f.render([one,operation('two'),operation('three')]);
  assert.equal(group.query('.tool-entry').length,1,'an open inner group must not populate inside a closed process');
  assert.equal(f.outer.listeners.get('toggle').size,1,'hidden updates share one visibility wait');
  group.toggle(false);f.outer.toggle(true);assert.equal(group.query('.tool-entry').length,1);
  group.toggle(true);assert.equal(group.query('.tool-entry').length,3);assert.equal(f.paints(),1);
  assert.equal(f.outer.listeners.get('toggle').size,0);
});

test('a deferred body already displayed is retained when the next update includes its loaded data',async()=>{
  const f=fixture(),header={...operation('one'),diff:'',detailsDeferred:true},loaded={...operation('one'),detailsDeferred:false};
  const group=f.render([header]),detail=group.query('.tool-entry')[0];detail.toggle(true);
  assert.equal(f.requests(),1);f.release([loaded]);await new Promise(resolve=>setImmediate(resolve));
  const body=detail.query('pre')[0];assert(body);
  assert.equal(f.render([loaded,operation('two')]),group);assert.equal(detail.query('pre')[0],body);assert.equal(f.paints(),1);assert.equal(f.requests(),1);
  f.context.state.generation++;assert.notEqual(f.render([loaded,operation('two')]),group,'a replacement connection cannot reuse the old group');
});
