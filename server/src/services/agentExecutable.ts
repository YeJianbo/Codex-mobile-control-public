import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execa} from 'execa';
import type {Agent} from './agentProtocol.js';

export type CliAgent=Exclude<Agent,'codex'>;
export type AgentExecutable={command:string;args?:string[];source:'configured'|'path'|'installed-location'};
const commands={claude:'claude',antigravity:'agy',grok:'grok',deepseek:'dsh',hermes:'hermes',opencode:'opencode',zcode:'zcode'};
const variables={claude:'CODEX_MOBILE_CONTROL_CLAUDE_BIN',antigravity:'CODEX_MOBILE_CONTROL_AGY_BIN',grok:'CODEX_MOBILE_CONTROL_GROK_BIN',deepseek:'CODEX_MOBILE_CONTROL_DEEPSEEK_BIN',hermes:'CODEX_MOBILE_CONTROL_HERMES_BIN',opencode:'CODEX_MOBILE_CONTROL_OPENCODE_BIN',zcode:'CODEX_MOBILE_CONTROL_ZCODE_BIN'};

export async function findAgentExecutable(agent:CliAgent,discover:typeof execa=execa):Promise<AgentExecutable>{
  const configured=process.env[variables[agent]];
  const valid=async(file:string)=>{
    if(!path.isAbsolute(file))return false;
    if(process.platform==='win32'&&!(agent==='zcode'?/\.(exe|cmd|bat|cjs|js)$/i:/\.(exe|cmd|bat)$/i).test(file))return false;
    return fs.stat(file).then(s=>s.isFile()).catch(()=>false);
  };
  // An explicit but invalid path is an error, never a silent switch to another CLI/account.
  const executable=(file:string,source:AgentExecutable['source']):AgentExecutable=>agent==='zcode'&&/\.(cjs|js)$/i.test(file)?{command:process.execPath,args:[file],source}:{command:file,source};
  if(configured){if(!await valid(configured))throw Error(`${variables[agent]} 的 CLI 路径无效，请指定现有可执行文件的绝对路径`);return executable(configured,'configured');}
  try{
    const result=await discover(process.platform==='win32'?'where.exe':'which',[commands[agent]],{timeout:5000,windowsHide:true,reject:false});
    for(const candidate of result.stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))if(await valid(candidate))return executable(candidate,'path');
  }catch{/* Fall back only to the official per-user installation location. */}
  if(process.platform==='win32'&&agent==='antigravity'){
    const local=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
    const candidate=path.join(local,'agy','bin','agy.exe');
    if(await valid(candidate))return {command:candidate,source:'installed-location'};
  }
  if(process.platform==='win32'&&agent==='opencode'){
    const candidate=path.join(os.homedir(),'.codex','tools','harnesses','opencode','opencode.exe');
    if(await valid(candidate))return {command:candidate,source:'installed-location'};
  }
  if(process.platform==='win32'&&agent==='zcode'){
    const roots=[path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Programs','ZCode'),path.join(process.env.ProgramFiles||'C:/Program Files','ZCode')];
    try{
      const result=await discover('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique"],{timeout:5000,windowsHide:true,reject:false});
      roots.unshift(...result.stdout.split(/\r?\n/).map(s=>s.trim()).filter(s=>path.isAbsolute(s)).map(file=>path.dirname(file)));
    }catch{/* A closed desktop can still use its normal installation directory. */}
    for(const root of roots){const candidate=path.join(root,'resources','glm','zcode.cjs');if(await valid(candidate))return executable(candidate,'installed-location');}
  }
  const managed=path.join(os.homedir(),'.codex','tools','harnesses',commands[agent]+(process.platform==='win32'?'.cmd':''));
  if(await valid(managed))return {command:managed,source:'installed-location'};
  throw Error(`未找到 ${commands[agent]} CLI，请先安装或设置 ${variables[agent]} 的绝对路径`);
}
