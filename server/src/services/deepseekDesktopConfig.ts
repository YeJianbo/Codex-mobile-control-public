import {readFileSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'yaml';

const home=()=>process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
export function deepseekConfigStamp():string {
  return ['cordis.patch.yml','profiles/acp/cordis.patch.yml','profiles/desktop/cordis.patch.yml'].map(file=>{
    try{return statSync(path.join(home(),file)).mtimeMs;}catch{return 0;}
  }).join(':');
}

export function deepseekDesktopProviderPatch():unknown[] {
  let text:string;
  try{text=readFileSync(path.join(home(),'profiles/desktop/cordis.patch.yml'),'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  let patches:unknown;
  try{patches=parse(text);}
  catch{throw Error('DeepSeek 桌面供应商配置无法解析，请检查桌面设置');}
  if(!Array.isArray(patches))return [];
  // Desktop UI plugins must stay in the desktop process. Its native provider
  // patches can be applied to ACP without copying credentials or user files.
  return patches.filter(entry=>entry&&typeof entry==='object'&&
    (typeof entry.name==='string'&&entry.name.startsWith('@deepseek-ai/dsh-llm-')||
     typeof entry.id==='string'&&entry.id.startsWith('llm-')));
}

export function deepseekDesktopReasoningModels(){
  const result=new Map<string,{efforts:string[];defaultEffort?:string}>();
  const order=['off','minimal','low','medium','high','xhigh','max'];
  for(const patch of deepseekDesktopProviderPatch() as any[]){
    if(patch.id!=='llm-pi-ai'&&patch.name!=='@deepseek-ai/dsh-llm-pi-ai')continue;
    for(const [provider,config] of Object.entries(patch.config?.providers||{}) as [string,any][]){
      for(const model of config.models||[]){
        const declared=model.reasoningEfforts;
        if(!declared||typeof declared!=='object'||typeof model.id!=='string')continue;
        const efforts=order.filter(level=>Object.hasOwn(declared,level)&&(typeof declared[level]==='string'||level==='off'&&declared[level]===null));
        if(efforts.length)result.set(JSON.stringify([provider,model.id]),{efforts,...(efforts.includes(config.reasoning)?{defaultEffort:config.reasoning}:{})});
      }
    }
  }
  return result;
}

export function canonicalDeepseekModel(value:string):string{
  const declared=deepseekDesktopReasoningModels();
  if(declared.has(value))return value;
  try{
    const tuple=JSON.parse(value);
    if(!Array.isArray(tuple)||tuple.length!==2)return value;
    const matches=[...declared.keys()].filter(key=>JSON.parse(key)[1]===tuple[1]);
    return matches.length===1?matches[0]:value;
  }catch{return value;}
}
