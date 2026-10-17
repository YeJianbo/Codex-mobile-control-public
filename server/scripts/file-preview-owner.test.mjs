import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {previewKind,parentPath} from '../public/console-core.js';

const source=fs.readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const previewCode=section('let filePreviewRead=','async function switchFileMode(')+section('async function previewFile()', 'const fileSaves=');
const readCode=section('let fileListRead=','function renderFiles()')+section('async function openFile(', 'async function previewFile()')+section('async function openDiff(', 'const diffWrites=');

class Node {
  constructor(tag='div',text=''){
    Object.assign(this,{tag,textContent:text,children:[],hidden:true,parentNode:null,value:'',dataset:{},classList:{add(){},remove(){}}});
  }
  append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
  contains(node){return this.children.some(child=>child===node||child.contains(node));}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
  setAttribute(){}
}
function fixture(path='page.html'){
  const nodes=new Map(),requests=[],renders=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const heading=new Node('h2'),description=new Node('p');$('fileEmpty').querySelector=tag=>tag==='h2'?heading:description;
  const state={generation:1,fileRequest:0,listRequest:0,fileProject:'p',fileMode:'files',filePath:'',files:[],diffFiles:[],opened:{project:'p',path,kind:previewKind(path)}};
  const context=vm.createContext({state,$,AbortController,parentPath,previewKind,updateControls(){},renderFiles(){},updateDiffControls(){},allowFileLeave:async()=>true,errorMessage:error=>error.message,
    el:(tag,classes,text)=>new Node(tag,text),button:(text,onclick)=>Object.assign(new Node('button',text),{onclick}),
    markdownNode:text=>new Node('markdown',text),
    diffCode:text=>new Node('pre',text),
    renderPdf:async(target,url,current)=>{renders.push({url,current});},
    // Ignore abort deliberately so stale-result checks are exercised separately.
    api:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),
  });
  vm.runInContext(previewCode+readCode,context);
  return {state,context,$,requests,renders};
}
const flush=async()=>{for(let index=0;index<6;index++)await Promise.resolve();};

test('repeated preview of the same file cancels old grants and rejects late responses',async()=>{
  const f=fixture(),first=f.context.previewFile(),second=f.context.previewFile();
  assert(f.requests[0].options.signal.aborted);assert.equal(f.requests[1].options.signal.aborted,false);
  f.requests[1].resolve({url:'/new-preview'});await second;
  f.requests[0].resolve({url:'/old-preview'});await first;
  assert.equal(f.$('filePreview').children.length,1);assert.equal(f.$('filePreview').children[0].src,'/new-preview');
});

test('reset cancels pending grants and removes the loaded frame rather than hiding it',async()=>{
  const f=fixture(),pending=f.context.previewFile();f.context.resetFile();
  assert(f.requests[0].options.signal.aborted);assert.equal(f.$('filePreview').children.length,0);
  f.requests[0].reject(Error('cancelled old preview'));await pending;
  f.state.opened={project:'p',path:'other.html',kind:'web'};
  const next=f.context.previewFile();f.requests[1].resolve({url:'/current-preview'});await next;
  const frame=f.$('filePreview').children[0];f.context.resetFile();
  assert.equal(f.$('filePreview').children.length,0);assert.equal(frame.parentNode,null);
  assert.equal(f.$('filePreview').hidden,true);assert.equal(f.state.opened,null);
});

test('PDF current predicate is invalidated by repeated preview and reset',async()=>{
  const f=fixture('report.pdf'),first=f.context.previewFile();
  f.requests[0].resolve({url:'/first-pdf'});await first;assert(f.renders[0].current());
  const second=f.context.previewFile();assert.equal(f.renders[0].current(),false);
  f.requests[1].resolve({url:'/second-pdf'});await second;assert(f.renders[1].current());
  f.context.resetFile();assert.equal(f.renders[1].current(),false);
});

test('PDF failures remain visible only while that preview is still current',async()=>{
  for(const closed of [true,false]){
    const f=fixture('report.pdf');let fail,started;
    const ready=new Promise(resolve=>{started=resolve;});
    f.context.renderPdf=()=>new Promise((resolve,reject)=>{fail=reject;started();});
    const reading=f.context.previewFile();f.requests[0].resolve({url:'/pdf'});await ready;
    if(closed)f.context.resetFile();
    fail(Error('PDF read failed'));
    if(closed)await reading;else await assert.rejects(reading,/PDF read failed/);
  }
});

