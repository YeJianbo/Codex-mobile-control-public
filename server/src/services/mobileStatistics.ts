import type {FastifyInstance, FastifyReply} from 'fastify';
import {z} from 'zod';
import {LocalConsoleClient, consoleStatistics} from './localConsole.js';
import {creditBalance} from './usage.js';

type Data=Record<string,any>;
const sourceIds=['codex','agy','claude','zcode','grok','hermes','deepseek','opencode','pi','research'] as const;
type Source=typeof sourceIds[number];
const sourceNames:Record<Source,string>={codex:'Codex',agy:'Antigravity',claude:'Claude Code',zcode:'ZCode',grok:'Grok',hermes:'Hermes',deepseek:'DeepSeek',opencode:'OpenCode',pi:'Pi',research:'自动科研 Agent'};
const object=(value:unknown):Data=>value&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const rows=(value:unknown,max=500):Data[]=>Array.isArray(value)?value.slice(0,max).map(object):[];
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const count=(value:unknown)=>number(value)??0;
const text=(value:unknown,max=500):string|null=>typeof value==='string'?value.slice(0,max):null;
const scalar=(raw:Data,fields:readonly string[]):Data=>Object.fromEntries(fields.map(key=>[key,typeof raw[key]==='boolean'?raw[key]:typeof raw[key]==='string'?text(raw[key]):number(raw[key])]));
const dimension=z.string().max(500).refine(value=>['all','missing','pending'].includes(value)||value.startsWith('v:')&&value.length>2,'筛选值无效');
const speedDimension=z.string().max(500).refine(value=>['all','missing'].includes(value)||value.startsWith('v:')&&value.length>2,'筛选值无效');
const moment=z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/).refine(value=>{
  const [day,time='00:00']=value.split('T'),[year,month,date]=day!.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const parsed=new Date(year!,month!-1,date!,hour!,minute!);
  return year!>=1970&&parsed.getFullYear()===year&&parsed.getMonth()===month!-1&&parsed.getDate()===date&&parsed.getHours()===hour&&parsed.getMinutes()===minute;
},'时间无效');
const rangeFields={range:z.enum(['today','yesterday','week','month','year','custom']).default('week'),from:moment.optional(),to:moment.optional()};
const validateBounds=(value:{range?:string;from?:string;to?:string},ctx:z.RefinementCtx)=>{
  if(value.range==='custom'){
    if(!value.from||!value.to)ctx.addIssue({code:'custom',message:'请选择开始与结束时间'});
    else{
      const start=new Date(value.from+(value.from.includes('T')?'': 'T00:00')).getTime();
      const end=new Date(value.to+(value.to.includes('T')?'': 'T23:59')).getTime()+59999;
      if(start>end||start>Date.now())ctx.addIssue({code:'custom',message:'开始时间不能晚于结束时间或当前时间'});
    }
  }else if(value.from!==undefined||value.to!==undefined)ctx.addIssue({code:'custom',message:'只有自定义时间段可以设置开始与结束时间'});
};
const tokenQuery=z.object({...rangeFields,source:z.enum(['all',...sourceIds]).default('all'),pricing:z.enum(['codex','api']).default('codex'),model:dimension.default('all'),tier:dimension.default('all'),effort:dimension.default('all')}).strict().superRefine((value,ctx)=>{
  validateBounds(value,ctx);
  if(value.source!=='codex'&&[value.model,value.tier,value.effort].some(item=>item!=='all'))ctx.addIssue({code:'custom',message:'模型、等级与推理强度筛选只适用于 Codex'});
});
const activityQuery=z.object({...rangeFields,view:z.enum(['activity','sessions','tools','skills','changes']).default('activity'),source:z.enum(['all',...sourceIds]).default('all')}).strict().superRefine(validateBounds);
const speedQuery=z.object({...rangeFields,source:z.enum(['native','router']).default('native'),model:speedDimension.default('all'),provider:speedDimension.default('all')}).strict().superRefine((value,ctx)=>{
  validateBounds(value,ctx);
  if(value.source==='native'&&value.provider!=='all')ctx.addIssue({code:'custom',message:'原生回复不支持提供商筛选'});
});
const quotaQuery=z.object({...rangeFields,range:z.enum(['today','yesterday','week','month','year','custom']).optional(),account:z.string().trim().min(1).max(500).optional(),days:z.enum(['1','7','30','90']).default('7')}).strict().superRefine(validateBounds);
const queryParams=(query:{range:string;from?:string;to?:string},extra:Record<string,string>={})=>{
  const params=new URLSearchParams({range:query.range,...extra});
  if(query.range==='custom'){params.set('from',query.from!);params.set('to',query.to!);}
  return params;
};
const options=(value:unknown)=>rows(value,500).flatMap(row=>typeof row.value==='string'&&typeof row.label==='string'?[{value:text(row.value),label:text(row.label)}]:[]);
const indexState=(value:unknown)=>{
  const raw=object(value);
  return {...scalar(raw,['running','cancelling','cancelled','completedFiles','totalBytes','doneBytes','readBytes','completedThreads','totalThreads','items','at']),error:raw.error?'统计索引未完成，请重试或在电脑控制台检查':null};
};

