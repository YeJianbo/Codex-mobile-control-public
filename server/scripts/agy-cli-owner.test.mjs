import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execa} from 'execa';

test('Windows gateway death releases its idle AGY worker and child', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-agy-owner-'));
  const cli=path.join(directory,'cli.mjs'),pidFile=path.join(directory,'pid.txt'),parentFile=path.join(directory,'parent.mjs');let parent,childPid;
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  const wait=async fn=>{const until=Date.now()+10000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Owned process condition timed out');};
  try{
    await fs.writeFile(cli,`import fs from 'node:fs';import readline from 'node:readline';fs.writeFileSync(process.argv[2],String(process.pid));readline.createInterface({input:process.stdin}).on('line',()=>process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'fixture'}})+'\\n'));`);
    const module=new URL('../dist/services/agyCli.js',import.meta.url).href;
    await fs.writeFile(parentFile,`import {AgyCliPool} from ${JSON.stringify(module)};const pool=new AgyCliPool();const turn=(await pool.run('owned',process.execPath,process.argv.slice(2),undefined,'{}\\n')).process;await turn;pool.release('owned');console.log('READY');`);
    let output='';parent=execa(process.execPath,[parentFile,cli,pidFile],{windowsHide:true,reject:false,buffer:false});parent.stdout.on('data',chunk=>output+=chunk);
    await wait(()=>output.includes('READY'));childPid=Number(await fs.readFile(pidFile,'utf8'));assert(alive(childPid));
    // Terminate just the owner, without /T; IPC disconnect must reap the grandchild.
    const killed=await execa('taskkill.exe',['/PID',String(parent.pid),'/F'],{windowsHide:true,reject:false});assert.equal(killed.exitCode,0);await parent;
    await wait(()=>!alive(childPid));
  }finally{
    if(parent&&alive(parent.pid))await execa('taskkill.exe',['/PID',String(parent.pid),'/T','/F'],{windowsHide:true,reject:false});
    if(childPid&&alive(childPid))await execa('taskkill.exe',['/PID',String(childPid),'/T','/F'],{windowsHide:true,reject:false});
    assert.equal(path.dirname(directory),os.tmpdir());assert(path.basename(directory).startsWith('cmc-agy-owner-'));await fs.rm(directory,{recursive:true,force:true});
  }
});
