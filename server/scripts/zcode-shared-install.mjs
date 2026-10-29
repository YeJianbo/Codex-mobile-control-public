import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const marker='// Codex Mobile Control: shared ZCode entry.';
export async function installSharedZcode({cli,gatewayRoot,configPath,enabled=true}){
  cli=path.resolve(cli);gatewayRoot=path.resolve(gatewayRoot);
  configPath=path.resolve(configPath||path.join(process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control'),'zcode-bridge','config.json'));
  if(path.extname(cli)!=='.cjs')throw Error('共享入口仅支持 ZCode 自带的 zcode.cjs');
  const nativePath=path.join(path.dirname(cli),'zcode.mobile-native.cjs');
  let previous;try{previous=JSON.parse(await fs.readFile(configPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const entry=await fs.readFile(cli,'utf8'),wrapped=entry.startsWith(marker);
  if(!enabled){
    if(wrapped)await fs.copyFile(nativePath,cli);
    if(previous)await fs.writeFile(configPath,JSON.stringify({...previous,enabled:false},null,2));
    return {enabled:false,cli,configPath};
  }
  const proxyPath=path.join(gatewayRoot,'scripts','zcode-shared-proxy.mjs');
  for(const file of [proxyPath,path.join(gatewayRoot,'scripts','zcode-shared-backend.mjs'),path.join(gatewayRoot,'package.json')])await fs.access(file);
  // Keep the unmodified native bundle in the same directory for its relative resources.
  // An official update replaces the entry; rebinding refreshes this one rollback copy.
  if(!wrapped)await fs.copyFile(cli,nativePath);else await fs.access(nativePath);
  const appHome=path.dirname(path.dirname(configPath)),gatewaySessions=new Set(),desktopSessions=new Set();
  const readIds=(file,sql,ids)=>{
    if(!existsSync(file))return;
    let db;try{db=new DatabaseSync(file,{readOnly:true});for(const row of db.prepare(sql).all())if(row.id)ids.add(row.id);}finally{db?.close();}
  };
  readIds(path.join(appHome,'state.sqlite'),"SELECT json_extract(a.payload,'$.session') id FROM agent_sessions a JOIN threads t ON a.id=t.id WHERE a.id LIKE 'zcode-%' AND t.status='running'",gatewaySessions);
  const zhome=path.join(process.env.ZCODE_DATA_BASE_DIR||os.homedir(),'.zcode');
  readIds(path.join(zhome,'v2','tasks-index.sqlite'),"SELECT task_id id FROM tasks WHERE task_status='running' AND deleted=0",desktopSessions);
  let processes=[];
  if(process.platform==='win32'){
    const command="Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app-server*--stdio*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const value=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true})||'[]');
    processes=(Array.isArray(value)?value:[value]).filter(row=>row&&[cli,nativePath].some(file=>row.CommandLine.toLowerCase().includes(file.toLowerCase())));
  }
  const env={};
  for(const [name,value]of Object.entries(process.env))if(name.startsWith('ZCODE_')&&typeof value==='string')env[name]=value;
  const provider=path.resolve(path.dirname(cli),'../config/provider/zcode-builtin.json');
  if(!env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE)env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=provider;
  if(!env.ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE)env.ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE=provider;
  const legacyOwners={};
  for(const id of new Set([...gatewaySessions,...desktopSessions])){
    legacyOwners[id]=processes.filter(row=>/--surface(?:=|\s+)["']?desktop/.test(row.CommandLine)?desktopSessions.has(id):gatewaySessions.has(id)).map(row=>row.ProcessId);
  }
  const config={enabled:true,gatewayRoot,cli,proxyPath,command:process.execPath,args:[nativePath],env,
    legacyPids:wrapped?previous?.legacyPids||[]:processes.map(row=>row.ProcessId),legacySessions:wrapped?previous?.legacySessions||[]:Object.keys(legacyOwners),legacyOwners:wrapped?previous?.legacyOwners||{}:legacyOwners};
  await fs.mkdir(path.dirname(configPath),{recursive:true});
  if(!previous)await fs.writeFile(configPath+'.before',JSON.stringify({enabled:false,cli,nativePath},null,2),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await fs.writeFile(configPath+'.pending',JSON.stringify(config,null,2),{mode:0o600});await fs.rename(configPath+'.pending',configPath);
  const wrapper=await fs.readFile(new URL('./zcode-desktop-entry.cjs',import.meta.url));
  await fs.writeFile(cli+'.pending',wrapper);await fs.rename(cli+'.pending',cli);
  return {enabled:true,cli,configPath,legacyProcesses:config.legacyPids.length,legacySessions:config.legacySessions.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=name=>args.indexOf(name)<0?undefined:args[args.indexOf(name)+1];
  const cli=value('--cli');if(!cli)throw Error('请指定 --cli ZCode 原生 CLI 路径');
  const result=await installSharedZcode({cli,gatewayRoot:value('--gateway-root')||path.dirname(path.dirname(fileURLToPath(import.meta.url))),configPath:value('--config'),enabled:!args.includes('--disable')});
  console.log(JSON.stringify(result));
}
