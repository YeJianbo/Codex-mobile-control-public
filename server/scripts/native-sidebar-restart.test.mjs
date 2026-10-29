import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listThreadsWithCodexHistory} from '../src/services/codexSessions.ts';
import {zcodeNativeSessions} from '../src/services/zcodeNativeSessions.ts';
import {deepseekNativeSessions} from '../src/services/deepseekNativeSessions.ts';
import {nativeSidebarAgents} from '../src/services/sidebarPage.ts';

test('a cold ZCode sidebar loads its own native history independently of DeepSeek',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-native-sidebar-'));
 const previous=process.env.CODEX_HOME,oldZcode=zcodeNativeSessions.list,oldDeepSeek=deepseekNativeSessions.list,oldAlias=zcodeNativeSessions.isAliasedThread;
 process.env.CODEX_HOME=home;
 const thread={id:'zcode-original',title:'original',status:'completed',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-01-01T00:00:00.000Z',projectPath:'/fixture'};
 let reads=0;
 zcodeNativeSessions.list=async()=>{reads++;return [{sessionId:'sess_original',thread}];};
 zcodeNativeSessions.isAliasedThread=id=>id===thread.id;
 deepseekNativeSessions.list=async()=>{throw Error('ZCode must not depend on DeepSeek history');};
 try{
  for(const stored of [[],[thread]]){
   const rows=await listThreadsWithCodexHistory(stored,true,[],nativeSidebarAgents('zcode'));
   assert(rows.some(row=>row.id===thread.id));
  }
  assert.equal(reads,2);
  const retained=await listThreadsWithCodexHistory([],true,[],nativeSidebarAgents('codex',[thread.id]));
  assert(retained.some(row=>row.id===thread.id));
  assert.deepEqual(nativeSidebarAgents('deepseek'),['deepseek']);
  assert.deepEqual(nativeSidebarAgents('codex'),[]);
  assert.deepEqual(nativeSidebarAgents(),['deepseek','zcode']);
 }finally{
  zcodeNativeSessions.list=oldZcode;zcodeNativeSessions.isAliasedThread=oldAlias;deepseekNativeSessions.list=oldDeepSeek;
  if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
  await fs.rm(home,{recursive:true,force:true});
 }
});
