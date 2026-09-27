import fs from 'node:fs/promises';
import path from 'node:path';
import {codexHome} from './paths.js';
import {readCodexThreadUsage} from './codexSessions.js';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import {UsageTrends} from './usageTrends.js';

const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function quotaWindows(response:any){
  const limits=response?.rateLimitsByLimitId&&Object.keys(response.rateLimitsByLimitId).length?Object.values(response.rateLimitsByLimitId):response?.rateLimits?[response.rateLimits]:[];
  return limits.flatMap((limit:any)=>['primary','secondary'].flatMap(key=>{
    const window=limit?.[key];if(!window)return [];
    const used=number(window.usedPercent);
    return [{name:limit.limitName||limit.limitId||'Codex',durationMins:number(window.windowDurationMins),remainingPercent:used===null?null:Math.max(0,Math.min(100,100-used)),resetsAt:number(window.resetsAt)}];
  }));
}
export function tokenCounts(info:any){
  if(!info)return null;
  const total=info.total_token_usage||{},last=info.last_token_usage||{};
  return {input:number(total.input_tokens),cached:number(total.cached_input_tokens),output:number(total.output_tokens),reasoning:number(total.reasoning_output_tokens),total:number(total.total_tokens),last:number(last.total_tokens),contextWindow:number(info.model_context_window)};
}
async function savedQuota(){
  try{
    const home=codexHome();
    const [saved,auth]=await Promise.all([fs.readFile(path.join(home,'codexmate','local-console','quota-current.json'),'utf8').then(JSON.parse),fs.readFile(path.join(home,'auth.json'),'utf8').then(JSON.parse)]);
    const account=auth.tokens?.account_id;
    if(!account||!(saved.accountKey===account||saved.accountKey?.endsWith('::'+account)))return null;
    const convert=(w:any)=>w?{usedPercent:w.used_percent,windowDurationMins:typeof w.limit_window_seconds==='number'?w.limit_window_seconds/60:null,resetsAt:w.reset_at}:null;
    return {windows:quotaWindows({rateLimits:{limitId:'codex',primary:convert(saved.primary),secondary:convert(saved.secondary)}}),plan:saved.plan||null,updatedAt:saved.at,source:'local-console-cache',stale:true};
  }catch{return null;}
}
async function historicalQuota(days:number){
  try{
    const home=codexHome();
    const [auth,content]=await Promise.all([
      fs.readFile(path.join(home,'auth.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(home,'codexmate','local-console','quota-history.jsonl'),'utf8'),
    ]);
    const account=auth.tokens?.account_id;
    if(typeof account!=='string'||!account)return [];
    const cutoff=Date.now()-days*86400000;
    const rows:{at:number;name:string;durationMins:number;remainingPercent:number}[]=[];
    for(const line of content.split('\n')){
      if(!line.trim())continue;
      let entry:any;try{entry=JSON.parse(line);}catch{continue;}
      if(typeof entry.accountKey!=='string'||!(entry.accountKey===account||entry.accountKey.endsWith('::'+account)))continue;
      const at=entry.timestamp*1000;
      if(!Number.isFinite(at)||at<cutoff||at>Date.now()+60000)continue;
      for(const [key,durationMins] of [['primaryUsedPercent',300],['secondaryUsedPercent',10080]] as const){
        const used=number(entry[key]);
        if(used!==null&&used<=100)rows.push({at,name:'Codex',durationMins,remainingPercent:100-used});
      }
    }
    return rows;
  }catch{return [];}
}
function mergedTrend(local:ReturnType<UsageTrends['read']>,history:Awaited<ReturnType<typeof historicalQuota>>){
  const samples=new Map<string,(typeof local)[number]>();
  for(const row of history) samples.set(`${Math.floor(row.at/300000)}:${row.durationMins}`,row);
  for(const row of local) samples.set(`${Math.floor(row.at/300000)}:${row.durationMins}`,row);
  return [...samples.values()].sort((a,b)=>a.at-b.at||a.durationMins-b.durationMins);
}
export class UsageReader {
  private trends=new UsageTrends();
  private cached:any=null;
  private captured=0;
  private pending:Promise<any>|null=null;
  constructor(private codex:CodexAppServerClient){}
  private async quota(){
    if(this.cached&&Date.now()-this.captured<30000)return this.cached;
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      let timer:NodeJS.Timeout|undefined;
      try{
        const response:any=await Promise.race([this.codex.request('account/rateLimits/read',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),8000);})]);
        const value={windows:quotaWindows(response),plan:response?.rateLimits?.planType||null,updatedAt:new Date().toISOString(),source:'codex',stale:false};
        this.cached=value;this.captured=Date.now();return value;
      }catch{return await savedQuota() || (this.cached?{...this.cached,stale:true}: {windows:[],plan:null,updatedAt:null,source:null,stale:true});}
      finally{clearTimeout(timer);this.pending=null;}
    })();return this.pending;
  }
  async sampleQuota():Promise<void>{
    const quota=await this.quota();
    if(!quota.stale)this.trends.record(quota.windows);
  }
  async read(threadId?:string,days=7){
    const [quota,usage]=await Promise.all([this.quota(),threadId?readCodexThreadUsage(threadId).catch(()=>null):null]);
    if(!quota.stale)this.trends.record(quota.windows);
    const history=await historicalQuota(days);
    return {quota,tokens:usage?{...tokenCounts(usage.info),updatedAt:usage.updatedAt}:null,quotaTrend:mergedTrend(this.trends.read(days),history)};
  }
  close():void{this.trends.close();}
}
