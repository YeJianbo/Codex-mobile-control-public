import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
const binding=source.slice(source.indexOf('function bindSubmissionThread('),source.indexOf('function moveNewConversationDraft('));
const recovery=source.slice(source.indexOf('let recoveringSubmission=null,'),source.indexOf('function showCloudSnapshotImport('));
function fixture(threadId='A'){
  const pending={threadId:'A',requestId:'request-A',selection:1,key:'thread:A',text:'A 的消息',project:'project'};
  const state={threadId,selection:1,generation:1,page:'chat',chatProject:'project',pending,connected:true,
    drafts:{'thread:A':pending.text},draftRevisions:new Map(),capabilities:['local-task-receipts']};
  let saved=JSON.stringify(pending),restored=false;
  const context=vm.createContext({state,readPendingSubmission:()=>JSON.parse(saved),safeRead:()=>saved,
    safeWrite:(_,value)=>{saved=value;},toast:()=>{},restorePendingDraft:()=>{restored=true;state.pending=null;},
    api:async()=>({request:{state:'accepted',threadId:'B'}})});
  vm.runInContext(binding+recovery,context);
  return {state,context,get saved(){return saved;},get restored(){return restored;}};
}
test('an existing conversation cannot be rebound by another conversation acknowledgement',()=>{
  const f=fixture();
  assert.equal(f.context.bindSubmissionThread(f.state.pending,'B'),false);
  assert.equal(f.state.threadId,'A');assert.equal(f.state.drafts['thread:A'],'A 的消息');assert(f.restored);
});
test('recovered acknowledgement cannot open another conversation or consume its original draft',async()=>{
  const f=fixture();
  assert.equal(await f.context.recoverLocalSubmission(),false);
  assert.equal(f.state.threadId,'A');assert.equal(f.state.drafts['thread:A'],'A 的消息');
  assert.equal(JSON.parse(f.saved).requestId,'request-A');assert(f.restored);
});
