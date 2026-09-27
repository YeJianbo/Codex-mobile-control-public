import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import {userCodexConfigPath} from './paths.js';
import type {CodexAppServerClient} from '../codex/appServerClient.js';

export type PickerModel = {model:string; displayName:string; supportedReasoningEfforts:{reasoningEffort:string}[]; defaultReasoningEffort?:string};
export async function readModelCatalog(codex: CodexAppServerClient): Promise<{models:PickerModel[];source:string}> {
  let config:Record<string,unknown> = {};
  try { config=TOML.parse(await fs.readFile(userCodexConfigPath(),'utf8')); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  if(typeof config.model_catalog_json==='string') {
    const catalogPath=path.resolve(path.dirname(userCodexConfigPath()),config.model_catalog_json);
    const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
    if(!Array.isArray(catalog.models)) throw new Error('桌面模型目录格式无效');
    return {source:'desktop-catalog',models:catalog.models.filter((m:any)=>m.visibility==='list').map((m:any)=>({
      model:m.slug,displayName:m.display_name || m.slug,
      supportedReasoningEfforts:(m.supported_reasoning_levels || []).map((e:any)=>({reasoningEffort:e.effort})),
      defaultReasoningEffort:m.default_reasoning_level,
    }))};
  }
  const models:PickerModel[]=[];let cursor:string|null=null;
  do {
    const result=await codex.request('model/list',{includeHidden:false,limit:100,cursor}) as any;
    if(!Array.isArray(result.data)) throw new Error('Codex 未返回有效模型列表');
    models.push(...result.data.filter((m:any)=>!m.hidden));cursor=result.nextCursor || null;
  } while(cursor);
  return {models,source:'app-server'};
}

export async function assertAvailableModel(codex:CodexAppServerClient, model?:string) {
  if(model && !(await readModelCatalog(codex)).models.some(m=>m.model===model))
    throw new Error('该模型不在桌面 Codex 的可选列表中，请刷新模型列表');
}