test('retrying images preserves error feedback and ignores callbacks from replaced previews',async()=>{
  const f=fixture('photo.png');await f.context.previewFile();const first=f.$('filePreview').children[1];
  assert(first.hidden);first.onerror();assert.match(f.$('filePreview').children[0].textContent,/图片加载失败/);
  await f.$('filePreview').children[1].onclick();const second=f.$('filePreview').children[1];
  first.onload();assert(second.hidden);second.onload();assert.equal(second.hidden,false);
  assert.equal(f.$('filePreview').children.length,1);
  f.context.resetFile();second.onerror();assert.equal(f.$('filePreview').children.length,0);
});

test('directory replacement cancels old reads and late cleanup cannot detach the next owner',async()=>{
  const f=fixture(),first=f.context.loadFiles('one'),second=f.context.loadFiles('two');
  assert(f.requests[0].options.signal.aborted);assert.equal(f.requests[1].options.signal.aborted,false);
  f.requests[0].resolve({files:[{path:'old'}]});await first;
  assert(f.state.fileListLoading);assert.equal(f.state.files.length,0);
  f.state.fileMode='diff';const third=f.context.loadFiles('');
  assert(f.requests[1].options.signal.aborted);assert(f.requests[2].path.endsWith('/diff/files'));
  f.requests[2].resolve({files:[{path:'current'}]});await third;
  f.requests[1].reject(Error('old request failed'));await second;
  assert.equal(f.state.fileListLoading,false);assert.equal(f.state.fileListError,'');
  assert.equal(f.state.diffFiles[0].path,'current');
});

test('removing the selected project cancels its pending directory without inventing an error',async()=>{
  const f=fixture(),reading=f.context.loadFiles('old');f.state.fileProject='';await f.context.loadFiles();
  assert(f.requests[0].options.signal.aborted);assert.equal(f.requests.length,1);
  f.requests[0].reject(Error('cancelled'));await reading;
  assert.equal(f.state.files.length,0);assert.equal(f.state.fileListLoading,false);assert.equal(f.state.fileListError,'');
});

test('text replacement and close cancel old bodies while a later file can still open',async()=>{
  const f=fixture(),first=f.context.openFile({path:'one.txt'});await flush();
  const second=f.context.openFile({path:'two.txt'});await flush();assert(f.requests[0].options.signal.aborted);
  f.requests[0].resolve({content:'old text'});await first;assert.equal(f.state.opened,null);
  f.context.resetFile();assert(f.requests[1].options.signal.aborted);
  f.requests[1].reject(Error('cancelled second'));await second;
  assert.equal(f.$('editor').hidden,true);
  const third=f.context.openFile({path:'current.txt'});await flush();
  f.requests[2].resolve({content:'current text'});await third;
  assert.equal(f.state.opened.path,'current.txt');assert.equal(f.$('editor').value,'current text');
});

test('switching from a patch to text cancels both patch reads without losing the text owner',async()=>{
  const f=fixture(),patch=f.context.openDiff({path:'old.txt'});await flush();
  const text=f.context.openFile({path:'current.txt'});await flush();
  assert.equal(f.requests[0].options.signal,f.requests[1].options.signal);assert(f.requests[0].options.signal.aborted);
  f.requests[0].reject(Error('old patch failed'));f.requests[1].resolve({hunks:[]});await patch;
  f.context.resetFile();assert(f.requests[2].options.signal.aborted);
  f.requests[2].resolve({content:'late text'});await text;
  assert.equal(f.state.opened,null);assert.equal(f.$('diffView').hidden,true);
});

test('a failed patch read cancels its sibling and leaves the existing retry usable',async()=>{
  const f=fixture(),file={path:'patch.txt'},reading=f.context.openDiff(file);await flush();
  f.requests[0].reject(Error('patch unavailable'));await reading;
  assert(f.requests[1].options.signal.aborted);assert.match(f.$('diffView').children[0].textContent,/patch unavailable/);
  f.requests[1].resolve({hunks:[]});
  const retry=f.$('diffView').children[1].onclick();await flush();
  assert.equal(f.requests[2].options.signal.aborted,false);
  f.requests[2].resolve({diff:'new patch'});f.requests[3].resolve({hunks:[]});await retry;
  assert.equal(f.state.diffSelected,file);assert.equal(f.$('diffView').children[1].textContent,'new patch');
});

test('failures for the current directory or text file still produce their normal error state',async()=>{
  const f=fixture(),listing=f.context.loadFiles('current');f.requests[0].reject(Error('directory unavailable'));
  await assert.rejects(listing,/directory unavailable/);assert.equal(f.state.fileListError,'directory unavailable');
  const reading=f.context.openFile({path:'current.txt'});await flush();f.requests[1].reject(Error('file unavailable'));
  await assert.rejects(reading,/file unavailable/);assert.equal(f.$('fileEmpty').querySelector('h2').textContent,'无法打开文件');
  assert.equal(f.$('fileEmpty').querySelector('p').textContent,'file unavailable');
});
