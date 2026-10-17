import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {officialAcpExecutable} from '../dist/services/claudeAcp.js';

const agent=process.argv[2];
if(!['claude','antigravity'].includes(agent))throw Error('Expected claude or antigravity');
const exe=officialAcpExecutable(agent);
const child=spawn(exe.command,exe.args,{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
let sequence=0;const pending=new Map();
child.stderr.on('data',()=>{});
const reader=createInterface({input:child.stdout});
reader.on('line',line=>{let value;try{value=JSON.parse(line)}catch{return}if(value.method){if(value.id!==undefined)child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:value.id,error:{code:-32601,message:'Probe supplies no client services'}})+'\n');return}const job=pending.get(value.id);if(job){pending.delete(value.id);clearTimeout(job.timer);job.resolve(value)}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},60000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
try{
  const init=await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'codex-mobile-control-probe',version:'0.6.0'}});
  console.log(JSON.stringify({agent,initialize:{errorCode:init.error?.code,agentInfo:init.result?.agentInfo,capabilities:init.result?.agentCapabilities,authMethods:init.result?.authMethods?.map(x=>x.id)}}));
  if(init.result){const result=await request('session/new',{cwd:process.cwd(),mcpServers:[]});console.log(JSON.stringify({agent,sessionNew:{errorCode:result.error?.code,created:!!result.result?.sessionId,modes:result.result?.modes,models:result.result?.models,configOptions:result.result?.configOptions}}))}
}finally{
  // No authenticate, load, prompt, or cancellation of any existing session.
  if(child.pid){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(resolve=>killer.once('close',resolve))}
  reader.close();for(const job of pending.values())clearTimeout(job.timer);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
}
