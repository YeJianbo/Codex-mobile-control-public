// Real installed CLI accounts, isolated project/state, public events only.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';

const base=process.env.CMC_HARNESS_CHECK_ROOT||'D:/codex/build/Codex-mobile-control/harness-live';
await fs.mkdir(base,{recursive:true});
const run=path.join(base,new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(run);
process.env.CODEX_MOBILE_CONTROL_HOME=path.join(run,'state');
const {StateStore}=await import('../dist/services/stateStore.js');
const {EventHub}=await import('../dist/services/eventHub.js');
const {SessionManager}=await import('../dist/services/sessionManager.js');
const store=new StateStore();await store.load();const hub=new EventHub(store);
const codex=new EventEmitter();const manager=new SessionManager(codex,hub,store);
const events=[];hub.subscribe(event=>events.push(event));
const agents=process.argv.slice(2).filter(v=>!v.startsWith('--'));
const results=[];
const wait=async predicate=>{const deadline=Date.now()+150000;while(Date.now()<deadline){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('真实 CLI 会话等待超过 150 秒');};
const turn=async command=>{
  const start=events.length;await manager.handleClientCommand(command);
  const id=command.threadId||events.slice(start).find(e=>e.type==='thread.started'&&e.requestId===command.requestId)?.threadId;
  if(!id)throw Error('未收到会话编号');
  const pid=manager.agents.active.get(id)?.process.pid;
  try{await wait(()=>events.slice(start).find(e=>e.threadId===id&&e.type==='turn.completed'));}
  catch(error){if(manager.agents.owns(id))await manager.agents.handle({type:'turn.interrupt',threadId:id});throw error;}
  await wait(()=>!manager.agents.owns(id));
  return {id,pid,events:events.slice(start).filter(e=>e.threadId===id),meta:store.readAgentMeta(id)};
};
try{
  const models=await manager.agents.models();
  const backends=await manager.agents.backends();
  for(const agent of agents.length?agents:['claude','antigravity','grok','deepseek','hermes']){
    const backend=backends.find(b=>b.agent===agent);
    const result={agent,installed:backend?.installed,available:backend?.available,catalog:models.filter(m=>m.model.startsWith(agent+'::')).map(m=>m.model)};
    try{
      if(!backend?.available)throw Error(backend?.reason||'后端不可用');
      const project=path.join(run,agent);await fs.mkdir(project);
      const marker='CMC_'+randomUUID().replaceAll('-','');
      await fs.writeFile(path.join(project,'probe.txt'),marker+'\n');
      const firstCommand={type:'thread.start',requestId:randomUUID(),projectPath:project,model:agent+'::default',permission:'full',initialText:'这是已授权的本地连通性测试，共有两个必须完成的步骤：1. 用文件工具读取当前目录 probe.txt；2. 用写入工具把原样内容写入当前目录 result.txt。禁止读取其他文件、联网或执行其他任务。未完成第 2 步不可返回最终答复。完成后只回复 probe.txt 的内容。'};
      if(agent==='antigravity'){firstCommand.model='antigravity::gemini-3.8-flash';firstCommand.effort='low';}
      const first=await turn(firstCommand);result.threadId=first.id;
      result.firstStatus=first.events.find(e=>e.type==='turn.completed')?.status;
      result.firstTools=first.events.filter(e=>e.type==='tool.started').length;
      result.firstText=first.events.filter(e=>e.type==='message.delta').map(e=>e.text).join('');
      result.fileMatches=await fs.readFile(path.join(project,'result.txt'),'utf8').then(v=>v.trim()===marker).catch(()=>false);
      result.receipt=(await manager.receipts.get(firstCommand.requestId))?.state;
      const before=events.length;await manager.handleClientCommand(firstCommand);
      result.duplicateStarts=events.slice(before).filter(e=>e.type==='turn.started').length;
      const second=await turn({type:'turn.start',requestId:randomUUID(),threadId:first.id,permission:'full',text:'只凭本会话记忆，回复上一轮 probe.txt 的完整内容。不要调用工具。'});
      result.secondStatus=second.events.find(e=>e.type==='turn.completed')?.status;
      result.secondText=second.events.filter(e=>e.type==='message.delta').map(e=>e.text).join('');
      result.resumedSameSession=!!first.meta?.session&&first.meta.session===second.meta?.session;
      if(agent==='antigravity'){result.firstPid=first.pid;result.secondPid=second.pid;result.reusedProcess=!!first.pid&&first.pid===second.pid;}
      result.actualModel=second.meta?.actualModel;
      result.tokens=second.meta?.tokens;
      result.pass=result.firstStatus==='completed'&&result.secondStatus==='completed'&&result.fileMatches&&result.firstTools>0&&result.firstText.includes(marker)&&result.secondText.includes(marker)&&result.resumedSameSession&&result.receipt==='accepted'&&result.duplicateStarts===0&&(agent!=='antigravity'||result.reusedProcess);
      result.errors=[...first.events,...second.events].filter(e=>e.type==='error').map(e=>e.message);
    }catch(error){result.pass=false;result.error=error.message;}
    results.push(result);await fs.writeFile(path.join(run,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({output:path.join(run,'results.json'),passed:results.filter(r=>r.pass).length,total:results.length}));
  if(results.some(r=>!r.pass))process.exitCode=1;
}finally{await manager.agents.close();store.close();}
