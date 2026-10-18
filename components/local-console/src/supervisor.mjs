import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GatewayService,portListening} from './gateway.mjs';
import {PublicServices} from '../gateway/scripts/public-services.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=path.resolve(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
const port=Number(process.env.LOCAL_CONSOLE_PORT||25819);
const origin=`http://127.0.0.1:${port}`;
const stateDir=path.join(home,'codexmate','local-console');
const lockFile=path.join(stateDir,'supervisor.lock');
const logFile=path.join(stateDir,'logs','supervisor.log');
const intervalMs=Math.max(5000,Number(process.env.LOCAL_CONSOLE_GUARD_INTERVAL_MS||10000));
const retryDelays=[5000,15000,30000,60000,120000,300000];
let stopping=false,timer=null;
let consolePending=null;
const retry={console:{failures:0,nextAt:0},gateway:{failures:0,nextAt:0},publicEntry:{failures:0,nextAt:0},tunnel:{failures:0,nextAt:0}};

function writeLog(event,details={}){
  fs.mkdirSync(path.dirname(logFile),{recursive:true});
  if(fs.existsSync(logFile)&&fs.statSync(logFile).size>1048576){
    fs.rmSync(logFile+'.previous',{force:true});
    fs.renameSync(logFile,logFile+'.previous');
  }
  fs.appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');
}
function pidAlive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function acquireLock(){
  fs.mkdirSync(stateDir,{recursive:true});
  try{
    const old=JSON.parse(fs.readFileSync(lockFile,'utf8'));
    if(Number.isInteger(old.pid)&&pidAlive(old.pid))return false;
  }catch{}
  fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'w'});
  return true;
}
function releaseLock(){try{const lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));if(lock.pid===process.pid)fs.rmSync(lockFile,{force:true});}catch{}}
async function consoleHealthy(){
  try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(1500)});const h=await r.json();return r.ok&&h.application==='local-console';}catch{return false;}
}
async function waitFor(check,attempts=20){for(let i=0;i<attempts;i++){if(await check())return true;await new Promise(r=>setTimeout(r,500));}return false;}
function failed(name,error){
  const state=retry[name];state.failures++;
  state.nextAt=Date.now()+retryDelays[Math.min(state.failures-1,retryDelays.length-1)];
  writeLog(name+'-restart-failed',{failures:state.failures,retryAt:new Date(state.nextAt).toISOString(),error:error?.message||String(error)});
}
function recovered(name){
  const state=retry[name];
  if(state.failures)writeLog(name+'-recovered',{failures:state.failures});
  state.failures=0;state.nextAt=0;
}
async function ensureConsole(){
  if(consolePending)return consolePending;
  consolePending=restoreConsole();
  try{return await consolePending;}finally{consolePending=null;}
}
async function restoreConsole(){
  if(await consoleHealthy()){recovered('console');return true;}
  if(Date.now()<retry.console.nextAt)return false;
  try{
    if(await portListening(port))throw new Error('控制台端口仍有服务监听，但健康检查未通过，暂不启动新实例');
    writeLog('console-restart-requested');
    const fd=fs.openSync(path.join(stateDir,'logs','console.log'),'a');
    try{
      const child=spawn(process.execPath,[path.join(root,'src','server.mjs'),'--home',home],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});
      child.unref();
    }finally{fs.closeSync(fd);}
    if(!await waitFor(consoleHealthy))throw new Error('控制台健康检查超时');
    recovered('console');writeLog('console-restarted');return true;
  }catch(e){failed('console',e);return false;}
}
const gateway=new GatewayService({root:path.join(root,'gateway'),codexHome:home});
const publicServices=new PublicServices({root:path.join(root,'gateway'),mobileHome:path.dirname(gateway.configFile)});
async function ensurePublicService(name,check,start){
  if(!publicServices.configured())return true;
  if(await check()){recovered(name);return true;}
  if(Date.now()<retry[name].nextAt)return false;
  // Tunnel recovery waits for its two relays, independently of Gateway startup.
  if(name==='tunnel'&&!await publicServices.entryHealthy())return false;
  writeLog(name+'-restart-requested');
  try{const result=await start();recovered(name);writeLog(name+'-restarted',{pid:result.pid});return true;}
  catch(e){failed(name,e);return false;}
}
async function ensureGateway(){
  if((await gateway.status()).running){recovered('gateway');return true;}
  if(Date.now()<retry.gateway.nextAt)return false;
  writeLog('gateway-restart-requested');
  try{await gateway.ensure();recovered('gateway');writeLog('gateway-restarted');return true;}
  catch(e){failed('gateway',e);return false;}
}
async function check(){
  // Neither listener should wait for the other service's startup or retry backoff.
  const results=await Promise.allSettled([
    ensureConsole(),ensureGateway(),
    ensurePublicService('publicEntry',()=>publicServices.entryHealthy(),()=>publicServices.ensureEntry()),
    ensurePublicService('tunnel',()=>publicServices.tunnelHealthy(),()=>publicServices.ensureTunnel()),
  ]);
  for(const result of results)if(result.status==='rejected')writeLog('check-failed',{error:result.reason?.message||String(result.reason)});
}
async function loop(){
  if(stopping)return;
  try{await check();}catch(e){writeLog('check-failed',{error:e?.message||String(e)});}
  if(!stopping)timer=setTimeout(loop,intervalMs);
}
function close(code=0){if(stopping)return;stopping=true;clearTimeout(timer);releaseLock();process.exit(code);}

if(!acquireLock())process.exit(0);
writeLog('supervisor-started',{pid:process.pid,intervalMs,services:['console','gateway','publicEntry','tunnel']});
process.on('SIGINT',()=>close(0));process.on('SIGTERM',()=>close(0));
process.on('uncaughtException',e=>{writeLog('supervisor-crashed',{error:e.message});close(1);});
process.on('unhandledRejection',e=>{writeLog('supervisor-crashed',{error:e?.message||String(e)});close(1);});
await check();
if(process.argv.includes('--once'))close(0);else timer=setTimeout(loop,intervalMs);
