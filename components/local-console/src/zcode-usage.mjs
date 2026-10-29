import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const count=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const timestamp=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;

/** Native model_usage is one row per attempt, including failed and cancelled requests. */
export function readZcodeUsage(home,{environment=process.env}={}){
 const file=path.join(environment.ZCODE_STORAGE_DIR||path.join(environment.ZCODE_DATA_BASE_DIR||home,'.zcode','cli'),'db','db.sqlite');
 if(!fs.existsSync(file))return {rows:[],coverage:{kind:'tokens',available:false,reasoningIncludedInOutput:true}};
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=250');
  const columns=new Set(db.prepare('PRAGMA table_info(model_usage)').all().map(column=>column.name));
  if(!columns.has('started_at')||!columns.has('model_id'))throw Error('ZCode model_usage 表缺少必要字段');
  const fields=['id','logical_request_id','attempt_index','provider_id','variant','turn_id','status','completed_at','duration_ms','time_to_first_token_ms','first_token_at','finish_reason','error_code','error_type','cancelled_by_user','query_source','input_tokens','output_tokens','reasoning_tokens','cache_creation_input_tokens','cache_read_input_tokens','session_id','started_at','model_id'];
  const selected=fields.map(field=>columns.has(field)?field:`NULL AS ${field}`);
  const rows=[];
  for(const item of db.prepare(`SELECT rowid AS usage_id,${selected.join(',')} FROM model_usage`).iterate()){
   const time=timestamp(item.started_at);if(!Number.isFinite(time))continue;
   const end=timestamp(item.completed_at),first=timestamp(item.first_token_at);
   const nativeStatus=String(item.status||'').toLowerCase(),cancelled=!!item.cancelled_by_user||nativeStatus==='cancelled';
   const complete=['success','completed','succeeded','ok'].includes(nativeStatus);
   // Successful native rows can retain the error of an earlier internal retry.
   // The final status wins, otherwise recovered requests appear as failures.
   const failed=!complete&&(!!item.error_code||!!item.error_type||['failed','error'].includes(nativeStatus));
   rows.push({
    // Preserve the pre-integration identity so refreshing cannot duplicate retained history.
    usageId:JSON.stringify([item.usage_id,item.session_id,item.started_at]),
    nativeRequestId:item.id||null,logicalRequestId:item.logical_request_id||null,attempt:measured(item.attempt_index),
    time,model:item.model_id,sessionId:item.session_id,turnId:item.turn_id,provider:item.provider_id,effort:item.variant,
    input:count(item.input_tokens),output:count(item.output_tokens),reasoning:count(item.reasoning_tokens),
    cacheRead:count(item.cache_read_input_tokens),cacheWrite:count(item.cache_creation_input_tokens),requests:1,
    durationMs:measured(item.duration_ms)??(Number.isFinite(end)&&end>=time?end-time:null),
    // ZCode records first token, which can be reasoning; do not call it first visible text.
    firstOutputMs:measured(item.time_to_first_token_ms)??(Number.isFinite(first)&&first>=time?first-time:null),
    status:cancelled?499:failed?500:complete?200:null,
    errorCode:complete?null:item.error_code||item.error_type||(cancelled?'cancelled':failed?'request_failed':null),
    nativeStatus:item.status||null,finishReason:item.finish_reason||null,
   });
  }
  return {rows,coverage:{kind:'tokens',available:true,reasoningIncludedInOutput:true}};
 }finally{db.close();}
}
