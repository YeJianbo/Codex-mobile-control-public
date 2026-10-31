import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {calendarRange,normalizeAnalyticsTier} from './analytics-core.mjs';
import {estimateTokenCost} from './token-pricing.mjs';
import {agyPrice} from './agy-usage.mjs';
import {ecnuQuote,deepseekQuote,glmQuote} from './harness-usage.mjs';

export const REQUEST_SOURCES=['codex','router','agy','claude','zcode','grok','hermes','deepseek','opencode','pi','research'];
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const text=value=>typeof value==='string'?value.slice(0,300):null;
const knownPrice=(row,basis)=>[row.input,row.cached,row.output].every(value=>number(value)!==null)?estimateTokenCost(row,basis):null;
const compare=(a,b)=>b.time-a.time||(b.id<a.id?-1:b.id>a.id?1:0);

export function requestRecord(row,{id,source,pricing='codex',router=false}={}){
  const input=number(router?row.inputTokens:row.input),cached=number(router?row.cachedTokens:row.cached??row.cacheRead),
    output=number(router?row.outputTokens:row.output),time=router?(row.timestampMs??row.timestamp*1000):row.time;
  const totalInput=['agy','claude'].includes(source)&&input!==null?input+(cached||0)+(number(row.cacheWrite)||0):input;
  const tier=normalizeAnalyticsTier(row.tier),requestedTier=normalizeAnalyticsTier(row.requestedTier),model=text(row.model),requestCount=number(row.requests)??1;
  const durationMs=requestCount>1?null:number(row.durationMs);
  let cost=row.cost;
  if(!cost||cost.usd==null&&cost.basis!=='subscription_included'){
    if(source==='codex'||router){const price=knownPrice({model,tier:tier??requestedTier,input:totalInput,cached,output,longContext:(totalInput||0)>272000,pending:row.dim_version!=null&&row.dim_version<2},pricing);cost=price?{usd:price.usd,basis:'reference',pricing}:glmQuote({model,input:totalInput,cacheRead:cached,output});}
    else cost=ecnuQuote(row)||glmQuote({...row,input:totalInput,cacheRead:cached})||(source==='deepseek'?deepseekQuote(row):null)||
      (['agy','claude'].includes(source)?agyPrice({...row,cached:row.cached??row.cacheRead}):null);
  }
  const status=number(row.status),timingBasis=row.timingBasis||(durationMs!==null?(router?'request-observed':'native-recorded'):'not-recorded');
  const within=value=>durationMs!==null&&number(value)!==null&&value<=durationMs?value:null;
  const firstTextMs=within(row.firstTextMs),firstOutputMs=within(row.firstOutputMs),firstByteMs=within(row.firstByteMs);
  const speedTokens=number(row.speedOutputTokens)??output;
  return {id,source,time,model,provider:text(row.provider),tier,requestedTier,tierBasis:tier===null?'unknown':router?'response':'native-setting',effort:text(row.effort),purpose:row.purpose|| (row.test?'test':'normal'),
    kind:requestCount>1?'aggregate':'request',requestCount,sessionId:text(row.sessionId??row.session),
    status,failed:!!row.errorCode||status!==null&&(status<200||status>=400),errorCode:text(row.errorCode),
    inputTokens:totalInput,cachedTokens:cached,cacheWriteTokens:number(row.cacheWrite),outputTokens:output,reasoningTokens:number(row.reasoningTokens??row.reasoning),
    totalTokens:totalInput!==null&&output!==null?totalInput+output:null,durationMs,
    firstTextMs,firstOutputMs,firstByteMs,
    afterFirstOutputMs:timingBasis==='request-observed'&&firstOutputMs!==null?durationMs-firstOutputMs:null,
    averageTPS:durationMs>0&&speedTokens!==null?speedTokens/durationMs*1000:null,speedTokens,
    cacheHitRate:totalInput>0&&cached!==null&&cached<=totalInput?cached/totalInput:null,
    timingBasis:durationMs===null?'not-recorded':timingBasis,
    cost:cost?{usd:number(cost.usd),basis:cost.basis||'reference',pricing:cost.pricing||null}:null};
}

