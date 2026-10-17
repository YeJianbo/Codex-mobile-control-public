import {statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execa} from 'execa';

const modelRefreshes=new Map<string,Promise<void>>();
const modelCacheTtl=300000;
function nativeModelCachePath(){
  const source=process.env.OPENCODE_MODELS_URL||'https://models.opencode.ai';
  // Match OpenCode's own filename for a custom catalog source.
  const filename=source==='https://models.opencode.ai'?'models.json':`models-${createHash('sha1').update(source).digest('hex')}.json`;
  return path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'opencode',filename);
}
function modelCacheTime(){try{return statSync(nativeModelCachePath()).mtimeMs;}catch{return 0;}}

export async function refreshOpencodeModels(command:string,cwd:string,launch:typeof execa=execa,force=false):Promise<void>{
  // Explicit offline/static catalogs remain user-controlled. Otherwise refresh
  // before ACP starts, since its background fetch can race session/new.
  if(/^(?:true|1)$/i.test(process.env.OPENCODE_DISABLE_MODELS_FETCH||'')||process.env.OPENCODE_MODELS_PATH)return;
  const key=command+'\0'+nativeModelCachePath(),pending=modelRefreshes.get(key);
  if(pending)return pending;
  if(!force&&Date.now()-modelCacheTime()<modelCacheTtl)return;
  const refresh=(async()=>{
    const started=Date.now();
    const result=await launch(command,['models','--refresh'],{cwd,env:opencodeAcpEnvironment(),timeout:45000,windowsHide:true,reject:false});
    if(result.exitCode!==0)throw Error(`OpenCode 模型目录刷新失败（退出码 ${result.exitCode}）`);
    // OpenCode currently prints refresh success even when its fetch failed.
    if(modelCacheTime()<started-1000)throw Error('OpenCode 模型目录尚未更新，请检查网络后重试');
  })().finally(()=>modelRefreshes.delete(key));
  modelRefreshes.set(key,refresh);return refresh;
}

// This stamp is private cache state. Never log or return it: inline configuration
// can contain provider credentials even though file contents are not read here.
export function opencodeConfigStamp():string {
  const home=os.homedir(),configHome=process.env.XDG_CONFIG_HOME||path.join(home,'.config');
  const directories=[path.join(home,'.config','opencode'),path.join(configHome,'opencode'),process.env.OPENCODE_CONFIG_DIR,process.cwd()].filter((value):value is string=>!!value);
  const files=[...directories.flatMap(directory=>['opencode.json','opencode.jsonc'].map(name=>path.join(directory,name))),
    path.join(process.env.XDG_DATA_HOME||path.join(home,'.local','share'),'opencode','auth.json'),process.env.OPENCODE_CONFIG,nativeModelCachePath(),process.env.OPENCODE_MODELS_PATH].filter((value):value is string=>!!value);
  return JSON.stringify({files:[...new Set(files)].map(file=>{try{const stat=statSync(file);return [file,stat.size,stat.mtimeMs,stat.ctimeMs];}catch{return [file,null];}}),
    inline:process.env.OPENCODE_CONFIG_CONTENT||'',permission:process.env.OPENCODE_PERMISSION||'',modelsSource:process.env.OPENCODE_MODELS_URL||'',modelsFetch:process.env.OPENCODE_DISABLE_MODELS_FETCH||''});
}

export function opencodeAcpEnvironment():Record<string,string> {
  // Native permissions remain intact, including plan-mode and user deny rules.
  return {OPENCODE_DISABLE_MODELS_FETCH:process.env.OPENCODE_DISABLE_MODELS_FETCH??'false',
    npm_config_cache:process.env.npm_config_cache??process.env.NPM_CONFIG_CACHE??path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'opencode','npm')};
}