// Same reference-price snapshot as the authoritative console's web/api-prices.js.
// Native reported costs and Codex server-side pricing remain authoritative.
const referenceRates:[RegExp,[number,number,number|null,number,('USD'|'CNY')?]][]=[
  [/^(?:.*::)?ecnu-plus$|qwen3[.-]8-flash(?:-next)?$/,[.15,.016,.2,.47]],
  [/fable[- ]5[.-]1/,[10,.25,12.5,50]],[/fable[- ]5(?!\.1)/,[10,1,12.5,50]],
  [/opus[- ]5[.-]5/,[4,.2,5,20]],[/opus[- ]5(?!\.5)|opus[- ]4[.-][5-8]/,[5,.5,6.25,25]],
  [/sonnet[- ]5(?!\.\d)/,[2,.2,2.5,10]],[/sonnet[- ]4[.-][56]/,[3,.3,3.75,15]],[/haiku[- ]4[.-]5/,[1,.1,1.25,5]],
  [/grok-4\.[76]/,[2,.5,null,6]],[/grok-4\.5/,[2,.3,null,6]],[/grok-4\.3|grok-4\.20|grok-4-20/,[1.25,.2,null,2.5]],[/grok-build/,[1,.2,null,2]],
  [/gemini-3\.5[-\w.]*flash-lite/,[.3,.03,null,2.5]],[/gemini-3\.1[-\w.]*flash-lite/,[.25,.025,null,1.5]],
  [/gemini-3\.[678][-\w.]*flash(?!-lite)/,[.75,.075,null,3.75]],[/gemini-3\.5[-\w.]*flash(?!-lite)/,[1.5,.15,null,9]],
  [/gemini-3\.1[-\w.]*pro/,[2,.2,null,12]],[/gemini-3[-\w.]*flash(?!-lite)/,[.5,.05,null,3]],
  [/gemini-2\.5[-\w.]*flash-lite/,[.1,.01,null,.4]],[/gemini-2\.5[-\w.]*flash(?!-lite)/,[.3,.03,null,2.5]],[/gemini-2\.5[-\w.]*pro/,[1.25,.125,null,10]],
  [/glm-5\.3-flashx/,[.37,.075,0,1.25]],[/glm-5\.3-flash(?!x)/,[.15,.03,0,.5]],[/glm-5\.3(?!-flash)/,[1.4,.26,0,4.4]],
  [/glm-5\.2/,[8,2,0,28,'CNY']],[/glm-5\.1/,[6,1.3,0,24,'CNY']],[/glm-5-turbo/,[5,1.2,0,22,'CNY']],[/glm-5(?!\.|\d|-)/,[4,1,0,18,'CNY']],
  [/glm-4\.7-flashx/,[.5,.1,0,3,'CNY']],[/glm-4\.7-flash(?!x)/,[0,0,0,0,'CNY']],[/glm-4\.7(?!-flash)/,[2,.4,0,8,'CNY']],
  [/glm-4\.6v-flash/,[0,0,0,0,'CNY']],[/glm-4\.6v(?!-flash)/,[1,.2,0,3,'CNY']],[/glm-4\.5-air/,[.8,.16,0,2,'CNY']],
  [/glm-4-flashx/,[.1,.05,0,.1,'CNY']],[/glm-4-flash(?!x)/,[0,0,0,0,'CNY']],[/glm-z1-flash/,[0,0,0,0,'CNY']],
  [/glm-4-plus/,[5,2.5,0,5,'CNY']],[/glm-4-air/,[.5,.25,0,.5,'CNY']],[/glm-4-long/,[1,.5,0,1,'CNY']],
];
function referenceQuote(row:Data,folded:boolean){
  const rate=referenceRates.find(([pattern])=>pattern.test(String(row.id||'').toLowerCase()))?.[1];
  if(!rate||rate[2]===null&&count(row.cacheWrite)>0)return null;
  const fresh=Math.max(0,count(row.input)-count(row.cached)-(folded?count(row.cacheWrite):0));
  return {currency:rate[4]??'USD',value:(fresh*rate[0]+count(row.cached)*rate[1]+count(row.cacheWrite)*(rate[2]??0)+count(row.output)*rate[3])/1e6};
}

