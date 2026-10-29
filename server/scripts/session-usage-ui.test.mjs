import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {displayThreadTitle,formatUsageTokens,sessionUsageValues} from '../public/console-core.js';
import {BoundedLruMap} from '../public/thread-cache.js';

test('session usage preserves missing values, uses wan and yi, and keeps context in K',()=>{
  assert.equal(formatUsageTokens(32000000),'3,200 万');assert.equal(formatUsageTokens(123456789),'1.23 亿');assert.equal(formatUsageTokens(0),'0');assert.equal(formatUsageTokens(null),'—');
  const values=sessionUsageValues({input:10000,output:2000,cached:2500,context:123456,contextWindow:256000});
  assert.equal(values.total,'1.2 万');assert.equal(values.cacheHit,'25%');assert.equal(values.context,'123.5K');assert.equal(values.contextWindow,'256K');
  assert.equal(sessionUsageValues(null).cacheHit,'—');assert.equal(sessionUsageValues({input:0,cached:0}).cacheHit,'—');assert.equal(sessionUsageValues({input:100,cached:200}).cacheHit,'—');
  assert.equal(sessionUsageValues({contextState:'awaiting_usage',context:10000}).context,'更新中');
});

// Run the shipped controller with a minimal DOM. These checks cover request
// ownership and data retention; they do not measure browser layout or motion.
const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
const start=source.indexOf('function showUsage(){'),end=source.indexOf("$('usageBtn').onclick",start);
assert(start>=0&&end>start);const controller=source.slice(start,end);
const sharedReader=source.slice(source.indexOf('const sessionUsageCache=new BoundedLruMap('),start);
class Node{
  constructor(tag,className='',text=''){this.tag=tag;this.className=className;this.textContent=text;this.children=[];this.events={};this.open=false;this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(type,callback){this.events[type]=callback;}
  showModal(){this.open=true;}
  close(){this.open=false;this.events.close?.();}
  remove(){this.removed=true;}
  focus(){}
}
const all=node=>[node,...node.children.flatMap(all)];
const metric=(dialog,label)=>all(dialog).find(node=>node.children[0]?.tag==='small'&&node.children[0].textContent===label)?.children[1].textContent;
async function until(check){for(let i=0;i<40;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('controller did not settle');}
function fixture(){
  const requests=[],context={state:{generation:1},openUsage:null,thread:{id:'first',title:'First'},URLSearchParams,setTimeout,clearTimeout,displayThreadTitle,sessionUsageValues,BoundedLruMap,document:{body:new Node('body')},errorMessage:error=>error.message,toast:()=>{},onlineRequired:()=>true};
  context.activeThread=()=>context.thread;context.el=(...args)=>new Node(...args);context.button=(label,callback,className)=>Object.assign(new Node('button',className,label),{onclick:callback});
  context.api=url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}));
  vm.createContext(context);vm.runInContext(sharedReader+'updateSessionStatus=()=>{};'+controller,context);
  return {context,requests};
}

test('session panel reads the selected thread and keeps its identity after selection changes',async()=>{
  const {context,requests}=fixture();context.showUsage();
  const owner=context.openUsage;assert.equal(new URL(requests[0].url,'http://fixture').searchParams.get('threadId'),'first');
  requests[0].resolve({tokens:{input:10000,output:2000,cached:2500}});await until(()=>metric(owner.dialog,'总 Token')==='1.2 万');
  assert.equal(metric(owner.dialog,'缓存命中率'),'25%');assert.equal(all(owner.dialog).find(node=>node.tag==='details').open,false);
  context.thread={id:'second'};const work=owner.reload();assert.equal(new URL(requests[1].url,'http://fixture').searchParams.get('threadId'),'first');
  requests[1].resolve({tokens:{total:15000}});await work;assert.equal(metric(owner.dialog,'总 Token'),'1.5 万');owner.dialog.close();
});

test('a closed session panel cannot update or clear a replacement panel',async()=>{
  const {context,requests}=fixture();context.showUsage();const first=context.openUsage;first.dialog.close();context.thread={id:'second'};context.showUsage();const second=context.openUsage;
  requests[0].resolve({tokens:{total:99999}});await new Promise(resolve=>setImmediate(resolve));assert.equal(context.openUsage,second);assert.equal(metric(second.dialog,'总 Token'),'—');
  requests[1].resolve({tokens:{total:200}});await until(()=>metric(second.dialog,'总 Token')==='200');assert.equal(second.id,'second');second.dialog.close();
});

test('usage refresh failure keeps the previous metrics and disclosure state',async()=>{
  const {context,requests}=fixture();context.showUsage();const owner=context.openUsage;
  requests[0].resolve({tokens:{total:10000}});await until(()=>metric(owner.dialog,'总 Token')==='1 万');
  const details=all(owner.dialog).find(node=>node.tag==='details');details.open=true;const work=owner.reload();requests[1].reject(Error('offline'));await work;
  assert.equal(metric(owner.dialog,'总 Token'),'1 万');assert.equal(details.open,true);assert.match(all(owner.dialog).find(node=>node.className==='session-usage-feedback').textContent,/已保留上次数据/);owner.dialog.close();
});

test('context badge and usage dialog share in-flight reads and a short cache',async()=>{
  const {context,requests}=fixture(),badge=context.readSessionUsage('first');context.showUsage();const owner=context.openUsage;
  assert.equal(requests.length,1);
  requests[0].resolve({tokens:{context:123000,total:10000},quotaTrend:new Array(50).fill('unused')});
  await badge;await until(()=>metric(owner.dialog,'总 Token')==='1 万');
  assert.equal(metric(owner.dialog,'当前上下文'),'123K');
  const cached=await context.readSessionUsage('first');assert.equal(requests.length,1);assert.equal(cached.quotaTrend,undefined);
  owner.dialog.close();
});

test('session panel separates parent and child accounting while retaining the family total',async()=>{
  const {context,requests}=fixture();context.showUsage();const owner=context.openUsage;
  requests[0].resolve({tokens:{total:15000,self:{total:10000},subagents:{count:1,total:5000,threads:[{threadId:'child',name:'审查员',total:5000}]}}});
  await until(()=>metric(owner.dialog,'总 Token')==='1.5 万');
  assert.equal(metric(owner.dialog,'主会话 Token'),'1 万');assert.equal(metric(owner.dialog,'子代理 Token'),'5,000');
  assert.equal(metric(owner.dialog,'审查员'),'5,000');owner.dialog.close();
});

test('usage invalidation during a read prevents that snapshot from satisfying the next refresh',async()=>{
  const {context,requests}=fixture(),first=context.readSessionUsage('first');
  vm.runInContext("sessionUsageVersions.set('first',1)",context);
  requests[0].resolve({tokens:{context:1000}});await first;
  const refreshed=context.readSessionUsage('first');assert.equal(requests.length,2);
  requests[1].resolve({tokens:{context:2000}});assert.equal((await refreshed).tokens.context,2000);
});

test('an old connection cannot fill the current usage cache',async()=>{
  const {context,requests}=fixture(),old=context.readSessionUsage('first'),rejected=assert.rejects(old,/连接已改变/);
  context.state.generation++;const current=context.readSessionUsage('first');assert.equal(requests.length,2);
  requests[0].resolve({tokens:{context:999999}});await rejected;
  requests[1].resolve({tokens:{context:3000}});await current;
  assert.equal((await context.readSessionUsage('first')).tokens.context,3000);assert.equal(requests.length,2);
});
