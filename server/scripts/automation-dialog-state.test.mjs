import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {errorMessage,displayThreadTitle,displayPath} from '../public/console-core.js';

test('display formatting removes scheduled title markup and extended Windows prefixes only for display',()=>{
 assert.equal(displayThreadTitle('<heartbeat> <automation_id>task','任务'), '任务');
 assert.equal(displayThreadTitle('<heartbeat><instructions>检查内存\n细节</instructions></heartbeat>'),'检查内存');
 assert.equal(displayPath(String.raw`\\?\D:\project`),String.raw`D:\project`);
 assert.equal(displayPath(String.raw`\\?\UNC\server\share`),String.raw`\\server\share`);
});

// State/request checks of shipped code, with no browser layout claims.
const source=(await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`Missing shipped source section: ${start}`);return source.slice(a,b);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class Node{
  constructor(tag='div',className='',text=''){
    Object.assign(this,{tag,className,textContent:text||'',value:'',hidden:false,disabled:false,dataset:{},attributes:{},children:[],open:false,isConnected:false,parentNode:null,scrollTop:0,listeners:new Map()});
    const classes=new Set(className.split(' ').filter(Boolean));
    this.classList={toggle:(name,force)=>{if(force)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)};
  }
  connect(value){this.isConnected=value;for(const child of this.children)child.connect(value);}
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);node.connect(this.isConnected);}}
  prepend(...nodes){const rest=[...this.children];this.replaceChildren(...nodes,...rest);}
  replaceChildren(...nodes){for(const child of this.children){child.parentNode=null;child.connect(false);}this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.tag===selector?[child]:[]),...child.querySelectorAll(selector)]);}
  addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
  showModal(){this.open=true;}
  close(){this.open=false;for(const listener of this.listeners.get('close')||[])listener();}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;this.connect(false);}
  focus(){}
}
function fixture(){
  const nodes=[],buttons=new Map(),requests=[],state={threadId:'A',generation:1,threads:[{id:'A',title:'Session A'},{id:'B',title:'Session B'}]};
  const el=(tag,className,text)=>{const node=new Node(tag,className||'',text);nodes.push(node);return node;};
  const button=(label,action,className)=>{const node=el('button',className,label);node.type='button';node.onclick=action;const rows=buttons.get(label)||[];rows.push(node);buttons.set(label,rows);return node;};
  const body=new Node('body');body.connect(true);
  const context=vm.createContext({state,el,button,errorMessage,displayThreadTitle,displayPath,setTimeout,clearTimeout,document:{body,activeElement:null},onlineRequired:()=>true,run:action=>action(),toast(){},api:(path,options)=>{const response=deferred();requests.push({path,options,...response});return response.promise;}});
  const call=(name,...args)=>{context.__args=args;return vm.runInContext(`${name}(...__args)`,context);};
  const settle=(request,value,reject=false)=>{assert(request,'Expected an API request');request[reject?'reject':'resolve'](value);};
  return{nodes,buttons,requests,state,context,call,settle,dialog:()=>nodes.findLast(node=>node.tag==='dialog')};
}

function automationFixture(){
  const f=fixture();vm.runInContext(section('function sameConversationData(', 'let conversationThread = null;')+section('async function showAutomations(', 'function runEndLabel('),f.context);
  f.liveButton=label=>f.buttons.get(label)?.findLast(node=>node.isConnected);
  f.submit=()=>f.nodes.findLast(node=>node.tag==='form').onsubmit({preventDefault(){}});
  return f;
}
test('automation save retains failure drafts and commits creation without another list request',async()=>{
  const f=automationFixture(),open=f.call('showAutomations');f.settle(f.requests[0],{automations:[]});await open;
  f.state.threadId='B';f.liveButton('新建任务').onclick();
  const name=f.nodes.findLast(node=>node.attributes['aria-label']==='名称'),prompt=f.nodes.findLast(node=>node.tag==='textarea');name.value='任务一';prompt.value='任务内容';
  const save=f.nodes.findLast(node=>node.tag==='button'&&node.textContent==='保存'),first=f.submit();await f.submit();assert.equal(f.requests.length,2);assert(name.disabled);assert(f.liveButton('返回列表').disabled);
  let prevented=false;f.dialog().oncancel({preventDefault(){prevented=true;}});assert(prevented);
  f.settle(f.requests[1],Error('写入失败'),true);await first;assert(name.isConnected);assert.equal(name.value,'任务一');assert.equal(prompt.value,'任务内容');assert.equal(name.disabled,false);assert.equal(save.disabled,false);
  assert(f.nodes.some(node=>node.isConnected&&!node.hidden&&node.attributes.role==='alert'&&node.textContent.includes('写入失败')));
  const retry=f.submit();assert.equal(f.requests[2].options.body.threadId,'A');
  f.settle(f.requests[2],{automation:{id:'created',name:'任务一',prompt:'任务内容',status:'ACTIVE',rrule:'FREQ=MINUTELY;INTERVAL=5'}});await retry;
  assert.equal(f.requests.length,3);assert.equal(f.nodes.findLast(node=>node.className==='automation-editor').hidden,true);assert(f.liveButton('编辑'));assert.equal(f.liveButton('关闭').disabled,false);
});
test('automation old refresh cannot replace an opened editor',async()=>{
  const f=automationFixture(),open=f.call('showAutomations');const task={id:'task',name:'任务',prompt:'内容',status:'ACTIVE',rrule:'FREQ=DAILY;INTERVAL=1'};
  f.settle(f.requests[0],{automations:[task]});await open;
  const loading=f.liveButton('刷新列表').onclick();f.liveButton('编辑').onclick();const prompt=f.nodes.findLast(node=>node.tag==='textarea');prompt.value='未保存内容';
  f.settle(f.requests[1],{automations:[]});await loading;assert(prompt.isConnected);assert.equal(prompt.value,'未保存内容');
});
test('automation initial load can retry and stale connection writes cannot update the list',async()=>{
  const f=automationFixture(),open=f.call('showAutomations');f.settle(f.requests[0],Error('离线'),true);await open;
  assert(f.nodes.some(node=>node.isConnected&&node.textContent.includes('读取失败')));
  const retry=f.liveButton('刷新列表').onclick();f.settle(f.requests[1],{automations:[{id:'task',name:'任务',prompt:'内容',status:'ACTIVE',rrule:'FREQ=DAILY;INTERVAL=1'}]});await retry;
  const pause=f.liveButton('暂停').onclick();await f.liveButton('暂停').onclick();assert.equal(f.requests.length,3);f.state.generation++;
  f.settle(f.requests[2],{automation:{id:'task',name:'旧回包',status:'PAUSED',rrule:'FREQ=DAILY;INTERVAL=1'}});await pause;
  assert(!f.nodes.some(node=>node.isConnected&&node.textContent==='旧回包'));assert.equal(f.liveButton('关闭').disabled,false);
});