function tokenResult(raw:Data,source:Source,query:z.infer<typeof tokenQuery>){
  const result=consoleStatistics(raw,source,query.range,query.pricing),tokens=object(raw.tokens);
  const models=result.models.map(row=>{
    const quote=row.usd===null&&!['codex','hermes','deepseek','opencode','pi','research'].includes(source)?referenceQuote(row,source==='agy'||source==='claude'):null;
    return {...row,usd:row.usd??(quote?.currency==='USD'?quote.value:null),cny:quote?.currency==='CNY'?quote.value:null};
  });
  const reference=!['codex','agy','hermes','deepseek','opencode','pi','research'].includes(source),usd=models.filter(row=>row.usd!==null),cny=models.filter(row=>row.cny!==null);
  const cost=reference?{...result.cost,usd:usd.length?usd.reduce((sum,row)=>sum+count(row.usd),0):null,cny:cny.length?cny.reduce((sum,row)=>sum+count(row.cny),0):null,basis:'api-reference',priceDate:models.some(row=>/glm-5[.]3/i.test(row.id))?'2026-10-24':result.cost.priceDate||'2026-09-24',unpricedRecords:models.filter(row=>row.usd===null&&row.cny===null).reduce((sum,row)=>sum+row.records,0)}:result.cost;
  return {...result,
    models,cost,
    costDetail:source==='codex'?{...scalar(object(tokens.cost),['basis','date','inputUsd','cachedUsd','outputUsd','pricedSamples','unpricedSamples','longContextSamples','unpricedTokens','astraExemptSamples','solExemptSamples','assumedStandardSamples']),rates:rows(object(tokens.cost).rates,500).map(row=>({model:text(row.model),...scalar(row,['input','cached','output'])}))}:null,
    options:source==='codex'?{model:options(object(tokens.options).model),tier:options(object(tokens.options).tier),effort:options(object(tokens.options).effort)}:{},
    dimensions:source==='codex'?rows(tokens.groups,100).map(row=>({
      model:text(row.model),tier:text(row.tier),effort:text(row.effort),pending:row.pending===true||row.pending===1,
      ...scalar(row,['samples','input','cached','output','reasoning','total','cacheHitRate']),cost:scalar(object(row.cost),['usd','pricedSamples','unpricedSamples']),
    })):[],
    dimensionsTruncated:tokens.groupsTruncated===true,tokenCoverage:scalar(object(tokens.coverage),['samples','enriched']),
    coverage:{...result.coverage,available:object(raw.coverage).available!==false},
  };
}

