import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import {userCodexConfigPath} from './paths.js';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import {desktopThreadSettings} from './desktopSidebar.js';

export type PickerModel = {model:string; displayName:string; modelProvider?:string; providerId?:string; providerName?:string; shortName?:string; supportedReasoningEfforts:{reasoningEffort:string}[]; defaultReasoningEffort?:string};
type ModelCatalog={models:PickerModel[];source:string};
type ModelRpc=Pick<CodexAppServerClient,'request'>;
const catalogs=new WeakMap<ModelRpc,{value?:ModelCatalog;expiresAt:number;pending?:Promise<ModelCatalog>}>();
export async function readModelCatalog(codex: ModelRpc,refresh=false): Promise<ModelCatalog> {
  let entry=catalogs.get(codex);
  if(!entry){entry={expiresAt:0};catalogs.set(codex,entry);}
  // Model validation and multiple connected clients share the same catalog read.
  if(entry.pending)return entry.pending;
  if(!refresh&&entry.value&&entry.expiresAt>Date.now())return entry.value;
  const current=entry;
  current.pending=loadModelCatalog(codex).then(value=>{
    current.value=value;current.expiresAt=Date.now()+5000;return value;
  }).finally(()=>{current.pending=undefined;});
  return current.pending;
}

async function loadModelCatalog(codex: ModelRpc): Promise<ModelCatalog> {
  let config:Record<string,unknown> = {};
  try { config=TOML.parse(await fs.readFile(userCodexConfigPath(),'utf8')); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  if(typeof config.model_catalog_json==='string') {
    const catalogPath=path.resolve(path.dirname(userCodexConfigPath()),config.model_catalog_json);
    const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
    if(!Array.isArray(catalog.models)) throw new Error('桌面模型目录格式无效');
    return appendConsoleRelays({source:'desktop-catalog',models:catalog.models.filter((m:any)=>m.visibility==='list').map((m:any)=>({
      model:m.slug,displayName:m.display_name || m.slug,
      supportedReasoningEfforts:(m.supported_reasoning_levels || []).map((e:any)=>({reasoningEffort:e.effort})),
      defaultReasoningEffort:m.default_reasoning_level,
    }))},config);
  }
  const models:PickerModel[]=[];let cursor:string|null=null;
  do {
    const result=await codex.request('model/list',{includeHidden:false,limit:100,cursor}) as any;
    if(!Array.isArray(result.data)) throw new Error('Codex 未返回有效模型列表');
    models.push(...result.data.filter((m:any)=>!m.hidden));cursor=result.nextCursor || null;
  } while(cursor);
  return appendConsoleRelays({models,source:'app-server'},config);
}

const consoleDirectory=()=>path.join(path.dirname(userCodexConfigPath()),'codexmate','local-console');
async function appendConsoleRelays(catalog:ModelCatalog,config:Record<string,unknown>):Promise<ModelCatalog>{
  // Reuse the installed local relay and its enabled catalog. Neither the
  // desktop catalog nor the user's global provider selection is changed.
  const providers=config.model_providers as Record<string,{base_url?:string}>|undefined;
  const provider=Object.entries(providers||{}).find(([,value])=>{
    try{const url=new URL(value.base_url||'');return ['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname.replace(/\/$/,'')==='/relay/v1'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
  })?.[0];
  if(!provider)return catalog;
  let relay:any;
  try{relay=JSON.parse(await fs.readFile(path.join(consoleDirectory(),'relay-model-catalog.json'),'utf8'));}
  catch{return catalog;}
  if(!Array.isArray(relay.models))return catalog;
  const models=new Map(catalog.models.map(model=>[model.model,model]));
  for(const entry of relay.models){
    if(entry.visibility!=='list'||typeof entry.slug!=='string'||!entry.slug.includes('::'))continue;
    models.set(entry.slug,{model:entry.slug,displayName:entry.display_name||entry.slug,modelProvider:provider,
      supportedReasoningEfforts:(entry.supported_reasoning_levels||[]).map((level:any)=>({reasoningEffort:level.effort})),defaultReasoningEffort:entry.default_reasoning_level});
  }
  return {models:[...models.values()],source:models.size>catalog.models.length?'console-catalog':catalog.source};
}

export async function consoleModelOverrides(codex:ModelRpc,model?:string):Promise<{modelProvider?:string;config?:{model_catalog_json:string}}>{
  if(!model?.includes('::'))return {};
  const entry=(await readModelCatalog(codex)).models.find(entry=>entry.model===model);
  if(!entry?.modelProvider)throw new Error('该中转模型尚未启用，请检查控制台模型设置');
  return {modelProvider:entry.modelProvider,config:{model_catalog_json:path.join(consoleDirectory(),'model-catalog.json')}};
}

export async function consoleResumeOverrides(codex:ModelRpc,threadId:string):Promise<{model?:string;modelProvider?:string;config?:{model_catalog_json:string}}>{
  const model=desktopThreadSettings(threadId)?.model;
  const route=await consoleModelOverrides(codex,model);
  return route.modelProvider?{...route,model}:{};
}

export async function assertAvailableModel(codex:ModelRpc, model?:string) {
  if(model && !(await readModelCatalog(codex)).models.some(m=>m.model===model))
    throw new Error('该模型不在控制台可选列表中，请刷新模型列表');
}
