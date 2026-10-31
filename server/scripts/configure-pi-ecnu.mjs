import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deepseekDesktopProviderPatch} from '../dist/services/deepseekDesktopConfig.js';

const home=process.env.PI_CODING_AGENT_DIR||path.join(os.homedir(),'.pi','agent');
const provider=deepseekDesktopProviderPatch().map(row=>row.config?.providers?.ecnu).find(Boolean);
if(!provider||provider.apiKeyEnv!=='ECNU_API_KEY'||!['openai-responses','openai-completions'].includes(provider.api))throw Error('未找到兼容的 ECNU 供应商配置');
const url=new URL(provider.baseURL);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('ECNU 服务地址无效');
const read=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}};
const modelFile=path.join(home,'models.json'),settingsFile=path.join(home,'settings.json');
const current=await read(modelFile),settings=await read(settingsFile);
if(!current||typeof current!=='object'||Array.isArray(current)||!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Pi 配置格式无效');
const previous=current.providers?.ecnu?.models||[];
const models=(provider.models||[]).filter(model=>typeof model.id==='string'&&model.id).map(model=>({
  ...previous.find(entry=>entry.id===model.id),id:model.id,name:model.name||model.id,
  ...(Array.isArray(model.input)?{input:model.input}:{}),
  ...(Number.isFinite(model.contextWindow)?{contextWindow:model.contextWindow}:{}),
  ...(['ecnu-max','ecnu-plus'].includes(model.id)?{reasoning:true,thinkingLevelMap:{off:'none',minimal:null,low:'low',medium:model.id==='ecnu-max'?'high':'medium',high:null,xhigh:model.id==='ecnu-max'?'max':'xhigh',max:null}}:{}),
}));
if(!models.length)throw Error('ECNU 未提供模型目录');
for(const existing of previous)if(!models.some(model=>model.id===existing.id))models.push(existing);
await fs.mkdir(home,{recursive:true});
async function save(file,value){
  const temp=file+'.cmc.tmp';
  await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await fs.rename(temp,file);
}
await save(modelFile,{...current,providers:{...current.providers,ecnu:{...current.providers?.ecnu,baseUrl:provider.baseURL,api:provider.api,...(provider.compat?{compat:provider.compat}:{}),apiKey:'$ECNU_API_KEY',models}}});
await save(settingsFile,{...settings,...(!settings.defaultProvider&&!settings.defaultModel?{defaultProvider:'ecnu',defaultModel:models.find(model=>model.id==='ecnu-max')?.id||models[0].id}:{})});
console.log(`Pi ECNU 模型已配置：${models.map(model=>model.id).join('、')}`);
