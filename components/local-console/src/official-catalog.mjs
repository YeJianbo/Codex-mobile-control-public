import path from 'node:path';
import {OFFICIAL,officialModels,readJson,atomicWrite} from './catalog.mjs';
export function loadOfficialCatalog({home,saved,dir,catalog}){
  const recovery=path.join(dir,'last-good-official-models.json');
  try{
    const snapshot=readJson(saved).value;
    if(snapshot.source==='codex-app-server'&&snapshot.schemaVersion>=2){
      const models=officialModels(snapshot);if(!models.length)throw new Error('empty official snapshot');
      const next={models};let previous;try{previous=readJson(recovery).value;}catch{}
      if(JSON.stringify(previous)!==JSON.stringify(next))atomicWrite(recovery,next);
      return {models,recovered:false,sources:[path.basename(saved)]};
    }
  }catch{}
  const candidates=[saved,recovery,path.join(dir,'official-model-catalog.json'),catalog,path.join(home,'model_catalog_1m.json')];
  const merged=new Map(),sources=[];
  for(const file of candidates){try{const models=officialModels(readJson(file).value).filter(model=>OFFICIAL.includes(model.slug));if(!models.length)continue;sources.push(file);for(const m of models)if(!merged.has(m.slug))merged.set(m.slug,m);}catch{}}
  if(!merged.size)throw new Error('官方模型源不可用，已保留现有目录；请恢复有效官方快照后重试');
  const models=[...merged.values()],next={models};let previous;try{previous=readJson(recovery).value;}catch{}
  if(JSON.stringify(previous)!==JSON.stringify(next))atomicWrite(recovery,next);
  return {models,recovered:sources[0]!==saved,sources: sources.map(file=>path.basename(file))};
}
