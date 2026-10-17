import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureSharedBackend} from './shared-backend.mjs';
import {CodexAppServerClient} from '../dist/codex/appServerClient.js';
import WebSocket from 'ws';

const root=fileURLToPath(new URL('../',import.meta.url));
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-daemon-'));
const directory=path.join(home,'desktop-bridge'),configPath=path.join(directory,'config.json');
await fs.mkdir(directory);await fs.mkdir(path.join(home,'codex'));
process.env.CODEX_MOBILE_CONTROL_HOME=home;process.env.CODEX_HOME=path.join(home,'codex');
for(const name of ['desktop-bridge.mjs','shared-backend.mjs','desktop-cli-resolver.mjs'])await fs.copyFile(path.join(root,'scripts',name),path.join(directory,name));
await fs.writeFile(configPath,JSON.stringify({realCli:process.argv[2],node:process.execPath,bridgeScript:path.join(directory,'desktop-bridge.mjs'),gatewayRoot:root}));
await fs.writeFile(path.join(directory,'enabled.json'),'{}');
const gateway=new CodexAppServerClient();let desktop=null;
async function launchDesktop(){
  const process=spawn(globalThis.process.execPath,[path.join(directory,'desktop-bridge.mjs'),configPath,'app-server'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stderr='';process.stderr.on('data',data=>stderr+=data.toString());
  const response=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('desktop initialize timeout: '+stderr)),30000);
    readline.createInterface({input:process.stdout}).on('line',line=>{const value=JSON.parse(line);if(value.id===1){clearTimeout(timer);value.error?reject(Error(JSON.stringify(value.error))):resolve(value.result);}});
    process.once('exit',code=>{clearTimeout(timer);reject(Error(`desktop exited ${code}: ${stderr}`));});
  });
  process.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'daemon_check',version:'1'},capabilities:{experimentalApi:true}}})+'\n');
  await response;return process;
}
async function closeDesktop(){if(!desktop)return;const closed=new Promise(resolve=>desktop.once('exit',resolve));desktop.stdin.end();await closed;desktop=null;}
try{
  await gateway.start();const first=await ensureSharedBackend(configPath);
  assert.equal(first.mode,'daemon');assert((await gateway.request('config/read',{})).config);
  for(const url of [first.url,first.desktopUrl,first.approvalUrl]){
    const denied=await new Promise(resolve=>{const socket=new WebSocket(url);socket.on('error',()=>resolve(true));socket.on('open',()=>{socket.close();resolve(false);});});
    assert.equal(denied,true,'every shared listener must require authentication');
  }
  console.log('gateway starts authenticated daemon without desktop');
  desktop=await launchDesktop();assert.equal((await ensureSharedBackend(configPath)).serverPid,first.serverPid);
  await closeDesktop();assert((await gateway.request('config/read',{})).config);
  assert.equal((await ensureSharedBackend(configPath)).serverPid,first.serverPid);
  console.log('desktop attaches to same backend; desktop exit preserves backend');
  const thread=await gateway.request('thread/start',{cwd:home,sandbox:'read-only',approvalPolicy:'never'});
  await gateway.request('thread/settings/update',{threadId:thread.thread.id,serviceTier:'fast'});
  await gateway.request('thread/settings/update',{threadId:thread.thread.id,serviceTier:null});
  await gateway.request('thread/unsubscribe',{threadId:thread.thread.id});
  console.log('real Fast on/off requests accepted in isolated Codex home');
  process.kill(first.serverPid);
  const deadline=Date.now()+30000;let recovered=null;
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,500));
    try{const endpoint=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));if(endpoint.serverPid!==first.serverPid){await gateway.request('config/read',{});recovered=endpoint;break;}}catch{}
  }
  assert(recovered,'backend must restart after child exit');assert.equal(recovered.bridgePid,first.bridgePid);
  desktop=await launchDesktop();assert.equal((await ensureSharedBackend(configPath)).serverPid,recovered.serverPid);await closeDesktop();
  console.log('daemon restarts failed backend; gateway reconnects; desktop rejoins same replacement');
}finally{
  await closeDesktop();await gateway.stop();
  // Only the processes created under this isolated test directory are stopped.
  let endpoint;try{endpoint=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'));}catch{}
  if(endpoint){for(const pid of [endpoint.bridgePid,endpoint.serverPid])try{process.kill(pid);}catch{}}
  console.log('test artifacts:',home);
}
