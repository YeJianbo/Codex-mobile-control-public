import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const requiredFiles=['codex.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe'];
async function complete(directory){
  try{return (await Promise.all(requiredFiles.map(name=>fs.stat(path.join(directory,name))))).every(stat=>stat.isFile()&&stat.size>0);}
  catch{return false;}
}

export async function selectDesktopCli(packageDirectories,cacheRoot,fallback){
  // Desktop can start the bridge before extracting its new hashed cache.
  for(const directory of packageDirectories){
    if(await complete(directory))return path.join(directory,'codex.exe');
  }
  let candidates=[];
  try{
    candidates=await Promise.all((await fs.readdir(cacheRoot,{withFileTypes:true}))
      .filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.'))
      .map(async entry=>{
        const directory=path.join(cacheRoot,entry.name);
        if(!await complete(directory))return null;
        const executable=path.join(directory,'codex.exe');
        return {executable,modified:(await fs.stat(executable)).mtimeMs};
      }));
  }catch{}
  const newest=candidates.filter(Boolean).sort((a,b)=>b.modified-a.modified)[0];
  if(newest)return newest.executable;
  if(fallback&&await complete(path.dirname(fallback)))return fallback;
  throw Error('No complete Codex Desktop CLI installation found');
}

export async function resolveDesktopCli(fallback){
  if(process.platform!=='win32')return fallback;
  let packageDirectories=[];
  try{
    const {stdout}=await promisify(execFile)('powershell.exe',[
      '-NoProfile','-NonInteractive','-Command',
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | ForEach-Object { Join-Path $_.InstallLocation "app\\resources" }',
    ],{windowsHide:true,timeout:10000,maxBuffer:65536});
    packageDirectories=stdout.trim().split(/\r?\n/).filter(Boolean);
  }catch{}
  return selectDesktopCli(packageDirectories,path.join(process.env.LOCALAPPDATA||'','OpenAI','Codex','bin'),fallback);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.stdout.write(await resolveDesktopCli(process.argv[2]));}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
