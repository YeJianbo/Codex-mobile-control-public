import {promises as fs} from 'node:fs';
import {compressedRolloutTail} from './rolloutReader.js';

export type TokenSnapshot={info:Record<string,any>;updatedAt:string;contextPending?:boolean;observedAt?:string;compactionStartedAt?:string};
const cache=new Map<string,{size:number;mtime:number;value:TokenSnapshot|null}>();
const tokenRow=/"(?:token_count|compacted|context_compacted|context_compaction)"/;
const isCompaction=(row:any)=>row.type==='compacted'||row.type==='event_msg'&&['context_compacted','context_compaction'].includes(row.payload?.type);
// Usage is a snapshot, not a delta. Reading the newest bounded tail avoids
// summing replayed counters or parsing a multi-gigabyte conversation transcript.
export async function readTokenSnapshot(file:string):Promise<TokenSnapshot|null>{
 if(file.endsWith('.jsonl.zst')){
  const tail=await compressedRolloutTail(file);let compactedAt:string|undefined;
  const lines=tail.buffer.toString('utf8').split('\n');lines.pop();
  for(let i=lines.length-1;i>=0;i--){
   if(!tokenRow.test(lines[i]))continue;
   let row:any;try{row=JSON.parse(lines[i]);}catch{continue;}
   if(isCompaction(row))compactedAt??=row.timestamp;
   if(row.type==='event_msg'&&row.payload?.type==='token_count'&&row.payload.info)return {info:row.payload.info,updatedAt:row.timestamp,...(compactedAt?{contextPending:true,observedAt:compactedAt}:{})};
  }
  return compactedAt?{info:{},updatedAt:compactedAt,observedAt:compactedAt,contextPending:true}:null;
 }
 const handle=await fs.open(file,'r');
 try{
  const {size,mtimeMs}=await handle.stat();const previous=cache.get(file);
  if(previous?.size===size&&previous.mtime===mtimeMs)return previous.value;
  let window=64*1024,value:TokenSnapshot|null=null,compactedAt:string|undefined;
  while(true){
   const start=Math.max(0,size-window),buffer=Buffer.alloc(size-start);
   const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
   const lines=buffer.subarray(0,bytesRead).toString('utf8').split('\n');
   // The first line may be truncated; the final line may still be being written.
   if(start)lines.shift();lines.pop();compactedAt=undefined;
   for(let i=lines.length-1;i>=0;i--){
    const line=lines[i];if(!tokenRow.test(line))continue;
    let row:any;try{row=JSON.parse(line);}catch{continue;}
    if(isCompaction(row))compactedAt??=row.timestamp;
    if(row.type==='event_msg'&&row.payload?.type==='token_count'&&row.payload.info){
     value={info:row.payload.info,updatedAt:row.timestamp,...(compactedAt?{contextPending:true,observedAt:compactedAt}:{})};break;
    }
   }
   if(value||start===0||window>=32*1024*1024)break;
   window*=2;
  }
  if(!value&&compactedAt)value={info:{},updatedAt:compactedAt,observedAt:compactedAt,contextPending:true};
  if(cache.size>=64&&!cache.has(file))cache.delete(cache.keys().next().value!);
  cache.set(file,{size,mtime:mtimeMs,value});return value;
 }finally{await handle.close();}
}

export function notificationTokenInfo(usage:any):Record<string,unknown>|null{
 if(!usage||!usage.last&&!usage.total)return null;
 const counts=(value:any)=>({input_tokens:value?.inputTokens,cached_input_tokens:value?.cachedInputTokens,output_tokens:value?.outputTokens,reasoning_output_tokens:value?.reasoningOutputTokens,total_tokens:value?.totalTokens});
 return {total_token_usage:counts(usage.total),last_token_usage:counts(usage.last),model_context_window:usage.modelContextWindow};
}
