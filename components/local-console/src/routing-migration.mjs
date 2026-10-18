import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite} from './catalog.mjs';
import {ThreadMigration} from './thread-migration.mjs';
import {officialDirect,officialHttp,officialHttpProvider} from './routing-config.mjs';

export class RoutingMigration {
  constructor(store,processes,port){this.store=store;this.processes=processes;this.port=port;this.migration=new ThreadMigration(store);this.busy=false;this.statusFile=path.join(store.dir,'routing-progress.json');this.progress={phase:'idle',running:false};this.lastSaved=0;}
  status(){if(this.busy)return this.progress;try{const saved=JSON.parse(fs.readFileSync(this.statusFile,'utf8'));return saved.running?{...saved,running:false,phase:'interrupted',error:'后台已重启，迁移状态中断；请重新执行开关以检查恢复'}:saved;}catch{return this.progress;}}
  report(update){const now=Date.now(),changed=update.phase&&update.phase!==this.progress.phase;this.progress={...this.progress,...update,updatedAt:now};if(changed||now-this.lastSaved>1000||!this.progress.running){atomicWrite(this.statusFile,this.progress);this.lastSaved=now;}}
  snapshot(){return this.processes.routingSnapshot?this.processes.routingSnapshot():this.processes.snapshot();}
  migrationFor(enabled,current,transport){
    if(transport==='http'&&current.owned)throw new Error('请先恢复官方直连并完成中转会话恢复，再切换官方 HTTPS');
    if(enabled&&current.officialHttp)throw new Error('请先恢复官方直连并完成 HTTPS 会话恢复，再切换中转');
    if(transport==='http'||(!enabled&&current.officialHttp))return new ThreadMigration(this.store,{providerId:officialHttpProvider(this.store),ledgerName:'official-http-providers.json'});
    return this.migration;
  }
  async preview(enabled,includeOfficial=this.store.data.includeOfficialInRelay===true,transport='auto'){
    const s=await this.snapshot();
    const current=this.store.configInfo(),models=this.store.models().filter(m=>m.visibility!=='hide'&&(enabled?(includeOfficial||m.slug.includes('::')):!m.slug.includes('::')&&!this.store.data.modelSettings?.[m.slug]?.route));
    const migration=this.migrationFor(enabled,current,transport);
    const relay=models.find(m=>m.slug.includes('::'));
    const defaultModel=(models.find(m=>m.slug===current.model)||(enabled?relay:null)||models[0])?.slug||null;
    const http=transport==='http',plan=http?await migration.plan(true,defaultModel,{allowOfficial:true,rewriteExisting:true,allowedModels:models.map(m=>m.slug)}):null;
    const replacements=new Map();if(plan)for(const r of [...plan.rows.map(r=>({id:r.id,model:r.model})),...plan.files.map(f=>({id:f.id,model:f.firstModel}))]){if(!r.model||plan.allowedModels.includes(r.model))continue;if(!replacements.has(r.model))replacements.set(r.model,new Set());replacements.get(r.model).add(r.id);}
    return {enabled,includeOfficial,transport,running:s.targets.length>0,canRestart:!!s.executable,processCount:s.targets.length,modelCount:models.length,defaultModel,...(http?{providerId:migration.providerId,migration:{scope:'all',threads:new Set([...plan.files,...plan.rows].map(r=>r.id)).size,files:plan.files.length,bytes:plan.bytes},modelReplacements:[...replacements].map(([from,ids])=>({from,to:defaultModel,threads:ids.size}))}:{})};
  }
  async apply(enabled,{restart=false,includeOfficial=this.store.data.includeOfficialInRelay===true,transport='auto'}={}){
    if(this.busy)throw new Error('会话迁移正在进行');this.busy=true;this.progress={running:true,enabled,phase:'checking',ownerPid:process.pid,holdSharedBackend:true,startedAt:Date.now(),bytesDone:0,bytesTotal:0,filesDone:0,filesTotal:0};this.report({});
    try{
      const current=this.store.configInfo(),models=this.store.rebuild(),official=models.filter(m=>!m.slug.includes('::')&&m.visibility!=='hide'&&!this.store.data.modelSettings?.[m.slug]?.route),relay=models.filter(m=>m.slug.includes('::')&&m.visibility!=='hide');
      const migration=this.migrationFor(enabled,current,transport),http=transport==='http';
      if(enabled&&!relay.length)throw new Error('请先启用至少一个已配置密钥的中转模型');
      if(!enabled&&!official.length)throw new Error('没有可恢复的官方模型');
      const fallback=enabled?(includeOfficial&&models.find(m=>m.slug===current.model&&m.visibility!=='hide')?.slug||relay.find(m=>m.slug===current.model)?.slug||relay[0].slug):(official.find(m=>m.slug===current.model)?.slug||official[0].slug);
      let s=await this.snapshot();
      if(s.targets.length&&!restart)throw new Error('请先关闭 Codex，或选择关闭、迁移并重启');
      if(restart&&!s.executable)throw new Error('未找到 Codex 启动程序');
      const known=new Set(s.targets.map(p=>p.id));
      if(s.processes.some(p=>/^codex(?:\.exe)?$/i.test(p.name)&&!known.has(p.id)))throw new Error('还有独立 Codex CLI / app-server，请先退出后再迁移');
      this.report({phase:'stopping'});if(s.targets.length){const result=await this.processes.apply(s.targets,'stop',s.executable);if(result.results.some(r=>['failed','changed'].includes(r.state)))throw new Error('部分 Codex 进程未关闭，未开始迁移');}
      const stopped=await this.snapshot();
      if(stopped.targets.length||stopped.processes.some(p=>/^codex(?:\.exe)?$/i.test(p.name)))throw new Error('Codex 仍在运行，未开始迁移');
      this.report({phase:'recovering'});migration.recover();this.report({phase:'planning'});
      const plan=await migration.plan(http||enabled,fallback,{rewriteExisting:http||enabled&&current.owned&&!current.relayOnly&&!includeOfficial,allowOfficial:http||includeOfficial,...(http||current.officialHttp?{allowedModels:official.map(m=>m.slug),restoreTo:'openai'}:{})});
      const result=await migration.apply(plan,()=>http?officialHttp(this.store):enabled?this.store.takeover(this.port,{includeOfficial}):officialDirect(this.store),p=>this.report(p));
      this.report({phase:'restarting',holdSharedBackend:false});
      if(restart){try{const start=await this.processes.apply([],'restart',s.executable);result.started=start.started;}catch(e){result.restartError=e.message;}}
      this.report({phase:result.restartError?'warning':'done',running:false,holdSharedBackend:false,error:result.restartError||null,result:{threads:result.migration?.threads||0,started:!!result.started}});return result;
    }catch(e){this.report({phase:'error',running:false,holdSharedBackend:false,error:e.message});throw e;}finally{this.busy=false;}
  }
}
