import fs from 'node:fs/promises';
import path from 'node:path';
import {codexHome} from './paths.js';
import {readCodexThreadUsage} from './codexSessions.js';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import {UsageTrends} from './usageTrends.js';
import {notificationTokenInfo,type TokenSnapshot} from './codexTokenUsage.js';
import {CodexSubagentUsage,type SessionTokenLedger} from './sessionTokenLedger.js';
import {subagentMetadata} from './subagentThreads.js';

const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
export function creditBalance(value:any){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const raw=value.balance;
  const balance=typeof raw==='number'||typeof raw==='string'&&raw.trim()!==''?number(Number(raw)):null;
  return {balance,unlimited:value.unlimited===true,hasCredits:typeof value.hasCredits==='boolean'?value.hasCredits:typeof value.has_credits==='boolean'?value.has_credits:null};
}
const isContextEstimate=(last:any)=>number(last?.total_tokens)!==null&&last.total_tokens>0&&last.input_tokens===0&&last.output_tokens===0;
export function quotaWindows(response:any){
  const limits=response?.rateLimitsByLimitId&&Object.keys(response.rateLimitsByLimitId).length?Object.values(response.rateLimitsByLimitId):response?.rateLimits?[response.rateLimits]:[];
  return limits.flatMap((limit:any)=>['primary','secondary'].flatMap(key=>{
    const window=limit?.[key];if(!window)return [];
    const used=number(window.usedPercent);
    return [{name:limit.limitName||limit.limitId||'Codex',durationMins:number(window.windowDurationMins),remainingPercent:used===null?null:Math.max(0,Math.min(100,100-used)),resetsAt:number(window.resetsAt)}];
  }));
}
export function tokenCounts(info:any,contextPending=false){
  if(!info)return null;
  const total=info.total_token_usage||{},last=info.last_token_usage||{};
  const context=number(last.total_tokens),contextWindow=number(info.model_context_window);
  // Codex emits a post-compaction context estimate with nonzero total but zero
  // request input/output. It is not a completed API request or a zero balance.
  const contextOnly=isContextEstimate(last);
  return {input:number(total.input_tokens),cached:number(total.cached_input_tokens),output:number(total.output_tokens),reasoning:number(total.reasoning_output_tokens),total:number(total.total_tokens),
    last:contextOnly?null:context,context:contextPending?null:context,contextWindow,
    contextPercent:!contextPending&&context!==null&&contextWindow!==null&&contextWindow>0?context/contextWindow*100:null,
    contextState:contextPending?'awaiting_usage':context===null?'unavailable':contextOnly?'compacted':'reported'};
}
type QuotaIdentity={home:string;account:string|null;key:string};
async function quotaIdentity():Promise<QuotaIdentity>{
  const home=codexHome();
  const auth=await fs.readFile(path.join(home,'auth.json'),'utf8').then(JSON.parse).catch(()=>null);
  const value=auth?.tokens?.account_id;
  const account=typeof value==='string'&&value?value:null;
  return {home,account,key:JSON.stringify([home,account])};
}
const emptyQuota=()=>({windows:[],credits:null,plan:null,updatedAt:null,source:null,stale:true});
async function savedQuota(identity:QuotaIdentity){
  try{
    const {home,account}=identity;
    const saved=await fs.readFile(path.join(home,'codexmate','local-console','quota-current.json'),'utf8').then(JSON.parse);
    if(!account||!(saved.accountKey===account||saved.accountKey?.endsWith('::'+account)))return null;
    const convert=(w:any)=>w?{usedPercent:w.used_percent,windowDurationMins:typeof w.limit_window_seconds==='number'?w.limit_window_seconds/60:null,resetsAt:w.reset_at}:null;
    return {windows:quotaWindows({rateLimits:{limitId:'codex',primary:convert(saved.primary),secondary:convert(saved.secondary)}}),credits:creditBalance(saved.credits),creditsUpdatedAt:saved.at,subscriptionEstimate:saved.subscriptionEstimate??null,plan:saved.plan||null,updatedAt:saved.at,source:'local-console-cache',stale:true};
  }catch{return null;}
}
type QuotaHistoryRow={at:number;name:string;durationMins:number;remainingPercent:number};
type CreditHistoryRow={at:number;balance:number};
type QuotaHistorySnapshot={windows:QuotaHistoryRow[];credits:CreditHistoryRow[]};
class QuotaHistory {
  private cached:{key:string;rows:QuotaHistorySnapshot}|null=null;
  private pending=new Map<string,Promise<QuotaHistorySnapshot>>();
  private latestKey='';
  private async load(file:string,account:string):Promise<QuotaHistorySnapshot>{
    const content=await fs.readFile(file,'utf8');
    const rows:QuotaHistoryRow[]=[];
    const credits:CreditHistoryRow[]=[];
    for(const line of content.split('\n')){
      if(!line.trim())continue;
      let entry:any;try{entry=JSON.parse(line);}catch{continue;}
      if(typeof entry.accountKey!=='string'||!(entry.accountKey===account||entry.accountKey.endsWith('::'+account)))continue;
      const at=entry.timestamp*1000;
      if(!Number.isFinite(at))continue;
      const credit=creditBalance(entry.credits);
      if(credit?.balance!==null&&credit?.balance!==undefined&&!credit.unlimited)credits.push({at,balance:credit.balance});
      for(const [key,durationMins] of [['primaryUsedPercent',300],['secondaryUsedPercent',10080]] as const){
        const used=number(entry[key]);
        if(used!==null&&used<=100)rows.push({at,name:'Codex',durationMins,remainingPercent:100-used});
      }
    }
    return {windows:rows,credits};
  }
  async read(days:number,identity:QuotaIdentity):Promise<QuotaHistorySnapshot>{
    try{
      const {home,account}=identity;
      if(!account)return {windows:[],credits:[]};
      const file=path.join(home,'codexmate','local-console','quota-history.jsonl'),stat=await fs.stat(file);
      const key=JSON.stringify([home,account,stat.size,stat.mtimeMs,stat.ctimeMs]);
      this.latestKey=key;
      let rows=this.cached?.key===key?this.cached.rows:undefined;
      if(!rows){
        let read=this.pending.get(key);
        if(!read){
          read=this.load(file,account).then(value=>{if(this.latestKey===key)this.cached={key,rows:value};return value;}).finally(()=>this.pending.delete(key));
          this.pending.set(key,read);
        }
        rows=await read;
      }
      const now=Date.now(),cutoff=now-days*86400000;
      return {windows:rows.windows.filter(row=>row.at>=cutoff&&row.at<=now+60000),credits:rows.credits.filter(row=>row.at>=cutoff&&row.at<=now+60000)};
    }catch{return {windows:[],credits:[]};}
  }
}
function mergedTrend(local:ReturnType<UsageTrends['read']>,history:QuotaHistoryRow[]){
  const samples=new Map<string,(typeof local)[number]>();
  for(const row of history) samples.set(`${Math.floor(row.at/300000)}:${row.durationMins}`,row);
  for(const row of local) samples.set(`${Math.floor(row.at/300000)}:${row.durationMins}`,row);
  return [...samples.values()].sort((a,b)=>a.at-b.at||a.durationMins-b.durationMins);
}
export class UsageReader {
  private family?:CodexSubagentUsage;
  private trends=new UsageTrends();
  private history=new QuotaHistory();
  private cached:any=null;
  private captured=0;
  private pending:Promise<any>|null=null;
  private fallback:Promise<void>|null=null;
  private retryAfter=0;
  private quotaScope='';
  private quotaVersion=0;
  private live=new Map<string,TokenSnapshot>();
  private compactions=new Map<string,{itemId:string;startedAt:string;before:TokenSnapshot|undefined;completed:boolean}>();
  private notification=(event:any)=>{
    if(event.method==='thread/started'&&this.ledger){
      const thread=event.params?.thread,parent=thread&&subagentMetadata(thread)?.parentThreadId;
      if(parent&&typeof thread.id==='string')this.ledger.relate(thread.id,parent,thread.name||thread.agentNickname||'子代理');
    }
    const threadId=event?.params?.threadId;if(typeof threadId!=='string')return;
    const at=new Date().toISOString();
    if(event.method==='thread/tokenUsage/updated'){
      const info=notificationTokenInfo(event.params.tokenUsage);if(!info)return;
      this.ledger?.recordSnapshot(threadId,{info,updatedAt:at});
      this.live.set(threadId,{info,updatedAt:at});this.updated(threadId);
      for(const parent of this.ledger?.ancestors(threadId)||[])this.updated(parent);
    }else if(event.method==='item/started'&&event.params.item?.type==='contextCompaction'){
      const itemId=event.params.item.id||'';
      if(itemId&&this.compactions.get(threadId)?.itemId===itemId)return;
      this.compactions.delete(threadId);
      this.compactions.set(threadId,{itemId,startedAt:at,before:this.live.get(threadId),completed:false});
      if(this.compactions.size>128)this.compactions.delete(this.compactions.keys().next().value!);
    }else if(event.method==='item/completed'&&event.params.item?.type==='contextCompaction'){
      const before=this.live.get(threadId);
      const last=before?.info.last_token_usage;
      const itemId=event.params.item.id||'',started=this.compactions.get(threadId);
      const sameCompaction=started&&started.itemId===itemId;
      if(sameCompaction&&started.completed)return;
      if(sameCompaction)started.completed=true;
      // A context-only snapshot may arrive before completion. With a start
      // event, it must have arrived during this compaction, not a previous one.
      if(!before?.contextPending&&isContextEstimate(last)&&
        (!sameCompaction||before!==started.before))return;
      this.live.set(threadId,{info:before?.info||{},updatedAt:before?.updatedAt||at,observedAt:at,contextPending:true,
        ...(sameCompaction?{compactionStartedAt:started.startedAt}:{})});this.updated(threadId);
    }
    if(this.live.size>128)this.live.delete(this.live.keys().next().value!);
  };
  constructor(private codex:CodexAppServerClient,private updated:(threadId:string)=>void=()=>{},private ledger?:SessionTokenLedger){
    if(ledger)this.family=new CodexSubagentUsage(ledger);
    if(typeof codex.on==='function')codex.on('notification',this.notification);
  }
  private async quota(identity:QuotaIdentity){
    if(this.quotaScope!==identity.key){
      this.quotaScope=identity.key;this.quotaVersion++;
      this.cached=null;this.captured=0;this.retryAfter=0;this.fallback=null;
    }
    const version=this.quotaVersion;
    const current=()=>this.quotaVersion===version;
    if(this.cached&&Date.now()-this.captured<30000)return this.cached;
    if(!this.cached){
      this.fallback??=(async()=>{const saved=await savedQuota(identity);if(current())this.cached??=saved||emptyQuota();})().finally(()=>{if(current())this.fallback=null;});
      await this.fallback;
    }
    if(!current())return emptyQuota();
    // Show the last known quota immediately. Retain the actual RPC promise so a
    // slow backend does not accumulate orphan requests after an HTTP timeout.
    if(!this.pending&&Date.now()>=this.retryAfter)this.pending=(async()=>{
      try{
        const response:any=await this.codex.request('account/rateLimits/read',{});
        if(!current()||(await quotaIdentity()).key!==identity.key)return null;
        const limit=(response?.rateLimitsByLimitId?.codex??response?.rateLimits) as any;
        const saved=await savedQuota(identity);if(!current())return null;
        const liveCredits=creditBalance(limit?.credits),updatedAt=new Date().toISOString();
        const value={windows:quotaWindows(response),credits:liveCredits??saved?.credits??null,creditsUpdatedAt:liveCredits?updatedAt:saved?.creditsUpdatedAt??null,subscriptionEstimate:saved?.subscriptionEstimate??null,plan:limit?.planType||null,updatedAt,source:'codex',stale:false};
        this.cached=value;this.captured=Date.now();return value;
      }catch{
        if(!current())return null;
        const saved=await savedQuota(identity);
        if(!current())return null;
        this.retryAfter=Date.now()+30000;
        this.cached=saved||{...this.cached,stale:true};return this.cached;
      }
    })().finally(()=>{this.pending=null;});
    await Promise.resolve();
    return !current()?emptyQuota():this.captured&&Date.now()-this.captured<30000?this.cached:{...this.cached,stale:true};
  }
  async sampleQuota():Promise<void>{
    const identity=await quotaIdentity(),quota=await this.quota(identity);
    if(!quota.stale&&identity.account&&this.quotaScope===identity.key)this.trends.record(quota.windows,Date.now(),identity.key);
  }
  // Other harnesses report quota through their own CLI. They share this sample
  // store so the phone gets the same 5h/7d history for every assistant.
  recordExternalQuota(scope:string,windows:{name:string;durationMins:number|null;remainingPercent:number|null}[],now=Date.now()):void{
    this.trends.record(windows,now,scope);
  }
  externalQuotaTrend(scope:string,days=7,now=Date.now()){return this.trends.read(days,now,scope);}
  async read(threadId?:string,days=7){
    const identity=await quotaIdentity();
    const [quota,disk]=await Promise.all([this.quota(identity),threadId?readCodexThreadUsage(threadId).catch(()=>null):null,
      threadId?this.family?.capture(threadId):null]);
    const live=threadId?this.live.get(threadId):undefined;
    // A delayed completion notification must not hide the estimate already
    // written during this compaction. Older estimates remain ineligible.
    const diskCompactionEstimate=live?.contextPending&&live.compactionStartedAt&&disk&&!disk.contextPending&&
      isContextEstimate(disk.info.last_token_usage)&&Date.parse(disk.updatedAt)>Date.parse(live.compactionStartedAt);
    const usage=diskCompactionEstimate?disk:live&&(!disk||Date.parse(live.observedAt||live.updatedAt)>Date.parse(disk.observedAt||disk.updatedAt))
      ?{...live,info:Object.keys(live.info).length?live.info:disk?.info||{}}:disk;
    if(!quota.stale&&identity.account&&this.quotaScope===identity.key)this.trends.record(quota.windows,Date.now(),identity.key);
    const history=await this.history.read(days,identity);
    const current=this.quotaScope===identity.key;
    const creditAt=Date.parse(quota.creditsUpdatedAt),balance=quota.credits?.balance;
    const credits=history.credits;
    if(current&&identity.account&&!quota.credits?.unlimited&&typeof balance==='number'&&creditAt>=Date.now()-days*86400000&&creditAt>(credits.at(-1)?.at??0))credits.push({at:creditAt,balance});
    const tokens=usage?{...tokenCounts(usage.info,usage.contextPending),updatedAt:usage.updatedAt}:null;
    return {quota:current?quota:emptyQuota(),tokens:threadId&&this.ledger?this.ledger.combine(threadId,tokens):tokens,
      quotaTrend:current&&identity.account?mergedTrend(this.trends.read(days,Date.now(),identity.key),history.windows):[],
      creditTrend:current&&identity.account?credits:[]};
  }
  async capture(threadId:string){await this.family?.capture(threadId,true);}
  close():void{if(typeof this.codex.off==='function')this.codex.off('notification',this.notification);this.live.clear();this.compactions.clear();this.trends.close();}
}