async function tokenSource(client:LocalConsoleClient,source:Source,query:z.infer<typeof tokenQuery>,calendar=false){
  const params=queryParams(query,source==='codex'?{view:calendar?'calendar':'tokens',pricing:query.pricing,...(query.source==='codex'?{model:query.model,tier:query.tier,effort:query.effort}:{})}:source==='agy'?{}:{source});
  const route=(source==='codex'?'/api/analytics':source==='agy'?'/api/agy/usage':'/api/external/usage')+'?'+params;
  const raw=await client.managementRequest(route);
  if(calendar)return {source,points:rows(source==='codex'?object(raw.tokens).modelSeries:raw.modelSeries,50000).map(row=>({date:text(row.date),total:count(row.input)+count(row.output)+(source==='agy'?count(row.cached)+count(row.cacheWrite):source==='claude'?count(row.cacheRead)+count(row.cacheWrite):0)})),available:object(raw.coverage).available!==false};
  if(!raw.totals||source==='codex'&&!raw.tokens?.totals)throw new Error('统计数据尚未完整');
  return tokenResult(raw,source,query);
}

async function tokens(client:LocalConsoleClient,query:z.infer<typeof tokenQuery>){
  if(query.source!=='all')return {...await tokenSource(client,query.source,query),failedSources:[]};
  const settled=await Promise.allSettled(sourceIds.map(source=>tokenSource(client,source,query)));
  const parts:Data[]=settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  if(!parts.length)throw new Error('统计数据暂不可用');
  const totalFields=['input','cached','cacheWrite','output','reasoning','total','records'];
  const totals=Object.fromEntries(totalFields.map(key=>[key,parts.reduce((sum,part)=>sum+count(part.totals[key]),0)]));
  const daily=new Map<string,Data>();
  for(const part of parts)for(const point of part.series){const previous=daily.get(point.date)??{date:point.date,...Object.fromEntries(totalFields.map(key=>[key,0])),activeMinutes:null};for(const key of totalFields)previous[key]+=count(point[key]);daily.set(point.date,previous);}
  return {source:'all',range:query.range,since:Math.min(...parts.map(part=>count(part.since))),until:Math.max(...parts.map(part=>count(part.until))),updatedAt:new Date().toISOString(),totals,
    cost:{usd:null,basis:'mixed'},activity:null,models:parts.flatMap(part=>part.models.map((row:Data)=>({...row,source:part.source,id:sourceNames[part.source as Source]+' · '+row.id}))).sort((a,b)=>b.total-a.total),
    series:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),modelSeries:parts.flatMap(part=>part.modelSeries.map((row:Data)=>({...row,model:sourceNames[part.source as Source]+' · '+row.model}))),tools:[],
    index:{running:parts.some(part=>part.index.running),error:parts.some(part=>part.index.error)?'部分统计索引未完成':null},coverage:{available:parts.some(part=>part.coverage.available)},options:{},dimensions:[],
    sourceTotals:parts.map(part=>({source:part.source,label:sourceNames[part.source as Source],totals:part.totals,cost:part.cost,coverage:part.coverage})),
    failedSources:settled.flatMap((result,index)=>result.status==='rejected'?[sourceIds[index]]:[]),
  };
}

