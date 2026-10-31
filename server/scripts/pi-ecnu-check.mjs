import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {harnessAcp} from '../dist/services/harnessAcp.js';

const original=process.env.PI_CODING_AGENT_DIR||path.join(os.homedir(),'.pi','agent');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-pi-ecnu-'));
await fs.copyFile(path.join(original,'models.json'),path.join(dir,'models.json'));
await fs.copyFile(path.join(original,'settings.json'),path.join(dir,'settings.json'));
process.env.PI_CODING_AGENT_DIR=dir;
const command=path.join(os.homedir(),'.codex','tools','harnesses','pi','node_modules','.bin',process.platform==='win32'?'pi-acp.cmd':'pi-acp');
try{
  const task=harnessAcp({agent:'pi',command,cwd:dir,model:'ecnu/ecnu-max',permission:'full',content:[{type:'text',text:'Reply with OK. Do not use tools.'}],approve:async()=>false});
  let received=false,buffer='';task.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const row=JSON.parse(line);if(row.type==='assistant'&&row.message?.content?.some(item=>item.type==='text'&&item.text?.trim()))received=true;}catch{}}});
  const timer=setTimeout(()=>void task.interrupt(),45000);
  const result=await task;clearTimeout(timer);
  if(result.exitCode!==0||!received)throw Error('ECNU 未返回有效回复');
  console.log('Pi ECNU 请求成功');
}finally{
  const relative=path.relative(os.tmpdir(),dir);
  if(relative.startsWith('cmc-pi-ecnu-')&&!relative.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});
}
