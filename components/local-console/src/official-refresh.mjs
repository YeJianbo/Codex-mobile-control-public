import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {atomicWrite,officialModels,readJson} from './catalog.mjs';

const SIX_HOURS=6*60*60*1000;

function codexBinary(){
  if(process.env.CODEX_BINARY&&fs.existsSync(process.env.CODEX_BINARY))return process.env.CODEX_BINARY;
  const root=path.join(process.env.LOCALAPPDATA||'', 'OpenAI','Codex','bin'),candidates=[];
  try{for(const name of fs.readdirSync(root)){const file=path.join(root,name,'codex.exe');if(fs.existsSync(file))candidates.push({file,time:fs.statSync(file).mtimeMs});}}catch{}
  candidates.sort((a,b)=>b.time-a.time);
  if(!candidates.length)throw new Error('找不到当前 Codex 运行程序，请先更新或重新打开 Codex');
  return candidates[0].file;
}

function probeConfig(){return 'model = "gpt-6-astra"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n\n[features]\nplugins = false\nremote_plugin = false\nmemories = false\n';}

export async function probeOfficialCatalog(home,dir,{timeoutMs=30000}={}){
  const sourceAuth=path.join(home,'auth.json');
  if(!fs.existsSync(sourceAuth))throw new Error('没有可用 ChatGPT 登录，无法更新官方模型');
  const probe=path.join(dir,'official-refresh');fs.mkdirSync(probe,{recursive:true});
  const auth=path.join(probe,'auth.json');try{fs.unlinkSync(auth);}catch(e){if(e.code!=='ENOENT')throw e;}
  fs.linkSync(sourceAuth,auth);
  fs.writeFileSync(path.join(probe,'config.toml'),probeConfig(),{mode:0o600});
  const child=spawn(codexBinary(),['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_HOME:probe}});
  let buffer='',stderr='',finished=false,timer;
  const listed=await new Promise((resolve,reject)=>{
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);try{child.kill();}catch{};error?reject(error):resolve(value);};
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',()=>finish(new Error('无法启动 Codex 官方模型检查')));
    child.on('exit',code=>{if(!finished)finish(new Error(`Codex 官方模型检查提前退出${code==null?'':` (${code})`}${stderr.trim()?`：${stderr.trim().slice(-300)}`:''}`));});
    child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}if(message.id===1){send({method:'initialized'});send({id:2,method:'model/list',params:{includeHidden:false,limit:100}});}if(message.id===2){if(message.error)finish(new Error(message.error.message||'Codex 拒绝读取官方模型'));else finish(null,(message.result?.data||message.result?.models||[]).map(model=>model.id).filter(Boolean));}}});
    timer=setTimeout(()=>finish(new Error('更新官方模型超时，请检查网络后重试')),timeoutMs);
    send({id:1,method:'initialize',params:{clientInfo:{name:'local-console-model-refresh',version:'1.0'}}});
  }).finally(async()=>{
    for(let attempt=0;attempt<20;attempt++){
      try{fs.unlinkSync(auth);return;}catch(error){if(error.code==='ENOENT')return;if(attempt===19)throw new Error('官方模型检查已完成，但临时登录链接清理失败');await new Promise(resolve=>setTimeout(resolve,50));}
    }
  });
  const cache=readJson(path.join(probe,'models_cache.json')).value,visible=new Set(listed);
  const models=officialModels(cache).filter(model=>visible.has(model.slug));
  if(!models.length)throw new Error('Codex 未返回可用的官方模型，已保留当前目录');
  return {models,fetchedAt:cache.fetched_at||new Date().toISOString(),clientVersion:cache.client_version||null};
}

export class OfficialCatalogUpdater{
  constructor(store,{probe=probeOfficialCatalog,intervalMs=SIX_HOURS,initialDelayMs=15000}={}){this.store=store;this.probe=probe;this.intervalMs=intervalMs;this.initialDelayMs=initialDelayMs;this.current=null;this.timer=null;this.initialTimer=null;this.value={running:false,lastChecked:null,lastUpdated:null,error:null,added:[]};}
  status(){return {...this.value,automatic:true,intervalHours:this.intervalMs/3600000};}
  refresh(){
    if(this.current)return this.current;
    this.value={...this.value,running:true,error:null};
    this.current=(async()=>{try{
      const remote=await this.probe(this.store.home,this.store.dir);let previous=[];try{previous=officialModels(readJson(this.store.l.saved).value);}catch{}
      const prior=new Set(previous.map(model=>model.slug)),remoteIds=new Set(remote.models.map(model=>model.slug));
      const merged=[...remote.models,...previous.filter(model=>!remoteIds.has(model.slug))];
      const added=remote.models.map(model=>model.slug).filter(slug=>!prior.has(slug));
      const changed=JSON.stringify(previous)!==JSON.stringify(merged);
      if(changed){atomicWrite(this.store.l.saved,{schemaVersion:2,source:'codex-app-server',fetchedAt:remote.fetchedAt,clientVersion:remote.clientVersion,models:merged});this.store.rebuild();}
      const now=new Date().toISOString();this.value={running:false,lastChecked:now,lastUpdated:changed?now:this.value.lastUpdated,error:null,added,changed,count:merged.length};return this.status();
    }catch(error){this.value={...this.value,running:false,lastChecked:new Date().toISOString(),error:error.message,added:[],changed:false};throw error;}finally{this.current=null;}})();return this.current;
  }
  start(){if(this.timer||this.initialTimer)return;this.initialTimer=setTimeout(()=>{this.initialTimer=null;this.refresh().catch(()=>{});},this.initialDelayMs);this.initialTimer.unref?.();this.timer=setInterval(()=>this.refresh().catch(()=>{}),this.intervalMs);this.timer.unref?.();}
  stop(){clearTimeout(this.initialTimer);clearInterval(this.timer);this.initialTimer=null;this.timer=null;}
}
