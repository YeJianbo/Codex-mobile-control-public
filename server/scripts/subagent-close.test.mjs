import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {archiveOrCloseSubagent,isCrossVolumeArchiveError} from '../dist/services/subagentClose.js';

const parent='parent',root={id:'child',title:'Sol',status:'idle',subagent:{parentThreadId:parent},createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z'};
const nested={...root,id:'nested',subagent:{parentThreadId:root.id}};
const exdev=()=>Error('{"code":-32603,"message":"failed to archive session: thread-store internal error: failed to archive thread: 系统无法将文件移到不同的磁盘驱动器。 (os error 17)"}');
function harness({failure=exdev(),rows=[root,nested],active,changedParent,unsubscribeError}={}){
 const calls=[],saved=[];
 return {calls,saved,operations:{
  async request(method,params){calls.push([method,params.threadId]);if(method==='thread/archive'&&failure)throw failure;if(method==='thread/unsubscribe'&&unsubscribeError)throw unsubscribeError;return {};},
  async list(){return rows;},
  async inspect(id){const thread=rows.find(row=>row.id===id);return {thread:changedParent&&id===root.id?{...thread,subagent:{parentThreadId:'other'}}:thread,running:id===active,canArchive:id!==active};},
  saveClosed(threads){saved.push(...threads);},
 }};
}
test('successful native archive has no gateway-only closure',async()=>{
 const h=harness({failure:null});assert.deepEqual(await archiveOrCloseSubagent(root,h.operations),{archived:true,closed:true});assert.equal(h.saved.length,0);assert.deepEqual(h.calls,[['thread/archive','child']]);
});
test('only the known cross-volume failure closes idle descendants and preserves explicit semantics',async()=>{
 const h=harness();const result=await archiveOrCloseSubagent(root,h.operations);
 assert.deepEqual(result,{archived:false,closed:true,closureKind:'gatewayClosed',closedThreadIds:['child','nested']});assert.deepEqual(h.saved.map(row=>row.id),['child','nested']);assert.deepEqual(h.calls,[['thread/archive','child'],['thread/unsubscribe','child'],['thread/unsubscribe','nested']]);
 for(const text of ['request timed out','failed to archive thread: permission denied','failed to archive thread: EXDEV; failed to restore moved rollouts: access denied'])assert.equal(isCrossVolumeArchiveError(Error(text)),false);
});
test('ordinary RPC errors, a running descendant, changed parent, or failed unsubscribe never persist a close',async()=>{
 for(const options of [{failure:Error('permission denied')},{active:'nested'},{changedParent:true},{unsubscribeError:Error('connection closed')}]){
  const h=harness(options);await assert.rejects(archiveOrCloseSubagent(root,h.operations));assert.equal(h.saved.length,0);
 }
});
test('actual Windows C/D rename failure enters the close branch without moving or changing history',async t=>{
 if(process.platform!=='win32'){t.skip('requires the installed Windows C/D layout');return;}
 const sourceRoot=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-close-cross-volume-'));
 const destinationRoot=await fs.mkdtemp('D:/codex/build/Codex-mobile-control/close-cross-volume-');
 const source=path.join(sourceRoot,'history.jsonl'),destination=path.join(destinationRoot,'history.jsonl'),bytes=Buffer.from('{"type":"isolated_archive_fixture"}\n');
 try{
  await fs.writeFile(source,bytes);let error;
  try{await fs.rename(source,destination);}catch(e){error=e;}
  assert.equal(error?.code,'EXDEV','fixture must be physically cross-volume');
  const h=harness({failure:Error('failed to archive thread: '+error.message)});
  assert.equal((await archiveOrCloseSubagent(root,h.operations)).closureKind,'gatewayClosed');
  assert.deepEqual(await fs.readFile(source),bytes);await assert.rejects(fs.access(destination));
 }finally{
  assert.equal(path.resolve(path.dirname(sourceRoot)),path.resolve(os.tmpdir()));assert.equal(path.resolve(path.dirname(destinationRoot)),path.resolve('D:/codex/build/Codex-mobile-control'));
  await fs.rm(sourceRoot,{recursive:true,force:true});await fs.rm(destinationRoot,{recursive:true,force:true});
 }
});
test('gateway-only closure persists across reload and can be restored without losing stored history',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-close-store-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');let store=new StateStore();
 try{
  await store.load();await store.upsertThread(root);await store.upsertThread(nested);
  store.closeSubagents([root,nested]);assert.equal(store.isThreadHidden(root.id),true);assert.equal(store.archivedThreads()[0].closureKind,'gatewayClosed');store.close();
  store=new StateStore();await store.load();assert.equal(store.isThreadHidden(root.id),true);assert.equal(store.archivedThreads().length,2);
  store.restoreThread(root.id);assert.equal(store.isThreadHidden(root.id),false);assert(store.threads.some(row=>row.id===root.id));assert.equal(store.archivedThreads().length,1);
 }finally{store.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});}
});