const speedFields=['samples','outputTokens','durationMs','averageTPS','p50TPS','p95TPS','p50DurationMs','p95DurationMs','firstOutputSamples','p50FirstOutputMs','p95FirstOutputMs','firstTextSamples','p50FirstTextMs','p95FirstTextMs'] as const;
function speedResult(raw:Data,query:z.infer<typeof speedQuery>){
  return {source:query.source,range:query.range,definition:query.source==='native'?'visible-text-estimate':'end-to-end',encoding:text(raw.encoding),
    filters:{source:query.source,model:query.model,provider:query.provider},options:{model:options(object(raw.options).model),provider:query.source==='router'?options(object(raw.options).provider):[]},
    totals:scalar(object(raw.totals),speedFields),coverage:scalar(object(raw.coverage),['available','requests','failed','unmeasured','excludedTests','excludedCompact']),progress:indexState(raw.progress),
    groups:rows(raw.groups,500).map(row=>({model:text(row.model),tier:text(row.tier),effort:text(row.effort),phase:text(row.phase),provider:text(row.provider),providerName:text(row.providerName),sessionCount:number(row.sessionCount),...scalar(row,speedFields),
      sessions:rows(row.sessions,5000).map(session=>({id:text(session.id),title:text(session.title,200),lastAt:number(session.lastAt),...scalar(session,speedFields)})),
    })),
    recent:rows(raw.recent,30).map(row=>({model:text(row.model),tier:text(row.tier),effort:text(row.effort),phase:text(row.phase),provider:text(row.provider),providerName:text(row.providerName),...scalar(row,['timestamp','outputTokens','durationMs','firstOutputMs','firstTextMs','endToEndTPS'])})),updatedAt:new Date().toISOString(),
  };
}

const activityFields=['activeMinutes','activeDays','activeSessions','newSessions','toolCalls','reads','writes','commands','other','input','cached','output','reasoning','totalTokens'] as const;
async function activity(client:LocalConsoleClient,query:z.infer<typeof activityQuery>){
  const range=query.view==='activity'?'year':query.range;
  const raw=await client.managementRequest('/api/analytics?'+queryParams({...query,range},{view:query.view}));
  const skills=object(raw.skills),scope=object(raw.scope);
  const result:Data={view:query.view,source:query.source,range,since:number(raw.since),until:number(raw.until),totals:scalar(object(raw.totals),activityFields),
    series:rows(raw.series,50000).map(row=>({date:text(row.date),...scalar(row,activityFields)})),tools:rows(raw.tools,30).map(row=>({name:text(row.name),category:text(row.category),count:number(row.count)})),
    skills:{totals:scalar(object(skills.totals),['reads','skills','sessions']),coverage:scalar(object(skills.coverage),['files','completed']),
      ranking:rows(skills.ranking,50).map(row=>({name:text(row.name),...scalar(row,['reads','sessions','lastRead'])})),recent:rows(skills.recent,100).map(row=>({name:text(row.name),session:text(row.session),time:number(row.time)})),
      definition:text(skills.definition,500)},
    scope:scalar(scope,['files','sessions','bytes','skippedRecords','pendingBytes','unknownFiles']),progress:indexState(raw.progress),
    activityDefinition:'含日志事件的分钟数（估算）',changeDefinition:'可识别的读写与执行调用',updatedAt:new Date().toISOString(),
  };
  if(query.view==='activity'){
    const selected=query.source==='all'?sourceIds:[query.source];
    const settled=await Promise.allSettled(selected.map(source=>tokenSource(client,source,{source:query.source,range:'year',pricing:'codex',model:'all',tier:'all',effort:'all'},true)));
    const calendar=new Map<string,number>();
    result.sourceTotals=[];
    settled.forEach((item,index)=>{if(item.status!=='fulfilled')return;const part=object(item.value);let total=0;for(const point of part.points){if(typeof point.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(point.date))continue;total+=count(point.total);calendar.set(point.date,(calendar.get(point.date)??0)+count(point.total));}result.sourceTotals.push({source:selected[index],total,available:part.available});});
    result.calendar=[...calendar].sort(([a],[b])=>a.localeCompare(b)).map(([date,total])=>({date,total}));
    result.failedSources=settled.flatMap((item,index)=>item.status==='rejected'?[selected[index]]:[]);
  }
  return result;
}

