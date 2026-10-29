import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {zcodeHome} from './zcodeAccount.js';

const metric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const modelWindows=new Map<string,number>();
export function registerZcodeModelWindows(models:any[]){
  for(const model of models){const window=metric(model.contextWindow);if(window&&model.ref)modelWindows.set(JSON.stringify([model.ref.providerId,model.ref.modelId]),window);}
}
export function zcodeSessionTokens(usage:any,previous:Record<string,number|null>={}){
  const total=metric(usage.total_tokens);
  return {input:metric(usage.input_tokens),cached:metric(usage.cache_read_input_tokens),output:metric(usage.output_tokens),reasoning:metric(usage.thinking_tokens),total,
    last:total===null?previous.last??null:Math.max(0,total-(previous.total??0)),
    context:metric(usage.context_used)??previous.context??null,contextWindow:metric(usage.context_window)??previous.contextWindow??null};
}
export function readZcodeSessionTokens(sessionId:string,previous:Record<string,number|null>={}){
  const file=path.join(process.env.ZCODE_STORAGE_DIR||path.join(zcodeHome(),'cli'),'db','db.sqlite');
  if(!fs.existsSync(file))return null;
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA busy_timeout=250');
    const row=db.prepare('SELECT COUNT(*) requests,SUM(input_tokens) input_tokens,SUM(output_tokens) output_tokens,SUM(reasoning_tokens) thinking_tokens,SUM(cache_read_input_tokens) cache_read_input_tokens FROM model_usage WHERE session_id=?').get(sessionId) as any;
    if(!row?.requests)return null;
    const latest=db.prepare('SELECT input_tokens,output_tokens,provider_id,model_id,started_at,completed_at FROM model_usage WHERE session_id=? AND completed_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1').get(sessionId) as any;
    const compact=db.prepare("SELECT MAX(time_updated) at FROM message WHERE session_id=? AND json_extract(data,'$.semantics.kind')='compact_summary'").get(sessionId) as any;
    const pending=compact?.at>Math.max(latest?.completed_at||0,latest?.started_at||0);
    const context=!pending&&latest&&metric(latest.input_tokens)!==null&&metric(latest.output_tokens)!==null?latest.input_tokens+latest.output_tokens:null;
    return {...zcodeSessionTokens({...row,total_tokens:row.input_tokens+row.output_tokens},previous),last:null,context,
      contextWindow:latest?modelWindows.get(JSON.stringify([latest.provider_id,latest.model_id]))??previous.contextWindow??null:previous.contextWindow??null,
      contextState:pending?'awaiting_usage':context===null?'unavailable':'estimated'};
  }finally{db.close();}
}
