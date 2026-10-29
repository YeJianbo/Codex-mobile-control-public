import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {appHome,codexHome} from './paths.js';
import {statSync} from 'node:fs';
import {agyGenerationUsage} from './agyGenerationUsage.js';

type Tokens={input:number;cached:number;output:number;reasoning:number;total:number;last:number|null;contextWindow:number|null;context:number|null};
type Generation={model?:string;messageId?:string;input?:unknown;cached?:unknown;cacheWrite?:unknown;output?:unknown;reasoning?:unknown};
const nativeCache=new Map<string,{signature:string;tokens:Tokens|null}>();
export function agyContextWindow(model:string|undefined):number|null{
  const id=(model||'').replace(/^antigravity::/,'').replace(/-(low|medium|high|xhigh|max)$/,'');
  if(/^gemini[.-]/i.test(id))return 1_048_576;
  if(/^claude[.-]/i.test(id))return 200_000;
  if(/^gpt-oss/i.test(id))return 131_072;
  return null;
}
function sumGenerations(rows:Iterable<Generation>,model?:string):Tokens|null{
  const seen=new Set<string>(),totals={input:0,cached:0,output:0,reasoning:0};
  const metric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
  let last:number|null=null,context:number|null=null,lastModel=model;
  for(const value of rows){
    const key=value.messageId?JSON.stringify([value.model,value.messageId]):null;
    if(key&&seen.has(key))continue;if(key)seen.add(key);
    const cached=metric(value.cached),input=metric(value.input)+cached+metric(value.cacheWrite),output=metric(value.output);
    totals.input+=input;totals.cached+=cached;totals.output+=output;totals.reasoning+=metric(value.reasoning);
    last=input+output;context=last;lastModel=value.model||model;
  }
  return last===null?null:{...totals,total:totals.input+totals.output,last,context,contextWindow:agyContextWindow(lastModel)||agyContextWindow(model)};
}
function readNative(file:string,model?:string):Tokens|null{
  let db:DatabaseSync|undefined;
  try{
    const stat=statSync(file),wal=(()=>{try{return statSync(file+'-wal');}catch{return null;}})();
    const signature=[stat.size,stat.mtimeMs,wal?.size,wal?.mtimeMs,model].join(':');
    const cached=nativeCache.get(file);if(cached?.signature===signature)return cached.tokens;
    db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=100');
    const rows=db.prepare('SELECT data FROM gen_metadata WHERE length(data)<=16777216 ORDER BY idx').iterate() as Iterable<{data:Uint8Array}>;
    const generations=function*(){for(const row of rows){try{const usage=agyGenerationUsage(row.data);if(usage)yield usage;}catch{/* An unfinished metadata row is retried after the database changes. */}}};
    const tokens=sumGenerations(generations(),model);
    nativeCache.set(file,{signature,tokens});if(nativeCache.size>32)nativeCache.delete(nativeCache.keys().next().value!);
    return tokens;
  }catch{return null;}
  finally{db?.close();}
}

export function readAgySessionTokens(session:string,directory=path.join(codexHome(),'codexmate','local-console','analytics'),model?:string):Tokens|null{
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(session))return null;
  const file=path.join(directory,'agy-usage.sqlite');
  let db:DatabaseSync|undefined;
  try{
    const home=process.env.USERPROFILE||os.homedir();
    const conversations=['antigravity-cli','antigravity'].map(name=>path.join(home,'.gemini',name,'conversations',session+'.db'));
    for(const conversation of conversations){const tokens=readNative(conversation,model);if(tokens)return tokens;}
    db=new DatabaseSync(file,{readOnly:true});
    db.exec('PRAGMA busy_timeout=100');
    const rows=conversations.flatMap(conversation=>db!.prepare('SELECT data FROM usage WHERE lower(file)=lower(?) ORDER BY time,idx').all(conversation) as {data:string}[]);
    return sumGenerations(rows.map(row=>JSON.parse(row.data) as Generation),model);
  }catch{return null;}
  finally{db?.close();}
}

export function readAgyThreadTokens(threadId:string,directory=path.join(codexHome(),'codexmate','local-console','analytics')):Tokens|null{
  if(!/^antigravity-[a-f0-9-]{36}$/i.test(threadId))return null;
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path.join(appHome(),'state.sqlite'),{readOnly:true});
    db.exec('PRAGMA busy_timeout=500');
    const row=db.prepare('SELECT payload FROM agent_sessions WHERE id=?').get(threadId) as {payload:string}|undefined;
    const meta=row?JSON.parse(row.payload):null;
    if(meta?.transport==='acp'||typeof meta?.session!=='string')return null;
    return readAgySessionTokens(meta.session,directory,meta.actualModel||meta.model);
  }catch{return null;}
  finally{db?.close();}
}