const errorLabels:Record<string,string>={quota:'上游额度不足',context:'上下文过长',image:'图片能力不兼容',auth:'认证失败',model:'模型不可用',permission:'权限不足',rate_limit:'上游限流',timeout:'上游响应超时',tls:'证书校验失败',dns:'域名解析失败',upstream:'上游故障',stream:'响应流中断',request:'请求失败'};
const redact=(value:unknown,max=800)=>text(value,max)?.replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').replace(/\bsk-[\w-]+/g,'[已隐藏]').replace(/(api[_-]?key|access_token|refresh_token|authorization)(["'\s:=]+)[^\s,;"'}]+/gi,'$1$2[已隐藏]').replace(/https?:\/\/\S+/g,'[上游地址]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[邮箱]')??null;
const quotaWindow=(value:unknown)=>scalar(object(value),['used_percent','reset_at','limit_window_seconds']);
function quotaResult(raw:Data,query:z.infer<typeof quotaQuery>){
  const latest=object(raw.latest),routing=object(raw.routing);
  return {range:query.range??'rolling',account:text(raw.accountKey),days:number(raw.days),autoSample:raw.autoSample!==false,lastError:raw.lastError?'上次额度采样失败，请检查电脑上的账号授权':null,
    sampleCount:number(raw.sampleCount),displayedCount:number(raw.displayedCount),rawCount:number(raw.rawCount),
    points:rows(raw.points,2000).map(row=>({...scalar(row,['timestamp','primary','secondary']),credits:creditBalance(row.credits)})),
    latest:{at:text(latest.at),plan:text(latest.plan),credits:creditBalance(latest.credits),primary:quotaWindow(latest.primary),secondary:quotaWindow(latest.secondary)},
    routing:{...scalar(routing,['requests','failed','measuredRequests','inputTokens','outputTokens']),recent:rows(routing.recent,30).map(row=>{
      const error=object(row.errorSummary),category=typeof error.category==='string'&&error.category in errorLabels?error.category:'request';
      return {model:text(row.model),provider:text(row.provider),resource:text(row.resource),...scalar(row,['timestamp','status','durationMs','inputTokens','outputTokens','cachedTokens','firstOutputMs']),
        failed:count(row.status)<200||count(row.status)>=400||!!row.errorCode,errorCode:redact(row.errorCode,80),
        error:row.errorCode||row.errorSummary?{category,label:errorLabels[category],message:redact(error.message),hint:redact(error.hint),requestId:redact(error.requestId,100)}:null};
    })},updatedAt:new Date().toISOString(),
  };
}

/** Fixed paired-device statistics surface. The local process token and arbitrary routes stay server-side. */
export function registerMobileStatistics(app:FastifyInstance,client=new LocalConsoleClient()){
  app.get('/api/mobile-management/statistics/quotas',(request,reply)=>respond(reply,async()=>{
    const {source,catalog}=z.object({source:z.enum(['all',...sourceIds]).default('all'),catalog:z.literal('1').optional()}).strict().parse(request.query);
    return client.managementRequest('/api/quota-overview?'+new URLSearchParams(catalog?{catalog}:{source}));
  }));
  app.post('/api/mobile-management/statistics/quotas/refresh',(request,reply)=>respond(reply,async()=>{
    const body=z.object({source:z.enum(['all',...sourceIds]).default('all')}).strict().parse(request.body);
    return client.managementRequest('/api/quota-overview/refresh',body);
  }));
  app.get('/api/mobile-management/statistics/quota/warmup',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);
    return client.managementRequest('/api/usage/warmup');
  }));
  app.post('/api/mobile-management/statistics/quota/warmup',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);
    const body=z.object({enabled:z.boolean(),windows:z.array(z.enum(['fiveHour','weekly'])).min(1).max(2),model:z.string().max(200).optional(),
      fiveHourSchedule:z.object({enabled:z.boolean(),times:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24),timeZone:z.string().min(1).max(100)}).strict().optional(),
      activeHours:z.object({enabled:z.boolean(),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timeZone:z.string().min(1).max(100)}).strict().optional()}).strict().parse(request.body);
    return client.managementRequest('/api/usage/warmup',body);
  }));
  const respond=async(reply:FastifyReply,operation:()=>Promise<unknown>)=>{
    try{return await operation();}catch(error){
      if(error instanceof z.ZodError)return reply.code(400).send({error:'统计参数无效，请检查时间段或筛选条件'});
      const status=number(object(error).status)===503?503:502;
      return reply.code(status).send({error:status===503?'电脑控制台暂不可用，请检查电脑连接':'统计读取或操作未完成，请重试或在电脑控制台检查'});
    }
  };
  app.get('/api/mobile-management/statistics/tokens',(request,reply)=>respond(reply,()=>tokens(client,tokenQuery.parse(request.query))));
  app.get('/api/mobile-management/statistics/requests',(request,reply)=>respond(reply,async()=>{
    const query=z.object({...rangeFields,source:z.enum(['all','router',...sourceIds]).default('all'),model:z.string().max(300).default('all'),
      pricing:z.enum(['codex','api']).default('codex'),purpose:z.enum(['all','normal','warmup','test']).default('all'),cursor:z.string().max(8192).default(''),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().superRefine(validateBounds).parse(request.query);
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,String(value));
    const raw=await client.managementRequest('/api/usage/requests?'+params);
    return {...scalar(raw,['range','source','model','pricing','purpose','refreshing','updatedAt']),hasMore:raw.hasMore===true,nextCursor:text(raw.nextCursor,8192),
      coverage:rows(raw.coverage,20).map(row=>({source:text(row.source),available:row.available===true})),
      rows:rows(raw.rows,100).map(row=>({...scalar(row,['id','source','time','model','provider','tier','requestedTier','tierBasis','effort','purpose','kind','requestCount','sessionId','status','failed','errorCode','inputTokens','cachedTokens','cacheWriteTokens','outputTokens','reasoningTokens','totalTokens','durationMs','firstByteMs','firstTextMs','firstOutputMs','afterFirstOutputMs','speedTokens','cacheHitRate','averageTPS','timingBasis']),cost:row.cost?scalar(object(row.cost),['usd','basis','pricing']):null}))};
  }));
  app.get('/api/mobile-management/statistics/activity',(request,reply)=>respond(reply,()=>activity(client,activityQuery.parse(request.query))));
  app.get('/api/mobile-management/statistics/speed',(request,reply)=>respond(reply,async()=>{
    const query=speedQuery.parse(request.query);
    const raw=await client.managementRequest('/api/usage/speed?'+queryParams(query,{source:query.source,model:query.model,provider:query.provider}));
    return speedResult(raw,query);
  }));
  app.get('/api/mobile-management/statistics/accounts',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);
    const raw=object((await client.managementRequest('/api/state')).accounts);
    return {items:rows(raw.items,500).flatMap(row=>typeof row.id==='string'?[{id:text(row.id),label:text(row.alias)||text(row.email)||'已保存账号',active:row.active===true}]:[])};
  }));
  app.get('/api/mobile-management/statistics/quota',(request,reply)=>respond(reply,async()=>{
    const query=quotaQuery.parse(request.query),params=query.range?queryParams({...query,range:query.range},{days:query.days}):new URLSearchParams({days:query.days});if(query.account)params.set('account',query.account);
    return quotaResult(await client.managementRequest('/api/usage/history?'+params),query);
  }));
  app.post('/api/mobile-management/statistics/index',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);
    const body=z.object({action:z.enum(['refresh','pause'])}).strict().parse(request.body);
    return {progress:indexState(await client.managementRequest('/api/analytics/'+body.action,{}))};
  }));
  app.post('/api/mobile-management/statistics/quota/auto',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);
    const body=z.object({enabled:z.boolean()}).strict().parse(request.body);
    const raw=await client.managementRequest('/api/usage/auto',body);
    if(raw.error||typeof raw.enabled!=='boolean'||raw.enabled!==body.enabled)throw new Error('采样设置未保存');
    return {enabled:raw.enabled===true};
  }));
  app.post('/api/mobile-management/statistics/quota/refresh',(request,reply)=>respond(reply,async()=>{
    z.object({}).strict().parse(request.query);z.object({}).strict().parse(request.body);
    const raw=await client.managementRequest('/api/usage',{},30000);
    if(raw.error||raw.ok===false)throw new Error('额度未刷新');
    return {refreshed:true};
  }));
}
