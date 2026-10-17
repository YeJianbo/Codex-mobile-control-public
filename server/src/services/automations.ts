import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import TOML from '@iarna/toml';
import {codexHome} from './paths.js';
import {randomUUID} from 'node:crypto';
import {visibleThreadTitle,latestIndexEntries} from './codexSessions.js';
import {subagentMetadata} from './subagentThreads.js';

export type AutomationEdit={name?:string;prompt?:string;status?:'ACTIVE'|'PAUSED';schedule?:{frequency:'MINUTELY'|'HOURLY'|'DAILY'|'WEEKLY';interval:number};threadId?:string};
const validId=(id:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(id);
function file(id:string,home:string){if(!validId(id))throw Error('定时任务编号无效');return path.join(home,'automations',id,'automation.toml');}
async function read(id:string,home:string){
  const p=file(id,home);const stat=await fs.lstat(path.dirname(p));if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('定时任务目录无效');
  const text=await fs.readFile(p,'utf8');if(text.length>512000)throw Error('定时任务配置过大');
  const task=TOML.parse(text) as Record<string,any>;
  if(task.id!==id||task.version!==1||!['heartbeat','cron'].includes(task.kind))throw Error('定时任务配置不兼容');
  return task;
}
function timings(home:string){
  for(const name of ['codex-dev.db','codex.db']){
    let db:DatabaseSync|undefined;
    try{
      db=new DatabaseSync(path.join(home,'sqlite',name),{readOnly:true});
      const rows=db.prepare('SELECT id,status,rrule,next_run_at,last_run_at FROM automations').all() as Array<Record<string,any>>;
      return new Map(rows.map(row=>[row.id,row]));
    }catch{}finally{db?.close();}
  }
  return new Map<string,Record<string,any>>();
}
async function indexedNames(home:string){
  let text:string;try{text=await fs.readFile(path.join(home,'session_index.jsonl'),'utf8')}catch{return new Map<string,string>();}
  return new Map(latestIndexEntries(text).filter(row=>row.id&&row.thread_name?.trim()).map(row=>[row.id!,row.thread_name!.trim()]));
}
async function threadTargets(ids:string[],home:string){
  const names=await indexedNames(home);
  const targets=new Map<string,{threadTitle:string;threadPath:string}>();
  for(const id of ids)if(names.has(id))targets.set(id,{threadTitle:visibleThreadTitle(names.get(id)!),threadPath:''});
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path.join(home,'state_5.sqlite'),{readOnly:true});
    const columns=new Set((db.prepare('PRAGMA table_info(threads)').all() as {name:string}[]).map(row=>row.name));
    const fields=['name','title','cwd'].filter(name=>columns.has(name));
    if(!fields.length)return targets;
    const query=db.prepare(`SELECT ${fields.join(',')} FROM threads WHERE id=?`);
    for(const id of new Set(ids.filter(Boolean))){
      const row=query.get(id) as Record<string,unknown>|undefined;
      if(row)targets.set(id,{threadTitle:visibleThreadTitle(String(row.name||'').trim()||names.get(id)||String(row.title||'').trim()),threadPath:String(row.cwd||'')});
    }
  }catch{}finally{db?.close();}
  return targets;
}
// Metadata only: choosing a destination never resumes a conversation or reads its messages.
export async function listAutomationTargets(query='',limit=60,home=codexHome()){
  const names=await indexedNames(home);
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'),{readOnly:true});
  try{
    const columns=new Set((db.prepare('PRAGMA table_info(threads)').all() as {name:string}[]).map(row=>row.name));
    const fields=['id','name','title','cwd','source','agent_nickname','agent_role','agent_path'].filter(name=>columns.has(name));
    const order=columns.has('updated_at_ms')?'updated_at_ms DESC':'rowid DESC';
    const needle=query.trim().replaceAll('\\','/').toLocaleLowerCase();
    const found=[];
    for(const row of db.prepare(`SELECT ${fields.join(',')} FROM threads WHERE archived=0 ORDER BY ${order}`).iterate() as Iterable<Record<string,any>>){
      if(subagentMetadata(row))continue;
      const title=visibleThreadTitle(String(row.name||'').trim()||names.get(String(row.id))||String(row.title||'').trim())||'未命名会话';
      if(needle&&![row.id,title,row.cwd].some(value=>String(value||'').replaceAll('\\','/').toLocaleLowerCase().includes(needle)))continue;
      found.push({id:String(row.id),title,projectPath:String(row.cwd||'')});
      if(found.length>limit)break;
    }
    return {threads:found.slice(0,limit),hasMore:found.length>limit};
  }finally{db.close();}
}
function view(task:Record<string,any>,time?:Record<string,any>){
  const synced=!!time&&time.status===task.status&&String(time.rrule).replace(/^RRULE:/,'')===String(task.rrule).replace(/^RRULE:/,'');
  return {id:task.id,name:task.name,prompt:task.prompt,status:task.status,kind:task.kind,threadId:task.target_thread_id||'',
    rrule:task.rrule,nextRunAt:task.status==='ACTIVE'&&synced?time?.next_run_at??null:null,lastRunAt:time?.last_run_at??null,
    updatedAt:task.updated_at,model:task.model||'',effort:task.reasoning_effort||''};
}
export async function listAutomations(home=codexHome()){
  let names:string[];try{names=(await fs.readdir(path.join(home,'automations'),{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&validId(e.name)).map(e=>e.name)}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
  const times=timings(home);
  const tasks=await Promise.all(names.map(async id=>{try{const task=await read(id,home);return task.status==='DELETED'?null:view(task,times.get(id))}catch{return null}}));
  const rows=tasks.filter((t):t is NonNullable<typeof t>=>t!==null).sort((a,b)=>b.updatedAt-a.updatedAt);
  const targets=await threadTargets(rows.map(task=>task.threadId),home);
  return rows.map(task=>({...task,threadTitle:'',threadPath:'',...targets.get(task.threadId)}));
}
export async function saveAutomation(id:string|undefined,edit:AutomationEdit,home=codexHome()){
  let task:Record<string,any>;
  if(id)task=await read(id,home);
  else {
    if(!edit.threadId||!edit.name||!edit.prompt||!edit.schedule)throw Error('请选择会话并填写任务内容和时间');
    id='mobile-'+randomUUID();task={version:1,id,kind:'heartbeat',target_thread_id:edit.threadId,created_at:Date.now(),status:'ACTIVE'};
  }
  if(edit.name!==undefined)task.name=edit.name;
  if(edit.prompt!==undefined)task.prompt=edit.prompt;
  if(edit.status!==undefined)task.status=edit.status;
  if(edit.threadId!==undefined&&edit.threadId!==task.target_thread_id){
    if(task.kind!=='heartbeat')throw Error('此任务每次新建会话，不能绑定已有会话');
    task.target_thread_id=edit.threadId;
  }
  if(edit.schedule)task.rrule=`FREQ=${edit.schedule.frequency};INTERVAL=${edit.schedule.interval}`;
  task.updated_at=Date.now();
  const target=file(id,home);await fs.mkdir(path.dirname(target),{recursive:true});
  const temporary=target+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,TOML.stringify(task as TOML.JsonMap),{mode:0o600});await fs.rename(temporary,target)}
  finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}
  const saved=view(await read(id,home));
  return {...saved,threadTitle:'',threadPath:'',...(await threadTargets([saved.threadId],home)).get(saved.threadId)};
}
