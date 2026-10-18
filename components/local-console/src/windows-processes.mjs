import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';

function powershell(code,input,timeoutMs=45000){return new Promise((resolve,reject)=>{const exe=path.join(process.env.SystemRoot||'C:\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const p=spawn(exe,['-NoProfile','-Command',`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);${code}`],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{p.kill();reject(new Error('Windows 进程操作超时'));},timeoutMs);p.stdout.on('data',d=>{out+=d;if(out.length>4*1024*1024)p.kill();});p.stderr.on('data',d=>{err=(err+d.toString()).slice(0,3000);});p.on('error',()=>{clearTimeout(timer);reject(new Error('无法运行 Windows 进程工具'));});p.on('exit',n=>{clearTimeout(timer);if(n!==0){reject(new Error(`Windows 进程操作失败，退出码 ${n}${err?': '+err.trim().split(/\r?\n\s*(?:所在位置|At line|CategoryInfo|FullyQualifiedErrorId)/i)[0].replace(/\s+/g,' ').slice(0,500):''}`));return;}try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')));}catch{reject(new Error('Windows 进程响应无效'));}});p.stdin.end(JSON.stringify(input||{}));});}
export function desktopTargets(processes,ownPid=process.pid){
  const roots=processes.filter(p=>p.name==='ChatGPT.exe'&&/[/\\]WindowsApps[/\\]OpenAI\.Codex_[^/\\]+[/\\]app[/\\]ChatGPT\.exe$/i.test(p.path||'')&&!/--type=/.test(p.command||''));
  const protectedIds=new Set(processes.filter(p=>p.id===ownPid||/[\\/]tools[\\/]local-console[\\/]/i.test(p.command||'')).map(p=>p.id));
  const result=new Map(roots.map(p=>[p.id,{...p,depth:0}]));let changed=true;
  while(changed){changed=false;for(const p of processes){if(protectedIds.has(p.parent))protectedIds.add(p.id);const parent=result.get(p.parent);if(parent&&!result.has(p.id)&&Date.parse(p.createdAt)>=Date.parse(parent.createdAt)){result.set(p.id,{...p,depth:parent.depth+1});changed=true;}}}
  return [...result.values()].filter(p=>!protectedIds.has(p.id)).sort((a,b)=>b.depth-a.depth);
}
export function sharedBackendTargets(processes,{endpoint,directory,ownPid=process.pid}={}){
  if(!endpoint||!directory||!Number.isInteger(endpoint.bridgePid)||!Number.isInteger(endpoint.serverPid))return [];
  const owner=processes.find(p=>p.id===endpoint.bridgePid),server=processes.find(p=>p.id===endpoint.serverPid);
  const normalized=value=>String(value||'').replaceAll('\\','/').toLowerCase();
  const command=normalized(owner?.command),root=normalized(directory);
  if(!owner||!server||server.parent!==owner.id||!/^node(?:\.exe)?$/i.test(owner.name)||!/^codex(?:\.exe)?$/i.test(server.name))return [];
  if(!command.includes(root+'/shared-backend.mjs')||!command.includes('--serve')||!command.includes(root+'/config.json'))return [];
  if(!/^ws:\/\/127\.0\.0\.1:\d+$/.test(endpoint.url||'')||!server.command?.includes(endpoint.url)||!server.command?.includes('app-server')||!normalized(server.command).includes(root+'/transport-token-'+owner.id))return [];
  const protectedIds=new Set(processes.filter(p=>p.id===ownPid||/[\\/]tools[\\/]local-console[\\/]/i.test(p.command||'')).map(p=>p.id));
  const descendants=new Map([[owner.id,{...owner,depth:0,managedBackend:true}]]);let changed=true;
  while(changed){changed=false;for(const p of processes){
    if(protectedIds.has(p.parent))protectedIds.add(p.id);
    const parent=descendants.get(p.parent);
    if(parent&&!descendants.has(p.id)&&Date.parse(p.createdAt)>=Date.parse(parent.createdAt)){descendants.set(p.id,{...p,depth:parent.depth+1,managedBackend:true});changed=true;}
  }}
  // Stop the owner first so it cannot recreate its child while migration stops it.
  return [descendants.get(owner.id),...[...descendants.values()].filter(p=>p.id!==owner.id).sort((a,b)=>b.depth-a.depth)].filter(p=>!protectedIds.has(p.id));
}
export class WindowsProcesses {
  constructor({bridgeDirectory=path.join(os.homedir(),'.codex-mobile-control','desktop-bridge')}={}){this.bridgeDirectory=bridgeDirectory;}
  async routingSnapshot(){
    const s=await this.snapshot();let endpoint;
    try{endpoint=JSON.parse(fs.readFileSync(path.join(this.bridgeDirectory,'endpoint.json'),'utf8'));}catch{}
    const managed=sharedBackendTargets(s.processes,{endpoint,directory:this.bridgeDirectory});
    const seen=new Set(managed.map(p=>p.id));
    return {...s,targets:[...managed,...s.targets.filter(p=>!seen.has(p.id))]};
  }
  async snapshot(){if(process.platform!=='win32')throw new Error('此操作仅支持 Windows');const r=await powershell(`$appId=(Get-StartApps|Where-Object {$_.AppID -match '^OpenAI\.Codex_[^!]+!App$'}|Select-Object -First 1).AppID;$items=@(Get-CimInstance Win32_Process|ForEach-Object{[pscustomobject]@{id=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;command=$_.CommandLine;createdAt=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''};memoryMB=[math]::Round($_.WorkingSetSize/1MB,1)}});[pscustomobject]@{processes=$items;executable=$appId}|ConvertTo-Json -Depth 4 -Compress`);return {...r,targets:desktopTargets(r.processes)};}
  async apply(targets,action,executable){const script=fs.readFileSync(new URL('./windows-process-apply.ps1',import.meta.url),'utf8');return powershell(script,{targets:targets.map(p=>({id:p.id,createdAt:p.createdAt})),action,executable},80000);}
}
