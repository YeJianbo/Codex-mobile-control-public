// Resume a prior isolated real-CLI check without repeating its successful file operations.
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
const [run,agent]=process.argv.slice(2);if(!run||!agent)throw Error('Usage: harness-live-resume.mjs <run directory> <agent>');
process.env.CODEX_MOBILE_CONTROL_HOME=path.join(run,'state');
const {StateStore}=await import('../dist/services/stateStore.js');
const {EventHub}=await import('../dist/services/eventHub.js');
const {SessionManager}=await import('../dist/services/sessionManager.js');
const previous=JSON.parse(await fs.readFile(path.join(run,'results.json'),'utf8')).find(r=>r.agent===agent);
if(!previous?.threadId)throw Error('No recorded isolated thread');
const store=new StateStore();await store.load();const hub=new EventHub(store),manager=new SessionManager(new EventEmitter(),hub,store);
const events=[];hub.subscribe(e=>events.push(e));
try{
 const firstMeta=store.readAgentMeta(previous.threadId);
 await manager.handleClientCommand({type:'turn.start',requestId:randomUUID(),threadId:previous.threadId,permission:'full',text:'只凭本会话记忆，回复本会话 probe.txt 的完整内容。不要调用工具。'});
 const deadline=Date.now()+180000;while(Date.now()<deadline&&!events.some(e=>e.type==='turn.completed'))await new Promise(r=>setTimeout(r,100));
 if(!events.some(e=>e.type==='turn.completed')){await manager.agents.handle({type:'turn.interrupt',threadId:previous.threadId});throw Error('续聊超过 180 秒');}
 while(manager.agents.owns(previous.threadId))await new Promise(r=>setTimeout(r,30));
 const expected=await fs.readFile(path.join(run,agent,'probe.txt'),'utf8');
 const text=events.filter(e=>e.type==='message.delta').map(e=>e.text).join('');
 const result={agent,threadId:previous.threadId,status:events.find(e=>e.type==='turn.completed')?.status,text,resumedSameSession:store.readAgentMeta(previous.threadId)?.session===firstMeta?.session,errors:events.filter(e=>e.type==='error').map(e=>e.message)};
 result.pass=result.status==='completed'&&result.text.includes(expected.trim())&&result.resumedSameSession;
 await fs.writeFile(path.join(run,agent+'-resume.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
}finally{await manager.agents.close();store.close();}
