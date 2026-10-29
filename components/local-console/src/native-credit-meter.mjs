import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Incremental native telemetry only. Older events without account and official
// window metadata stay unassigned instead of being charged to the current login.
export function nativeCreditRequests(file,accountKey,since,until,router=[]){
  if(!fs.existsSync(file))return [];
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA busy_timeout=250');
    if(!db.prepare('PRAGMA table_info(events)').all().some(row=>row.name==='credit_meter'))return [];
    const rows=db.prepare("SELECT time,session,model,tier,input,cached,output,credit_meter FROM events WHERE kind='token' AND time>? AND time<=? ORDER BY time LIMIT 10000").all(since,until);
    const previous=new Map(),result=[];
    for(const row of rows){
      const startedAt=previous.get(row.session);previous.set(row.session,row.time);
      if(startedAt==null)continue;
      let meter;try{meter=JSON.parse(row.credit_meter);}catch{continue;}
      if(!meter?.account||meter.provider!=='openai'||!(accountKey===meter.account||accountKey.endsWith('::'+meter.account)))continue;
      // Routed and native logs may group tokens differently. Exclude routed
      // sessions from native calibration rather than count the same work twice.
      if(router.some(request=>request.sessionId===row.session))continue;
      result.push({accountKey,provider:'openai',status:200,startedAt,timestampMs:row.time,sessionId:row.session,model:row.model,tier:row.tier,inputTokens:row.input,cachedTokens:row.cached,outputTokens:row.output,nativeMeter:meter});
    }
    return result;
  }finally{db.close();}
}
