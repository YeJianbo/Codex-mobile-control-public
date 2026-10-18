import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {classifyTool} from './analytics-core.mjs';
import {localDate} from './usage-dates.mjs';

const count=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
const validCount=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const time=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
const label=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,'').slice(0,256):'';

function tokens(value){
  if(!value||!validCount(value.input)||!validCount(value.output))return null;
  const cacheRead=count(value.cache?.read),cacheWrite=count(value.cache?.write),reasoning=count(value.reasoning);
  // OpenCode stores uncached input and non-reasoning output in separate buckets.
  const input=value.input+cacheRead+cacheWrite,output=value.output+reasoning;
  return {input,output,cacheRead,cacheWrite,reasoning,partialUsage:validCount(value.total)&&value.total!==input+output};
}

function toolCategory(name){
  if(/^(write|edit|multiedit|apply_patch)$/.test(name))return 'write';
  if(/^(read|glob|grep|list|webfetch|websearch|codesearch|lsp)$/.test(name))return 'read';
  if(name==='bash')return 'command';
  return classifyTool(name);
}

export function readOpenCodeUsage(home){
  const file=path.join(home,'opencode.db');
  const coverage={kind:'tokens',available:false,periodBasis:'native_calls',recordBasis:'step_finish_or_message',inputIncludesCache:true,reasoningIncludedInOutput:true,nativeCost:true};
  if(!fs.existsSync(file))return {rows:[],events:[],coverage};
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON;PRAGMA busy_timeout=1000;BEGIN');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    if(!['session','message','part'].every(name=>tables.has(name)))throw new Error('OpenCode 统计数据库格式不受支持');
    const sessions=new Map(db.prepare('SELECT id,time_created FROM session').all().map(row=>[row.id,row]));
    // Project only metering fields; prompt bodies, tool input and tool output never leave SQLite.
    const messages=db.prepare(`SELECT id,session_id,time_created,
      json_extract(data,'$.role') role,json_extract(data,'$.parentID') parent_id,
      json_extract(data,'$.time.created') created,json_extract(data,'$.time.completed') completed,
      json_extract(data,'$.modelID') model,json_extract(data,'$.providerID') provider,
      json_extract(data,'$.tokens') tokens,json_extract(data,'$.cost') cost,
      json_extract(data,'$.finish') finish,json_type(data,'$.error') error
      FROM message WHERE json_valid(data) ORDER BY time_created,id`).all();
    const byMessage=new Map(messages.map(row=>[row.id,row]));
    const parts=db.prepare(`SELECT id,message_id,session_id,time_created,time_updated,
      json_extract(data,'$.type') type,json_extract(data,'$.tokens') tokens,
      json_extract(data,'$.cost') cost,json_extract(data,'$.tool') tool,
      json_extract(data,'$.time.start') start,json_extract(data,'$.time.end') end,
      json_extract(data,'$.state.time.start') tool_start,json_extract(data,'$.state.time.end') tool_end
      FROM part WHERE json_valid(data) AND json_extract(data,'$.type') IN ('step-start','step-finish','tool','text','reasoning')
      ORDER BY time_created,id`).all();
    const rows=[],events=new Map(),steps=new Map();
    const event=(kind,sessionId,at,extra={})=>{
      if(!time(at))return;
      const moment=kind==='activity'?Math.floor(at/60000)*60000:at;
      const usageId=JSON.stringify(['opencode',file,kind,sessionId,extra.partId||moment]);
      events.set(usageId,{usageId,kind,sessionId,time:moment,...extra});
    };
    for(const session of sessions.values())event('session',session.id,session.time_created);
    let skippedInheritedMessages=0,failedMessages=0,messageFallbacks=0,stepRecords=0;
    for(const message of messages){
      message.created=time(message.created)||time(message.time_created);
      // Session.fork copies the original message times while assigning fresh row IDs.
      message.inherited=message.created<sessions.get(message.session_id)?.time_created;
      if(message.inherited){skippedInheritedMessages++;continue;}
      event('activity',message.session_id,message.created);
      event('activity',message.session_id,message.completed);
      if(message.role==='assistant'&&message.error&&message.error!=='null')failedMessages++;
    }
    for(const part of parts){
      const message=byMessage.get(part.message_id);
      if(!message||message.inherited||message.session_id!==part.session_id)continue;
      for(const at of [part.time_created,part.time_updated,part.start,part.end,part.tool_start,part.tool_end])event('activity',part.session_id,at);
      if(part.type==='tool'){
        const name=label(part.tool)||'unknown';
        event('tool',part.session_id,time(part.tool_start)||part.time_created,{partId:part.id,tool:name,category:toolCategory(name)});
      }
      if(part.type==='step-finish'&&message.role==='assistant'){
        let usage;try{usage=tokens(JSON.parse(part.tokens));}catch{}
        if(!usage)continue;
        if(!steps.has(message.id))steps.set(message.id,[]);
        steps.get(message.id).push({part,usage});
      }
    }
    const turns=new Set();
    for(const message of messages){
      if(message.inherited||message.role!=='assistant')continue;
      const calls=steps.get(message.id)||[];
      if(!calls.length){
        let usage;try{usage=tokens(JSON.parse(message.tokens));}catch{}
        // Failed/in-flight messages start with zero placeholders, not a measured API call.
        if(usage&&(message.finish||usage.input+usage.output>0||amount(message.cost)>0)){
          calls.push({usage});messageFallbacks++;
        }
      }else stepRecords+=calls.length;
      for(const {part,usage}of calls){
        const at=time(part?.time_created)||time(message.completed)||message.created;
        if(!at)continue;
        const parent=byMessage.get(message.parent_id),turn=JSON.stringify([message.session_id,message.parent_id]);
        const firstTurn=parent?.role==='user'&&!parent.inherited&&!turns.has(turn);
        if(firstTurn)turns.add(turn);
        const usd=amount(part?part.cost:message.cost);
        rows.push({usageId:JSON.stringify(['opencode',file,message.session_id,message.id,part?.id||'message']),nativeMessageId:message.id,measurement:part?'step':'message',
          time:at,firstTime:message.created,sessionId:message.session_id,model:label(message.model)||'未知模型',provider:label(message.provider)||'未知供应商',billingMode:'',
          ...usage,requests:1,turns:firstTurn?1:0,cost:{usd,basis:usd===null?'unknown':'native_estimate'}});
      }
    }
    return {rows,events:[...events.values()],coverage:{...coverage,available:true,stepRecords,messageFallbacks,skippedInheritedMessages,failedMessages}};
  }finally{db.close();}
}

