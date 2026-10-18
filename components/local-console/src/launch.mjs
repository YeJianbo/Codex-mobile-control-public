import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.LOCAL_CONSOLE_PORT||25819);
const origin=`http://127.0.0.1:${port}`;
const healthy=async()=>{try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)});const h=await r.json();return r.ok&&h.application==='local-console';}catch{return false;}};
if(await healthy())console.log(origin);
else {
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const dir=path.join(home,'codexmate','local-console','logs');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'console.log');if(fs.existsSync(file)&&fs.statSync(file).size>1048576)fs.renameSync(file,file+'.previous');
  const fd=fs.openSync(file,'a');
  const child=spawn(process.execPath,[path.join(root,'src/server.mjs'),'--home',home],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});
  child.once('error',()=>{console.error('工作台启动失败');process.exitCode=1;});
  child.unref();fs.closeSync(fd);
  let ok=false;for(let i=0;i<25;i++){if(await healthy()){ok=true;break;}await new Promise(r=>setTimeout(r,400));}
  if(ok)console.log(origin);else {console.error('工作台启动超时，请检查本地 console.log');process.exitCode=1;}
}