test('automation scoped entry filters tasks and binds creation to its opening thread',async()=>{
  const f=automationFixture(),open=f.call('showAutomations',undefined,{threadId:'A'});
  const task=id=>({id,name:id+' task',threadId:id,status:'ACTIVE',prompt:'task content',rrule:'FREQ=DAILY;INTERVAL=1'});
  f.settle(f.requests[0],{automations:[task('A'),task('B')]});await open;
  assert(f.nodes.some(node=>node.isConnected&&node.textContent==='A task'));
  assert(!f.nodes.some(node=>node.isConnected&&node.textContent==='B task'));
  f.state.threadId='B';f.liveButton('新建任务').onclick();
  f.nodes.findLast(node=>node.attributes['aria-label']==='名称').value='scoped';
  f.nodes.findLast(node=>node.tag==='textarea').value='original thread';
  const saving=f.submit();assert.equal(f.requests[1].options.body.threadId,'A');
  f.settle(f.requests[1],{automation:{...task('created'),threadId:'A'}});await saving;
  assert(!f.nodes.some(node=>node.isConnected&&node.textContent==='B task'));
});

test('automation refreshes preserve rows and scroll and coalesce duplicate reads',async()=>{
  const f=automationFixture(),open=f.call('showAutomations');
  const task={id:'task',name:'任务',threadId:'A',status:'ACTIVE',prompt:'content',rrule:'FREQ=DAILY;INTERVAL=1'};
  await f.call('showAutomations');assert.equal(f.requests.length,1);
  f.settle(f.requests[0],{automations:[task]});await open;
  const rows=f.nodes.find(node=>node.className==='automation-rows'),first=rows.children[0],refresh=f.liveButton('刷新列表');f.dialog().scrollTop=220;
  const loading=refresh.onclick();await refresh.onclick();assert.equal(f.requests.length,2);assert.equal(rows.children[0],first);
  f.settle(f.requests[1],{automations:[{...task}]});await loading;assert.equal(rows.children[0],first);assert.equal(f.dialog().scrollTop,220);
  const changed=refresh.onclick();f.settle(f.requests[2],{automations:[{...task,status:'PAUSED'}]});await changed;
  assert.notEqual(rows.children[0],first);assert.equal(f.dialog().scrollTop,220);
  const failed=refresh.onclick();f.settle(f.requests[3],Error('refresh offline'),true);await failed;
  assert(f.liveButton('恢复'));assert.equal(f.dialog().scrollTop,220);
});

test('automation editor saves a chosen thread and ignores picker responses after return',async()=>{
 const f=automationFixture(),open=f.call('showAutomations');
 const task={id:'task',name:'任务',threadId:'A',status:'PAUSED',prompt:'content',rrule:'FREQ=DAILY;INTERVAL=1'};
 f.settle(f.requests[0],{automations:[task]});await open;f.liveButton('编辑').onclick();
 const choosing=f.liveButton('更换执行会话').onclick();
 f.settle(f.requests[1],{threads:[{id:'B',title:'Session B',projectPath:'D:/B'}],hasMore:false});await choosing;
 f.nodes.findLast(node=>node.className==='button secondary automation-target-option').onclick();
 assert(f.liveButton('更换执行会话'),'selection must retain the change control');
 const save=f.submit();assert.equal(f.requests[2].options.body.threadId,'B');
 f.settle(f.requests[2],Error('offline'),true);await save;
 const late=f.liveButton('更换执行会话').onclick();f.liveButton('返回列表').onclick();
 f.settle(f.requests[3],{threads:[{id:'C',title:'late'}],hasMore:false});await late;
 assert(!f.nodes.some(node=>node.isConnected&&node.textContent==='late'));
});