export function openCodeActivitySummary(events,rows,{since,until},coverage){
  const empty=()=>({activeMinutes:0,activeSessions:0,newSessions:0,input:0,cached:0,output:0,reasoning:0,reads:0,writes:0,commands:0,other:0});
  const days=new Map(),minutes=new Set(),sessions=new Set(),tools=new Map();
  const dayAt=at=>{const date=localDate(at);if(!days.has(date))days.set(date,{date,...empty(),minutes:new Set(),sessions:new Set()});return days.get(date);};
  for(const event of events){
    if(event.time<since||event.time>until)continue;
    const day=dayAt(event.time);
    if(event.kind==='session')day.newSessions++;
    if(event.kind==='activity'){
      day.minutes.add(event.time);day.sessions.add(event.sessionId);minutes.add(event.time);sessions.add(event.sessionId);
    }
    if(event.kind==='tool'){
      const category=['read','write','command'].includes(event.category)?event.category:'other';
      day[{read:'reads',write:'writes',command:'commands',other:'other'}[category]]++;
      const key=JSON.stringify([event.tool,category]),tool=tools.get(key)||{name:event.tool,category,count:0};tool.count++;tools.set(key,tool);
    }
  }
  for(const row of rows){
    if(row.time<since||row.time>until)continue;
    const day=dayAt(row.time);day.input+=count(row.input);day.cached+=count(row.cacheRead);day.output+=count(row.output);day.reasoning+=count(row.reasoning);
  }
  const series=[],start=new Date(since);start.setHours(0,0,0,0);
  for(const date=new Date(start);date.getTime()<=until;date.setDate(date.getDate()+1)){
    const key=localDate(date.getTime()),day=days.get(key);
    if(day){const {minutes,sessions,...item}=day;series.push({...item,activeMinutes:minutes.size,activeSessions:sessions.size});}
    else series.push({date:key,...empty()});
  }
  const totals=empty();
  for(const day of series)for(const field of Object.keys(totals))totals[field]+=day[field];
  Object.assign(totals,{activeMinutes:minutes.size,activeSessions:sessions.size,activeDays:series.filter(row=>row.activeMinutes>0).length});
  totals.toolCalls=totals.reads+totals.writes+totals.commands+totals.other;totals.totalTokens=totals.input+totals.output;
  return {source:'opencode',since,until,totals,series,tools:[...tools.values()].sort((a,b)=>b.count-a.count).slice(0,30),
    scope:{source:'opencode-native-sqlite',sessions:new Set(events.map(row=>row.sessionId)).size,usageRecords:rows.length},coverage,
    activityDefinition:'原生消息、部件与工具时间点所在的分钟数（不是连续工作时长）',changeDefinition:'原生工具调用分类'};
}
