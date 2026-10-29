import fs from 'node:fs';
import path from 'node:path';
import {appHome} from './paths.js';
import type {AgentExecutable} from './agentExecutable.js';

export function sharedZcodeProxy(executable:AgentExecutable){
  const configPath=process.env.CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG||path.join(appHome(),'zcode-bridge','config.json');
  let config:any;
  try{config=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(config.enabled!==true)return;
  const key=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
  const cli=executable.args?.[0]||executable.command;
  if(typeof config.cli!=='string'||key(config.cli)!==key(cli))throw Error('ZCode 安装路径已变化，请重新绑定共享后端');
  if(typeof config.proxyPath!=='string'||!path.isAbsolute(config.proxyPath)||!fs.existsSync(config.proxyPath))throw Error('ZCode 共享后端入口不存在');
  return {command:process.execPath,args:[config.proxyPath,'--role','gateway','--config',configPath]};
}
