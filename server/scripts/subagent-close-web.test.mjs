import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
const action=source.slice(source.indexOf('const archivingSubagents=new Set();'),source.indexOf('async function deleteThread()'));
function fixture({running=false,confirm=true}={}){
 const parent={id:'zcode-parent'},child={id:'zcode-child',subagent:{parentThreadId:parent.id}},nested={id:'zcode-nested',subagent:{parentThreadId:child.id}};
 const state={generation:1,threadId:nested.id,threads:[parent,child,nested]},calls=[];
 const context={state,harnessForThread:()=> 'zcode',subagentLabel:()=> '子代理',subagentRunning:()=>running,
  api:async(route,options)=>{calls.push({route,options});return route.endsWith('/close-preview')?{running,canArchive:!running}:{closedThreadIds:[child.id,nested.id]};},
  confirmAction:async()=>confirm,conversationParent:()=>parent,openThread:async row=>state.threadId=row.id,
  renderThreads:()=>{},renderConversation:()=>{},updateControls:()=>{},refreshThreads:async()=>{},toast:()=>{throw Error('Unexpected toast');}};
 vm.runInNewContext(action+'\nthis.close=archiveSubagent;',context);
 return {state,calls,run:()=>context.close(child)};
}
test('Web closes the native subagent tree through preview and close, retaining the parent',async()=>{
 const f=fixture();await f.run();
 assert.deepEqual(f.calls.map(row=>row.route),['/api/threads/zcode-child/close-preview','/api/threads/zcode-child/close']);
 assert.equal(f.calls[1].options.body.parentThreadId,'zcode-parent');assert.equal(f.calls[1].options.body.stopRunning,false);
 assert.deepEqual(f.state.threads.map(row=>row.id),['zcode-parent']);assert.equal(f.state.threadId,'zcode-parent');
});
test('Web requires confirmation before stopping a running native subagent',async()=>{
 const declined=fixture({running:true,confirm:false});await declined.run();assert.equal(declined.calls.length,1);assert.equal(declined.state.threads.length,3);
 const accepted=fixture({running:true});await accepted.run();assert.equal(accepted.calls[1].options.body.stopRunning,true);
});
