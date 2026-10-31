import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {deepseekDesktopProviderPatch} from './deepseekDesktopConfig.js';

// Resolve the existing DSH credential in memory; never copy it to Pi's config.
export async function piEcnuEnvironment():Promise<Record<string,string>>{
  const piHome=process.env.PI_CODING_AGENT_DIR||path.join(os.homedir(),'.pi','agent');
  let config:any;
  try{config=JSON.parse(await fs.readFile(path.join(piHome,'models.json'),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('Pi 模型配置无法读取');}
  const configured=config?.providers?.ecnu;
  if(!configured||configured.apiKey!=='$ECNU_API_KEY')return {};
  const ecnu=(deepseekDesktopProviderPatch() as any[]).flatMap(p=>Object.entries(p.config?.providers||{})).find(([name])=>name==='ecnu')?.[1] as any;
  if(!ecnu||ecnu.apiKeyEnv!=='ECNU_API_KEY'||configured.baseUrl!==ecnu.baseURL)throw Error('Pi 的 ECNU 配置与 DeepSeek 供应商不一致，请重新配置');
  const wrapper=process.env.CODEX_MOBILE_CONTROL_DEEPSEEK_BIN||path.join(os.homedir(),'.codex','tools','harnesses','dsh.cmd');
  let source='';try{source=await fs.readFile(wrapper,'utf8');}catch{throw Error('未找到 DeepSeek 凭据组件');}
  const entry=source.match(/"([^"\r\n]+[\\/]lib[\\/]bin\.js)"/i)?.[1];
  if(!entry)throw Error('无法定位 DeepSeek 凭据组件');
  const require=createRequire(path.join(path.dirname(path.dirname(entry)),'package.json'));
  const load=(name:string)=>import(pathToFileURL(require.resolve(name)).href);
  const [{Context},{LocalCredentialProvider},{createLaunchEnvironmentSnapshot}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-credentials-local'),load('@deepseek-ai/dsh-launch-environment')]);
  const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
  let userEnv:NodeJS.Dict<string>={};try{userEnv=parseEnv(await fs.readFile(path.join(home,'.env'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('无法读取 DeepSeek 环境配置');}
  const context=new Context();
  try{
    context.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:process.env},{source:'user-env',values:userEnv}]));
    await context.plugin(LocalCredentialProvider,{dshHome:home,watch:false}).await();
    const value=(await context.credentials.resolve('ECNU_API_KEY'))?.value;
    if(typeof value!=='string'||!value.trim())throw Error('ECNU 凭据不可用，请在 DeepSeek 账号设置中检查');
    return {ECNU_API_KEY:value};
  }finally{await context.fiber.dispose();}
}
