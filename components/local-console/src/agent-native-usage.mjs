import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {agyPrice} from './agy-usage.mjs';
import {estimateTokenCost} from './token-pricing.mjs';

const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
function files(root,depth=0){
  if(depth>8||!fs.existsSync(root))return [];
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(root,entry.name),depth+1):entry.isFile()&&entry.name.endsWith('.jsonl')?[path.join(root,entry.name)]:[]);
}
export async function readPiUsage(home,environment=process.env){
  const agentDir=environment.PI_CODING_AGENT_DIR||path.join(home,'.pi','agent');
  let configured;try{configured=JSON.parse(fs.readFileSync(path.join(agentDir,'settings.json'),'utf8')).sessionDir;}catch{}
  const root=typeof configured==='string'&&configured.trim()?path.resolve(agentDir,configured):path.join(agentDir,'sessions'),rows=[];let skippedFiles=0;
  for(const file of files(root)){
    let sessionId=file;
    try{
      const input=fs.createReadStream(file,{encoding:'utf8'}),lines=readline.createInterface({input,crlfDelay:Infinity});
      try{for await(const line of lines){
        if(line.length>1024*1024)continue;
        let entry;try{entry=JSON.parse(line);}catch{continue;}
        if(entry.type==='session'){sessionId=entry.id||file;continue;}
        const message=entry.type==='message'&&entry.message?.role==='assistant'?entry.message:null;
        const usage=message?.usage??(entry.type==='usage'?entry.usage:null);
        const model=message?.model??entry.model,provider=message?.provider??entry.provider,at=Date.parse(entry.timestamp);
        if(!usage||!model||!Number.isFinite(at)||!entry.id)continue;
        const fresh=count(usage.input),cacheRead=count(usage.cacheRead),cacheWrite=count(usage.cacheWrite),output=count(usage.output);
        if(!fresh&&!cacheRead&&!cacheWrite&&!output)continue;
        const row={usageId:JSON.stringify(['pi',sessionId,entry.id]),sessionId,time:at,model,provider:provider||'',input:fresh+cacheRead+cacheWrite,cacheRead,cacheWrite,output,reasoning:count(usage.reasoning),requests:1,turns:0};
        // Pi computes cost from local model configuration; zero can mean no price configured.
        if(Number.isFinite(usage.cost?.total)&&usage.cost.total>0)row.cost={basis:'native_estimate',usd:usage.cost.total};
        rows.push(row);
      }}finally{lines.close();input.destroy();}
    }catch{skippedFiles++;}
  }
  return {rows,coverage:{available:fs.existsSync(root),periodBasis:'native_events',skippedFiles}};
}

export function readResearchAgentUsage(dataDir){
  const dbs=[path.join(dataDir,'agent','agent.sqlite')],disciplines=path.join(dataDir,'disciplines');
  if(fs.existsSync(disciplines))for(const entry of fs.readdirSync(disciplines,{withFileTypes:true}))if(entry.isDirectory())dbs.push(path.join(disciplines,entry.name,'agent','agent.sqlite'));
  const rows=new Map();let databases=0,errors=0;
  for(const file of dbs){
    if(!fs.existsSync(file))continue;
    let db;
    try{
      db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=250');
      for(const event of db.prepare("SELECT seq,session_id,payload,created FROM agent_events WHERE kind='usage' AND json_extract(payload,'$.scope')='request' AND json_extract(payload,'$.source') LIKE 'api.%' AND COALESCE(json_extract(payload,'$.cumulative'),0)=0").iterate()){
        let value;try{value=JSON.parse(event.payload);}catch{continue;}
        if(value.invalid||!Number.isFinite(Date.parse(event.created)))continue;
        const input=value.totalInputTokens,output=value.outputTokens;
        if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)continue;
        const cacheRead=count(value.cacheReadTokens),cacheWrite=count(value.cacheWriteTokens);
        if(cacheRead+cacheWrite>input)continue;
        const id=JSON.stringify(['research',file,event.session_id,value.source,value.requestId||event.seq]);
        const row={usageId:id,sessionId:event.session_id,time:Date.parse(event.created),model:value.model||'未知模型',provider:value.backend||'',input,output,cacheRead,cacheWrite,reasoning:count(value.reasoningTokens),requests:1,turns:0,durationMs:value.elapsedMs,partialUsage:value.cacheReadTokens===undefined};
        const estimate=agyPrice({model:row.model,input:input-cacheRead-cacheWrite,cached:cacheRead,cacheWrite,output});
        if(!row.partialUsage&&estimate&&!estimate.partial)row.cost={basis:'official_reference',usd:estimate.usd};
        else if(!row.partialUsage&&cacheWrite===0){const price=estimateTokenCost({model:row.model,input,cached:cacheRead,output},'api');if(price)row.cost={basis:'official_reference',usd:price.usd};}
        rows.set(id,row);
      }
      databases++;
    }catch{errors++;}finally{db?.close();}
  }
  return {rows:[...rows.values()],coverage:{available:databases>0,periodBasis:'native_requests',databases,errors}};
}