/** Page existing indexes; no raw conversations are scanned by the request-list endpoint. */
export class RequestRecords{
  constructor({directory,usage,refresh,indexing=()=>false,now=()=>Date.now()}){this.directory=directory;this.usage=usage;this.refresh=refresh;this.indexing=indexing;this.now=now;this.refreshing=null;this.lastRefresh=0;}
  update(){
    if(this.refreshing)return this.refreshing;
    this.lastRefresh=this.now();
    this.refreshing=Promise.resolve().then(()=>this.refresh()).finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  read(query={}){
    const {range='week',source='all',pricing='codex',purpose='all',cursor='',limit=50}=query;
    const model=typeof query.model==='string'?query.model.trim()||'all':query.model??'all';
    if(Object.keys(query).some(key=>!['range','source','model','pricing','purpose','cursor','limit','from','to'].includes(key))||typeof cursor!=='string'||cursor.length>8192)throw Error('请求记录参数无效');
    if(source!=='all'&&!REQUEST_SOURCES.includes(source)||!['codex','api'].includes(pricing)||!['all','normal','warmup','test'].includes(purpose)||typeof model!=='string'||model.length>300||!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>100)throw Error('请求记录筛选无效');
    const bounds=calendarRange(range,this.now(),query);let before={time:bounds.until+1,id:''};
    if(cursor){try{before=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw Error('请求记录分页无效');}if(!Number.isFinite(before.time)||typeof before.id!=='string'||before.id.length>4096)throw Error('请求记录分页无效');}
    const pageSize=Number(limit),candidates=[],coverage=[];
    const where=(time,id,modelColumn='model')=>{
      let sql=`${time}>=? AND ${time}<=? AND (${time}<? OR (${time}=? AND ${id}<?))`;
      const args=[bounds.since,bounds.until,before.time,before.time,before.id];
      if(model!=='all'){sql+=` AND ${modelColumn}=?`;args.push(model);}
      return {sql,args};
    };
    const take=(row,id,name,router=false)=>{
      const value=requestRecord(row,{id,source:name,pricing,router});if(purpose==='all'||value.purpose===purpose)candidates.push(value);
    };
    if(source==='all'||source==='router'){
      const journal=this.usage.journal(),filter=where('at',"'router:'||id");
      let clause=filter.sql;if(purpose!=='all'){clause+=" AND COALESCE(json_extract(data,'$.purpose'),'normal')=?";filter.args.push(purpose);}
      for(const row of journal.db.prepare(`SELECT id,data FROM requests WHERE ${clause} ORDER BY at DESC,id DESC LIMIT ?`).all(...filter.args,pageSize+1))take(JSON.parse(row.data),'router:'+row.id,'router',true);
      coverage.push({source:'router',available:true});
    }
    const read=(file,name,callback)=>{
      if(!fs.existsSync(file)){coverage.push({source:name,available:false});return;}
      const db=new DatabaseSync(file,{readOnly:true});try{db.exec('PRAGMA busy_timeout=250');callback(db);coverage.push({source:name,available:true});}catch(error){coverage.push({source:name,available:false});}finally{db.close();}
    };
    if((source==='all'||source==='codex')&&(purpose==='all'||purpose==='normal'))read(path.join(this.directory,'analytics','activity.sqlite'),'codex',db=>{
      // Native text streaming has its own token estimator. Keep that numerator
      // paired with its timing; billing output includes reasoning and cannot replace it.
      let speed;
      const speedFile=path.join(this.directory,'native-speed.sqlite');
      if(fs.existsSync(speedFile))speed=new DatabaseSync(speedFile,{readOnly:true});
      const turnTimings=new Map();
      const withTiming=row=>{
        if(!speed||row.durationMs!=null)return row;
        const turn=/^token:([^:]+):/.exec(row.key)?.[1];if(!turn)return row;
        const scope=JSON.stringify([row.session,turn,row.model]);
        let groups=turnTimings.get(scope);
        if(!groups){
          groups=new Map();turnTimings.set(scope,groups);
          const prefix='token:'+turn+':';
          const events=db.prepare("SELECT key,time,model FROM events WHERE key>=? AND key<? AND session=? AND +kind='token' ORDER BY +time").all(prefix,prefix+'\uffff',row.session);
          const items=speed.prepare("SELECT * FROM items WHERE session=? AND turn_id=? AND model=? AND (reason IS NULL AND tokens>0 OR reason='reasoning-timing') AND end_ms>start_ms").all(row.session,turn,row.model);
          for(const item of items){
            let low=0,high=events.length;
            while(low<high){const mid=(low+high)>>>1;if(events[mid].time<item.end_ms-1000)low=mid+1;else high=mid;}
            const match=events[low],next=events[low+1];
            if(!match||match.model!==item.model||match.time-item.end_ms>30000||next&&next.time===match.time)continue;
            if(!groups.has(match.key))groups.set(match.key,[]);
            groups.get(match.key).push(item);
          }
        }
        const matched=groups.get(row.key)||[];
        if(!matched.length)return row;
        const intervals=matched.map(item=>[item.start_ms,item.end_ms]).sort((a,b)=>a[0]-b[0]);
        let durationMs=0,end=-Infinity;for(const [start,until] of intervals){durationMs+=Math.max(0,until-Math.max(start,end));end=Math.max(end,until);}
        const includesReasoning=matched.some(item=>item.reason==='reasoning-timing');
        return {...row,durationMs,speedOutputTokens:includesReasoning?row.output:matched.reduce((sum,item)=>sum+item.tokens,0),timingBasis:includesReasoning?'model-output-estimate':'visible-text-estimate'};
      };
      try{
      const baseFilter=where('time',"'codex:'||key");let filter=baseFilter,batch;
      const journal=this.usage.journal();
      let accepted=0;
      do{
       batch=db.prepare(`SELECT * FROM events WHERE kind='token' AND ${filter.sql} ORDER BY time DESC,key DESC LIMIT ?`).all(...filter.args,pageSize+1);
       for(const row of batch){
        // Merge only an unambiguous router observation with the same metering.
        const duplicates=journal.db.prepare("SELECT at,session FROM requests WHERE model=? AND input=? AND output=? AND at BETWEEN ? AND ? AND session=? AND json_extract(data,'$.cachedTokens')=? AND COALESCE(json_extract(data,'$.purpose'),'normal')='normal' LIMIT 2")
          .all(row.model,row.input,row.output,row.time-3000,row.time+3000,row.session,row.cached);
        if(source==='all'&&duplicates.length===1&&db.prepare("SELECT key FROM events WHERE kind='token' AND model=? AND input=? AND output=? AND time BETWEEN ? AND ? AND session=? AND cached=? LIMIT 2").all(row.model,row.input,row.output,duplicates[0].at-3000,duplicates[0].at+3000,row.session,row.cached).length===1)continue;
        take(withTiming(row),'codex:'+row.key,'codex');accepted++;
       }
       const last=batch.at(-1);if(!last||accepted>pageSize)break;
       filter={sql:baseFilter.sql+' AND (time<? OR (time=? AND key<?))',args:[...baseFilter.args,last.time,last.time,last.key]};
      }while(batch.length===pageSize+1);
      }finally{speed?.close();}
    });
    if((source==='all'||source==='agy')&&(purpose==='all'||purpose==='normal'))read(path.join(this.directory,'analytics','agy-usage.sqlite'),'agy',db=>{
      const identity="'agy:'||json_extract(data,'$.model')||':'||COALESCE(NULLIF(json_extract(data,'$.messageId'),''),file||':'||idx)";
      const canonicalWhere=where('time','id',"json_extract(data,'$.model')");
      for(const row of db.prepare(`WITH canonical AS (SELECT ${identity} id,time,data,ROW_NUMBER() OVER (PARTITION BY ${identity} ORDER BY time DESC,file DESC,idx DESC) occurrence FROM usage WHERE time>=? AND time<=?) SELECT id,data FROM canonical WHERE occurrence=1 AND ${canonicalWhere.sql} ORDER BY time DESC,id DESC LIMIT ?`).all(bounds.since,bounds.until,...canonicalWhere.args,pageSize+1))take(JSON.parse(row.data),row.id,'agy');
    });
    if((source==='all'||!['router','codex','agy'].includes(source))&&(purpose==='all'||purpose==='normal')){
      const names=source==='all'?REQUEST_SOURCES.filter(name=>!['router','codex','agy'].includes(name)):[source];
      read(path.join(this.directory,'analytics','external-history.sqlite'),'harnesses',db=>{
        for(const name of names){const filter=where('time',"source||':'||id","json_extract(data,'$.model')");
          for(const row of db.prepare(`SELECT id,data FROM usage WHERE source=? AND ${filter.sql} AND COALESCE(json_extract(data,'$.requests'),0)>0 ORDER BY time DESC,id DESC LIMIT ?`).all(name,...filter.args,pageSize+1))take(JSON.parse(row.data),name+':'+row.id,name);}
      });
    }
    const unique=[...new Map(candidates.map(row=>[row.id,row])).values()].sort(compare),rows=unique.slice(0,pageSize),last=rows.at(-1);
    return {range,source,model,pricing,purpose,rows,coverage,hasMore:unique.length>pageSize,
      nextCursor:unique.length>pageSize&&last?Buffer.from(JSON.stringify({time:last.time,id:last.id})).toString('base64url'):null,
      refreshing:!!this.refreshing||this.indexing(),updatedAt:this.now()};
  }
}
