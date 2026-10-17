import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import TOML from '@iarna/toml';
import {listAutomations,listAutomationTargets,saveAutomation} from '../src/services/automations.ts';
import {scheduledMessage} from '../src/services/messageSource.ts';
import {permittedPublicRequest} from './public-routes.mjs';

test('create, edit and pause retain Codex heartbeat target and unrelated settings',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-schedule-'));
 try{
  const task=await saveAutomation(undefined,{name:'隔离任务',prompt:'只读观察',threadId:'test-thread',schedule:{frequency:'MINUTELY',interval:5}},home);
  const file=path.join(home,'automations',task.id,'automation.toml');
  const raw=TOML.parse(await fs.readFile(file,'utf8'));raw.notification_policy='failed_runs_only';raw.model='saved-model';
  await fs.writeFile(file,TOML.stringify(raw));
  await saveAutomation(task.id,{status:'PAUSED'},home);
  const paused=TOML.parse(await fs.readFile(file,'utf8'));
  assert.equal(paused.target_thread_id,'test-thread');assert.equal(paused.notification_policy,'failed_runs_only');assert.equal(paused.model,'saved-model');assert.equal(paused.status,'PAUSED');
  await saveAutomation(task.id,{name:'更新名称',prompt:'第一行\n第二行',status:'ACTIVE'},home);
  const [listed]=await listAutomations(home);assert.equal(listed.name,'更新名称');assert.equal(listed.prompt,'第一行\n第二行');assert.equal(listed.rrule,'FREQ=MINUTELY;INTERVAL=5');
  await assert.rejects(saveAutomation('../escape',{status:'PAUSED'},home),/编号无效/);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});

test('retarget saves the destination, returns its metadata, and searches metadata without archived threads',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-retarget-'));
 try{
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  try{
   db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,title TEXT,cwd TEXT,archived INTEGER,source TEXT,updated_at_ms INTEGER)');
   const insert=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)');
   insert.run('A','原会话','',String.raw`\\?\D:\original`,0,'cli',1);
   insert.run('B','目标会话','',String.raw`\\?\D:\new-project`,0,'cli',2);
   insert.run('C','','<heartbeat> <automation_id>task',String.raw`\\?\UNC\server\share`,0,'cli',3);
   insert.run('D','归档','', 'D:/archived',1,'cli',4);
   insert.run('E','代理','', 'D:/agent',0,JSON.stringify({subagent:{thread_spawn:{parent_thread_id:'A'}}}),5);
   const task=await saveAutomation(undefined,{name:'任务',prompt:'检查',threadId:'A',schedule:{frequency:'HOURLY',interval:1}},home);
   const saved=await saveAutomation(task.id,{threadId:'B'},home);
   assert.equal(saved.threadId,'B');assert.equal(saved.threadTitle,'目标会话');assert.equal(saved.threadPath,String.raw`\\?\D:\new-project`);
   const [listed]=await listAutomations(home);assert.equal(listed.threadId,'B');
   const raw=TOML.parse(await fs.readFile(path.join(home,'automations',task.id,'automation.toml'),'utf8'));assert.equal(raw.target_thread_id,'B');assert.equal(raw.status,'ACTIVE');
   await fs.writeFile(path.join(home,'session_index.jsonl'),JSON.stringify({id:'C',thread_name:'索引中的真实名称',updated_at:'2026-10-17T12:00:00Z'})+'\n');
   assert.deepEqual((await listAutomationTargets('new-project',60,home)).threads.map(t=>t.id),['B']);
   assert.deepEqual((await listAutomationTargets('目标',60,home)).threads.map(t=>t.id),['B']);
   const page=await listAutomationTargets('',2,home);assert(page.hasMore);assert.equal(page.threads.length,2);
   const all=await listAutomationTargets('',60,home);assert.equal(all.threads.length,3);assert.equal(all.threads.find(t=>t.id==='C').title,'索引中的真实名称');assert(!all.threads.some(t=>t.title.includes('<heartbeat>')));
   assert.equal(permittedPublicRequest('GET','/api/automations/targets?q=B'),true);assert.equal(permittedPublicRequest('POST','/api/automations/targets'),false);
  }finally{db.close();}
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
test('heartbeat presentation removes control markup and keeps task instructions',()=>{
 const value=scheduledMessage('<heartbeat>\n<automation_id>dxo-xd3</automation_id><current_time_iso>2026-10-05T12:09:38Z</current_time_iso><instructions>检查 DxO &amp; 保留原片</instructions></heartbeat>');
 assert.equal(value.text,'检查 DxO & 保留原片');assert.equal(value.messageSource.automationId,'dxo-xd3');assert.equal(value.messageSource.kind,'schedule');
 assert.equal(scheduledMessage('用户讨论 <heartbeat> 标记'),undefined);
 assert.equal(permittedPublicRequest('PATCH','/api/automations/dxo-xd3'),true);
 assert.equal(permittedPublicRequest('DELETE','/api/automations/dxo-xd3'),false);
 assert.equal(permittedPublicRequest('POST','/api/automations'),true);
});

test('task destinations include current saved names independently of sidebar pages',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-target-'));
 try{
  const task=await saveAutomation(undefined,{name:'任务',prompt:'检查',threadId:'archived-thread',schedule:{frequency:'HOURLY',interval:1}},home);
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  try{
   db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,title TEXT,cwd TEXT,archived INTEGER)');
   db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('archived-thread','实际会话名','旧标题','F:/project',1);
   let [listed]=await listAutomations(home);
   assert.equal(listed.id,task.id);assert.equal(listed.threadTitle,'实际会话名');assert.equal(listed.threadPath,'F:/project');
   db.prepare('UPDATE threads SET name=? WHERE id=?').run('新会话名','archived-thread');
   [listed]=await listAutomations(home);assert.equal(listed.threadTitle,'新会话名');
  }finally{db.close();}
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
