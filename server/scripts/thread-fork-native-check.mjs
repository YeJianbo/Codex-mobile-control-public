import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {EventEmitter,once} from 'node:events';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {resolveDesktopCli} from './desktop-cli-resolver.mjs';

// Real CLI protocol check using synthetic local history, never a live user thread.
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-native-fork-'));
const previousHome=process.env.CODEX_HOME,previousMobile=process.env.CODEX_MOBILE_CONTROL_HOME;
let child;
try{
  const codexHome=path.join(home,'codex'),workspace=path.join(home,'workspace');
  await fs.mkdir(codexHome);await fs.mkdir(workspace);
  const seedId=randomUUID(),timestamp=new Date().toISOString(),seedFile=path.join(codexHome,'fixture.jsonl');
  const record=(type,payload)=>JSON.stringify({timestamp,type,payload});
  await fs.writeFile(seedFile,[
    record('session_meta',{id:seedId,timestamp,cwd:workspace,originator:'codex_cli_rs',cli_version:'0.162.0',source:'cli',model_provider:'fixture'}),
    record('turn_context',{cwd:workspace,approval_policy:'never',sandbox_policy:{type:'read-only'},model:'fixture',effort:'low',summary:'auto'}),
    record('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Isolated fixture context'}]}),
    record('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'Isolated fixture answer'}]}),
  ].join('\n')+'\n');
  await fs.writeFile(path.join(codexHome,'config.toml'),'model="fixture"\nmodel_provider="fixture"\napproval_policy="never"\n[model_providers.fixture]\nname="fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\n');
  process.env.CODEX_HOME=codexHome;process.env.CODEX_MOBILE_CONTROL_HOME=path.join(home,'mobile');
  const executable=await resolveDesktopCli();
  child=spawn(executable,['app-server'],{cwd:workspace,env:{...process.env,CODEX_HOME:codexHome},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const rpc=new EventEmitter(),pending=new Map(),requests=[];let next=0,stderr='';
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-12000)});
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}
    if(message.id===undefined||message.method)return;
    const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);
    if(message.error)entry.reject(Object.assign(Error(message.error.message),{code:message.error.code}));else entry.resolve(message.result);
  });
  rpc.request=(method,params)=>new Promise((resolve,reject)=>{
    const id=++next;requests.push({method,params});
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method+'; '+stderr))},15000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  await rpc.request('initialize',{clientInfo:{name:'cmc_fork_check',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const parent=await rpc.request('thread/resume',{threadId:seedId,path:seedFile,excludeTurns:true});
  assert(parent.thread?.id);
  await assert.rejects(rpc.request('thread/fork',{threadId:parent.thread.id,ephemeral:true,excludeTurns:true,deferGoalContinuation:true}),error=>error.code===-32600&&error.message.includes('deferGoalContinuation'));
  const {SessionManager}=await import('../dist/services/sessionManager.js');
  const store={threads:[{id:parent.thread.id,title:'isolated parent',projectPath:workspace,status:'idle'}],approvals:[],
    isThreadHidden:()=>false,isEphemeral(id){return this.threads.some(thread=>thread.id===id&&thread.ephemeral)},
    dropEphemeral(id){this.threads=this.threads.filter(thread=>thread.id!==id)},
    async upsertThread(thread){const row={...this.threads.find(t=>t.id===thread.id),...thread};this.threads=this.threads.filter(t=>t.id!==thread.id);this.threads.push(row);return row;}};
  const sessions=new SessionManager(rpc,{publish(){}},store,()=>new Map());
  const side=await sessions.forkThread(parent.thread.id,{ephemeral:true});
  assert.equal(side.thread.ephemeral,true);assert.notEqual(side.thread.id,parent.thread.id);
  await sessions.closeSideThread(side.thread.id);
  const fork=await sessions.forkThread(parent.thread.id,{ephemeral:false});
  assert.notEqual(fork.thread.id,parent.thread.id);
  assert.equal(requests.some(row=>row.method==='turn/start'),false);
  console.log(JSON.stringify({ok:true,realCli:true,isolatedHome:true,previousCombinationRejected:true,sideCreated:true,sideClosed:true,persistentFork:true,modelRequests:0}));
}finally{
  if(child){const exited=once(child,'exit');child.stdin.end();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1500))]);if(child.exitCode===null){child.kill();await exited;}}
  if(previousHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousHome;
  if(previousMobile===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousMobile;
  assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
}
