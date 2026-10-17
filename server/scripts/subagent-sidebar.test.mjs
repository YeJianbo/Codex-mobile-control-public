import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {subagentMetadata,subagentSidebarPage,subagentThreadScope} from '../dist/services/subagentThreads.js';
import {listThreadsWithCodexHistory} from '../dist/services/codexSessions.js';
import {sidebarThreadRoots,subagentLabel,threadFamilyRunning,sidebarInactiveAgents,conversationParent,conversationLineage,subagentRunning,conversationRunningAgents} from '../public/thread-family.js';
const row=(id,fields={})=>({id,title:id,status:'idle',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',...fields});
const parent=row('main'),other=row('other');
const child=row('child',{subagent:{parentThreadId:'main',nickname:'Sol',role:'sol',task:'review'}});
const nested=row('nested',{subagent:{parentThreadId:'child',nickname:'Terra'}});
const rows=[nested,child,parent,other];
test('source object and JSON preserve only safe subagent display metadata',()=>{
 const source={subagent:{thread_spawn:{parent_thread_id:'main',agent_nickname:'Sol',agent_role:'sol',agent_path:'/root/review',instructions:'PRIVATE'}}};
 const expected={parentThreadId:'main',nickname:'Sol',role:'sol',task:'review'};
 assert.deepEqual(subagentMetadata({source}),expected);
 assert.deepEqual(subagentMetadata({source:JSON.stringify(source)}),expected);
 assert.equal(JSON.stringify(expected).includes('PRIVATE'),false);
 assert.equal(subagentMetadata({source:'vscode'}),undefined);
 assert.deepEqual(subagentMetadata({thread_source:'subagent',agent_role:'worker'}),{nickname:undefined,role:'worker',task:undefined});
});
test('a page counts roots and includes their complete tree even when children are newer',()=>{
 const page=subagentSidebarPage(rows,1,()=>false);
 assert.deepEqual(page.rows.map(t=>t.id),['nested','child','main']);assert.equal(page.hasMore,true);
});
test('selected or pinned child keeps its ancestors without consuming the ordinary page',()=>{
 assert.deepEqual(subagentSidebarPage([other,...rows.slice(0,3)],1,t=>t.id==='nested').rows.map(t=>t.id),['other','nested','child','main']);
 assert.equal(subagentSidebarPage(rows,2,()=>false).hasMore,false);
});
test('project filtering keeps agents running in a separate worktree with their parent',()=>{
 const family=[{...child,projectPath:'X:/worktree'}, {...parent,projectPath:'X:/main'},other];
 assert.deepEqual(subagentThreadScope(family,t=>t.projectPath==='X:/main').map(t=>t.id),['child','main']);
 assert.deepEqual(subagentThreadScope(family,t=>t.projectPath==='X:/worktree').map(t=>t.id),['child','main']);
});
test('Web keeps roots separate and moves inactive, nested and orphan agents into the sidebar section',()=>{
 assert.deepEqual(sidebarThreadRoots(rows).map(t=>t.id),['main','other']);
 assert.deepEqual(sidebarThreadRoots(rows,'Terra').map(t=>t.id),[]);
 assert.deepEqual(sidebarThreadRoots(rows,'review').map(t=>t.id),[]);
 assert.equal(subagentLabel(child),'子代理 · Sol');
 assert.deepEqual(sidebarThreadRoots([child]).map(t=>t.id),[]);
 assert.deepEqual(sidebarInactiveAgents(rows).map(t=>t.id),['nested','child']);
 assert.deepEqual(sidebarInactiveAgents(rows,'Terra').map(t=>t.id),['nested']);
 assert.deepEqual(sidebarInactiveAgents(rows,'review').map(t=>t.id),['child']);
 assert.deepEqual(sidebarInactiveAgents([child]).map(t=>t.id),['child']);
 assert.deepEqual(sidebarInactiveAgents([{...child,status:'running'},{...nested,status:'starting'}]),[]);
 assert(subagentRunning({...child,goal:{status:'active'}}));
 assert.equal(conversationParent(rows,'nested'),child);
 assert.equal(conversationParent(rows,'child'),parent);
 assert.equal(conversationParent(rows,'main'),null);
 assert.deepEqual(conversationLineage(rows,'nested'),[nested,child,parent]);
 assert.equal(conversationParent([child],'child').id,'main');
 assert.equal(conversationParent([row('a',{subagent:{parentThreadId:'a'}})],'a'),null);
});
test('malformed cycles remain reachable once and do not recurse forever',()=>{
 const a=row('a',{subagent:{parentThreadId:'b'}}),b=row('b',{subagent:{parentThreadId:'a'}});
 assert.deepEqual(sidebarThreadRoots([b,a]).map(t=>t.id),[]);
 assert.equal(subagentSidebarPage([b,a],1,()=>false).rows.length,2);
 assert.deepEqual(conversationLineage([b,a],'a'),[a,b]);
 assert.deepEqual(conversationRunningAgents([a,{...b,status:'starting'}],'a').map(t=>t.id),['b']);
});
test('running nested agents remain reachable when their immediate parent is idle',()=>{
 const running={...nested,status:'running'},unrelated=row('unrelated',{status:'running',subagent:{parentThreadId:'another'}});
 assert.deepEqual(conversationRunningAgents([running,child,parent,unrelated],'main'),[running]);
 assert.deepEqual(conversationRunningAgents([running,child,parent],'child'),[running]);
 assert.deepEqual(conversationRunningAgents([running,child,parent],'nested'),[]);
 assert.deepEqual(conversationRunningAgents(rows,'main'),[]);
});
test('a running descendant keeps the parent in progress, then completion clears it',()=>{
 assert(threadFamilyRunning(parent,new Map([['main',[child]],['child',[{...nested,status:'running'}]]])));
 assert.equal(threadFamilyRunning(parent,new Map([['main',[child]],['child',[nested]]])),false);
});
test('desktop SQLite source enriches stored running children without exporting injected title',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-subagents-')),old=process.env.CODEX_HOME;
 process.env.CODEX_HOME=home;
 try{
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT,recency_at_ms INTEGER,updated_at_ms INTEGER,created_at_ms INTEGER,is_pinned INTEGER,section_position INTEGER,archived INTEGER,source TEXT,agent_nickname TEXT,agent_role TEXT,agent_path TEXT)');
  const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('main','X:/fixture','Main','',1000,1000,500,0,0,0,'vscode',null,null,null);
  insert.run('child','X:/fixture',null,'<INTERNAL INSTRUCTIONS>',2000,2000,500,0,0,0,JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'main'}}}),'Sol','sol','/root/review');
  db.close();
  const result=await listThreadsWithCodexHistory([row('child',{status:'running'})]);
  assert.equal(result.find(t=>t.id==='child').status,'running');
  assert.deepEqual(result.find(t=>t.id==='child').subagent,child.subagent);
  assert.equal(result.find(t=>t.id==='child').title,'review');
  assert.equal(JSON.stringify(result).includes('INTERNAL'),false);
 }finally{if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;await fs.rm(home,{recursive:true,force:true});}
});
