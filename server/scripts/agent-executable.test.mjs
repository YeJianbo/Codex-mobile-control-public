import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findAgentExecutable} from '../src/services/agentExecutable.ts';
import {agentAvailability} from '../public/console-core.js';
const withEnv=async(t,fn)=>{
 const keys=['CODEX_MOBILE_CONTROL_AGY_BIN','LOCALAPPDATA'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const k of keys)delete process.env[k];t.after(()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-agent-path-'));return fn(dir);
};
test('explicit CLI path is absolute and never silently falls back',t=>withEnv(t,async dir=>{
 let calls=0;const discover=async()=>{calls++;return {exitCode:0,stdout:''}};
 for(const value of ['agy.exe',path.join(dir,'missing.exe')]){process.env.CODEX_MOBILE_CONTROL_AGY_BIN=value;await assert.rejects(findAgentExecutable('antigravity',discover),/路径无效/);}
 assert.equal(calls,0);
 const file=path.join(dir,'configured.exe');await fs.writeFile(file,'fixture only');process.env.CODEX_MOBILE_CONTROL_AGY_BIN=file;
 assert.deepEqual(await findAgentExecutable('antigravity',discover),{command:file,source:'configured'});assert.equal(calls,0);
}));
test('PATH discovery uses a validated executable and ignores relative or stale results',t=>withEnv(t,async dir=>{
 const file=path.join(dir,'agy.exe');await fs.writeFile(file,'fixture only');
 const result=await findAgentExecutable('antigravity',async()=>({exitCode:0,stdout:'relative.exe\n'+path.join(dir,'gone.exe')+'\n'+file+'\n'}));
 assert.deepEqual(result,{command:file,source:'path'});
}));
test('Windows AGY falls back to official per-user install without modifying PATH', {skip:process.platform!=='win32'},t=>withEnv(t,async dir=>{
 const before=process.env.PATH;process.env.LOCALAPPDATA=dir;const exe=path.join(dir,'agy','bin','agy.exe');await fs.mkdir(path.dirname(exe),{recursive:true});await fs.writeFile(exe,'fixture only');
 assert.deepEqual(await findAgentExecutable('antigravity',async()=>({exitCode:1,stdout:''})),{command:exe,source:'installed-location'});assert.equal(process.env.PATH,before);
}));
test('missing CLI gives actionable information and does not execute a prompt',t=>withEnv(t,async dir=>{
 process.env.LOCALAPPDATA=dir;await assert.rejects(findAgentExecutable('antigravity',async()=>({exitCode:1,stdout:''})),/CODEX_MOBILE_CONTROL_AGY_BIN/);
}));
test('public support limits have a reason and cannot become selectable from cached models',()=>{
 const models=[{model:'claude::default',available:true}];
 assert.equal(agentAvailability([{agent:'claude',available:false,installed:true,reason:'公网不支持'}],models,'claude').available,false);
 assert.equal(agentAvailability([],models,'claude').available,true);
 assert.equal(agentAvailability([],[{model:'claude::default',available:false}],'claude').available,false);
});
