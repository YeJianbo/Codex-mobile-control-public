import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {BoundedLruMap} from '../public/thread-cache.js';

const source=fs.readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
const start=source.indexOf('const desktopNotifications='),end=source.indexOf('async function run(',start);
const toggleStart=source.indexOf("$('desktopNotify').checked="),toggleEnd=source.indexOf('$("rawConfig").oninput',toggleStart);
assert(start>=0&&end>start&&toggleStart>=0&&toggleEnd>toggleStart);

function fixture({ignoreAbort=false}={}){
  const requests=[],posted=[],timers=new Map(),prefs=new Map([['cmc.desktopNotify','on']]);
  const checkbox={checked:false};let nextTimer=0;
  class Notification {
    static permission='granted';
    static requestPermission=()=>Promise.resolve('denied');
    constructor(title,options){Object.assign(this,{title,...options});posted.push(this);}
    close(){this.closed=true;this.onclose?.();}
  }
  const state={generation:1,page:'chat',threadId:'current',threads:[],events:new Map()};
  const document={hidden:true};
  const context=vm.createContext({state,document,Notification,window:{Notification},BoundedLruMap,AbortController,URLSearchParams,
    safeRead:key=>prefs.get(key)||'',safeWrite:(key,value)=>prefs.set(key,value),
    $:id=>{assert.equal(id,'desktopNotify');return checkbox;},
    setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
    api:(path,{signal}={})=>new Promise((resolve,reject)=>{
      requests.push({path,signal,resolve});
      signal?.addEventListener('abort',()=>{if(!ignoreAbort)reject(new Error('cancelled'));},{once:true});
    }),
  });
  vm.runInContext(source.slice(start,end)+source.slice(toggleStart,toggleEnd)+
    'globalThis.noticeState=()=>({queued:approvalNoticeQueue.size,policy:Boolean(approvalNoticePolicy)});',context);
  return {context,state,document,requests,posted,prefs,checkbox,Notification,timers,
    fire(){const pending=[];for(const [id,callback]of [...timers]){timers.delete(id);pending.push(callback());}return pending;}};
}
const event=(id,approvalType='exec')=>({type:'approval.requested',threadId:id,approvalId:'approval-'+id,approvalType,title:'操作确认'});
const pending=event=>({approvals:[{id:event.approvalId,threadId:event.threadId,status:'pending',title:event.title}]});
function respond(request,event){request.resolve(request.path.startsWith('/api/approvals?')?pending(event):{desktopAutoApprove:false});}

test('resolving the last approval cancels its HTTP and unused policy, including questions',async()=>{
  for(const type of ['exec','question']){
    const f=fixture(),approval=event('one',type);f.context.queueApprovalNotice(approval);
    const waiting=f.fire();assert.equal(f.requests.length,type==='question'?1:2);
    f.context.cancelApprovalNotice(approval.threadId,approval.approvalId);
    assert(f.requests.every(request=>request.signal.aborted));await Promise.all(waiting);
    assert.equal(f.context.noticeState().queued,0);assert.equal(f.posted.length,0);
  }
});

test('cancelling one approval preserves a shared policy required by another',async()=>{
  const f=fixture(),first=event('first'),second=event('second');
  f.context.queueApprovalNotice(first);f.context.queueApprovalNotice(second);const waiting=f.fire();
  assert.equal(f.requests.length,3);
  const policy=f.requests.find(request=>request.path==='/api/settings/remote-approval');
  f.context.cancelApprovalNotice(first.threadId,first.approvalId);
  assert(f.requests.find(request=>request.path.includes('threadId=first')).signal.aborted);
  assert.equal(policy.signal.aborted,false);
  respond(f.requests.find(request=>request.path.includes('threadId=second')),second);
  policy.resolve({desktopAutoApprove:false});await Promise.all(waiting);
  assert.equal(f.posted.length,1);assert.equal(f.posted[0].tag,'cmc-approval-second-approval-second');
});

test('returning to the page clears queued timers and cancels reads already in progress',async()=>{
  const f=fixture();f.context.queueApprovalNotice(event('inflight'));const waiting=f.fire();
  f.context.queueApprovalNotice(event('queued'));assert.equal(f.timers.size,1);
  f.document.hidden=false;f.context.closeDesktopNotifications();
  assert.equal(f.timers.size,0);assert(f.requests.every(request=>request.signal.aborted));
  await Promise.all(waiting);assert.equal(f.context.noticeState().queued,0);assert.equal(f.posted.length,0);
});

test('ignored abort responses cannot post or clear a newer notice and policy owner',async()=>{
  for(const newConnection of [false,true]){
  const f=fixture({ignoreAbort:true}),approval=event('same');
  f.context.queueApprovalNotice(approval);const oldWaiting=f.fire(),oldRequests=f.requests.slice();
  f.document.hidden=false;f.context.closeDesktopNotifications();f.document.hidden=true;
  if(newConnection)f.state.generation++;
  f.context.queueApprovalNotice(approval);const newWaiting=f.fire(),newRequests=f.requests.slice(oldRequests.length);
  oldRequests.forEach(request=>respond(request,approval));await Promise.all(oldWaiting);
  assert.equal(f.posted.length,0);assert.equal(f.context.noticeState().queued,1);assert(f.context.noticeState().policy);
  newRequests.forEach(request=>respond(request,approval));await Promise.all(newWaiting);
  assert.equal(f.posted.length,1);assert.equal(f.context.noticeState().queued,0);
  }
});

test('turning reminders off or denying permission persists off and cancels pending work',async()=>{
  for(const action of ['off','denied']){
    const f=fixture();f.context.queueApprovalNotice(event('one'));const waiting=f.fire();
    if(action==='off')f.checkbox.checked=false;
    else {f.Notification.permission='default';f.checkbox.checked=true;}
    f.checkbox.onchange();await Promise.all(waiting);
    assert.equal(f.prefs.get('cmc.desktopNotify'),'off');assert.equal(f.checkbox.checked,false);
    assert(f.requests.every(request=>request.signal.aborted));assert.equal(f.posted.length,0);
  }
});
