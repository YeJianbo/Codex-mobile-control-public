import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parse} from 'smol-toml';
import {randomUUID} from 'node:crypto';
import {resolveRollout,rolloutTail} from './rollout-reader.mjs';
import {nativeSessionTitle} from './native-speed.mjs';

const subagentSources=['subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther'];
function sourceFilter(source){if(!['interactive','subagent'].includes(source))throw new Error('会话来源无效');return source==='subagent'?{sourceKinds:subagentSources}:{};}
function isSubagent(thread){const source=thread.source??thread.threadSource;return typeof source==='string'?/^sub_?agent/i.test(source):!!source&&typeof source==='object'&&Object.keys(source).some(key=>/^sub_?agent/i.test(key));}

function sessionFile(home,thread){
  if(!thread.path)return null;
  try{const file=resolveRollout(thread.path),normalize=p=>process.platform==='win32'?p.toLowerCase():p;
    const allowed=['sessions','archived_sessions'].some(name=>{const root=path.join(home,name);return fs.existsSync(root)&&normalize(file).startsWith(normalize(fs.realpathSync(root)+path.sep));});
    if(!allowed)return null;const stat=fs.statSync(file);return stat.isFile()?{file,bytes:stat.size}:null;
  }catch{return null;}
}
const threadTitle=t=>nativeSessionTitle({...t,agent_nickname:t.agentNickname||t.agent_nickname,agent_role:t.agentRole||t.agent_role,agent_path:t.agentPath||t.agent_path});
const numericFilter=(value,label,max)=>{const n=Number(value||0);if(!Number.isFinite(n)||n<0||n>max)throw new Error(label+'无效');return n;};

const compressedActivityCache=new Map();
function tailActivity(bytes){
  const lines=bytes.toString('utf8').split('\n');
  for(let i=lines.length-1;i>=0;i--){let v;try{v=JSON.parse(lines[i]);}catch{continue;}if(v.type!=='event_msg')continue;if(v.payload?.type==='task_started')return 'inProgress';if(['task_complete','turn_aborted'].includes(v.payload?.type))return 'idle';}
  return 'unknown';
}
export function sessionActivity(home,thread){
  if(['inProgress','active'].includes(thread.status?.type))return 'inProgress';
  if(thread.status?.type==='idle')return 'idle';
  const resolved=sessionFile(home,thread);if(!resolved)return 'unknown';
  const {file}=resolved;
  if(file.endsWith('.jsonl.zst'))return compressedActivity(file);
  let fd;
  try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,bytes=Buffer.alloc(Math.min(size,512*1024));fs.readSync(fd,bytes,0,bytes.length,size-bytes.length);return tailActivity(bytes);}
  catch{return 'unknown';}finally{if(fd!==undefined)fs.closeSync(fd);}
}
async function compressedActivity(file){
  try{
    const stat=fs.statSync(file),stamp=JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);
    const cached=compressedActivityCache.get(file);if(cached?.stamp===stamp&&cached.expires>Date.now())return cached.value;
    const value=tailActivity(await rolloutTail(file)),after=fs.statSync(file);
    if(JSON.stringify([after.dev,after.ino,after.size,after.mtimeMs,after.ctimeMs])!==stamp)return 'unknown';
    if(compressedActivityCache.size>=200)compressedActivityCache.delete(compressedActivityCache.keys().next().value);
    compressedActivityCache.set(file,{stamp,value,expires:Date.now()+60000});return value;
  }catch{return 'unknown';}
}

class NativeClient {
  constructor(home){this.home=home;this.pending=new Map();this.seq=0;this.buffer='';this.closed=false;}
  async start(){
    const config=parse(fs.readFileSync(path.join(this.home,'config.toml'),'utf8'));
    const exe=process.env.CODEX_CLI_PATH||config.mcp_servers?.node_repl?.env?.CODEX_CLI_PATH;
    if(!exe||!fs.existsSync(exe))throw new Error('未找到本机 Codex CLI，请配置 CODEX_CLI_PATH');
    this.child=spawn(exe,['app-server','--listen','stdio://'],{windowsHide:true,env:{...process.env,CODEX_HOME:this.home},stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>this.fail(new Error('Codex 会话接口连接中断')));
    this.child.on('error',()=>this.fail(new Error('Codex 会话接口无法启动')));
    this.child.on('exit',code=>this.fail(new Error(`Codex 会话接口已退出 (${code})`)));
    this.child.stdout.on('data',chunk=>{this.buffer+=chunk;if(this.buffer.length>8*1024*1024){this.fail(new Error('会话列表响应过大'));this.close();return;}let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);let v;try{v=JSON.parse(line);}catch{continue;}const p=this.pending.get(v.id);if(!p)continue;this.pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(new Error(v.error.message||'Codex 会话操作失败')):p.resolve(v.result);}});
    try{await this.request('initialize',{clientInfo:{name:'local-console-sessions',version:'0.4.0'},capabilities:{experimentalApi:true}});}catch(e){this.close();throw e;}
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return this;
  }
  request(method,params){if(this.closed)return Promise.reject(new Error('会话连接已关闭'));return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex 会话操作超时'));this.close();},30000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  fail(e){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
  close(){this.fail(new Error('会话连接已关闭'));this.child?.stdin.end();this.child?.kill();}
}
export class SessionService {
  constructor(home,{clientFactory=async()=>new NativeClient(home).start(),idleMs=30000,useStateDbOnly}={}){
    this.home=home;this.factory=clientFactory;this.idleMs=idleMs;this.mutating=false;this.queue=Promise.resolve();this.plans=new Map();this.closed=false;
    // Existing Desktop state is authoritative; fresh test/CLI homes still need initial log discovery.
    this.useStateDbOnly=useStateDbOnly??(fs.existsSync(home)&&fs.readdirSync(home).some(n=>/^state_\d+\.sqlite$/.test(n)));
  }
  listParams(params){return {...params,...(this.useStateDbOnly?{useStateDbOnly:true}:{})};}
  use(fn){
    const run=async()=>{
      if(this.closed)throw new Error('会话服务已关闭');clearTimeout(this.idleTimer);
      try{if(!this.client||this.client.closed){this.client?.close();this.client=await this.factory();}if(this.closed){this.client.close();throw new Error('会话服务已关闭');}return await fn(this.client);}
      finally{if(!this.closed){this.idleTimer=setTimeout(()=>{this.client?.close();this.client=null;},this.idleMs);this.idleTimer.unref?.();}}
    };
    const result=this.queue.then(run,run);this.queue=result.catch(()=>{});return result;
  }
  close(){this.closed=true;clearTimeout(this.idleTimer);this.client?.close();this.client=null;this.plans.clear();}
  async describe(thread,{archived=false,selected=false}={}){
    const file=sessionFile(this.home,thread),activity=await sessionActivity(this.home,thread);
    return {id:thread.id,title:threadTitle(thread),cwd:thread.cwd||'',createdAt:thread.createdAt,updatedAt:thread.updatedAt,status:archived?'archived':activity,activity,archived,pinned:!!thread.isPinned,isSubagent:isSubagent(thread),agentRole:thread.agentRole||null,logBytes:file?.bytes??null,selected};
  }
  async list({archived=false,cursor=null,search='',source='interactive',cwd='',olderThanDays=0,minBytes=0,onlyIdle=false}={}){
    if(typeof search!=='string'||search.length>200||cursor&&typeof cursor!=='string'||typeof cwd!=='string'||cwd.length>2000||typeof onlyIdle!=='boolean')throw new Error('会话查询参数无效');
    olderThanDays=numericFilter(olderThanDays,'保留天数',36500);minBytes=numericFilter(minBytes,'日志大小',1e12);const sources=sourceFilter(source),cutoff=Date.now()/1000-olderThanDays*86400;
    return this.use(async c=>{
      const visited=new Set();let next=cursor;
      for(let page=0;page<100;page++){
        if(visited.has(next))throw new Error('会话分页未前进');visited.add(next);
        const r=await c.request('thread/list',this.listParams({archived:!!archived,cursor:next,limit:50,sortKey:'updated_at',modelProviders:[],...sources,...(search?{searchTerm:search}:{}),...(cwd?{cwd}:{})}));
        const all=[];for(const t of r.data||[])all.push(await this.describe(t,{archived}));
        const threads=all.filter(t=>(!olderThanDays||Number.isFinite(t.updatedAt)&&t.updatedAt<=cutoff)&&(!minBytes||t.logBytes!=null&&t.logBytes>=minBytes)&&(!onlyIdle||t.activity==='idle'));
        next=r.nextCursor||null;
        if(threads.length||!next||page===99)return {threads,nextCursor:next,projects:[...new Set(all.map(t=>t.cwd).filter(Boolean))],pageLogBytes:threads.reduce((sum,t)=>sum+(t.logBytes||0),0),unknownSizes:threads.filter(t=>t.logBytes==null).length};
      }
    });
  }
  validateIds(ids){if(!Array.isArray(ids)||!ids.length||ids.length>30||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(id)))throw new Error('请选择 1–30 个有效会话');return [...new Set(ids)];}
  async archivedMatches(c,ids,source='interactive'){
    const wanted=new Set(ids),found=new Map();let cursor=null;const visited=new Set();
    for(let page=0;page<100&&found.size<wanted.size;page++){
      if(visited.has(cursor))throw new Error('归档列表分页未前进');visited.add(cursor);
      const r=await c.request('thread/list',this.listParams({archived:true,cursor,limit:50,sortKey:'updated_at',modelProviders:[],...sourceFilter(source)}));
      for(const thread of r.data||[])if(wanted.has(thread.id))found.set(thread.id,thread);
      if(!r.nextCursor)break;cursor=r.nextCursor;
    }
    return found;
  }
  async tree(c,root,{includeArchived=false,rootArchived=false}={}){
    const entries=new Map([[root.id,{thread:root,archived:rootArchived}]]);
    for(const archived of includeArchived?[false,true]:[false]){
      let cursor=null;const visited=new Set();
      for(let page=0;;page++){
        if(page>=100||visited.has(cursor))throw new Error('无法完整读取子会话，请缩小清理范围');visited.add(cursor);
        const r=await c.request('thread/list',this.listParams({ancestorThreadId:root.id,archived,cursor,limit:50,modelProviders:[],sourceKinds:subagentSources}));
        for(const thread of r.data||[])if(thread.id!==root.id)entries.set(thread.id,{thread,archived});
        if(entries.size>5000)throw new Error('子会话过多，请缩小清理范围');
        if(!r.nextCursor)break;cursor=r.nextCursor;
      }
    }
    return [...entries.values()];
  }
  async treeProblem(entries){
    for(const {thread} of entries){const state=await sessionActivity(this.home,thread);if(state!=='idle')return state==='inProgress'?threadTitle(thread)+'：会话或子会话正在运行':'无法确认会话及其子会话已结束：'+threadTitle(thread);}
    return null;
  }
  async inspectDelete(c,ids,source){
    const archived=await this.archivedMatches(c,ids,source),threads=[],affected=new Map(),trees=new Map(),files=new Map();
    for(const id of ids){
      const saved=archived.get(id);
      if(!saved){threads.push({id,title:null,canDelete:false,reason:'会话不在已归档列表中'});continue;}
      try{
        const read=await c.request('thread/read',{threadId:id,includeTurns:false}),root={...saved,...read.thread,id};
        if(source==='subagent'&&!isSubagent(root))throw new Error('所选会话不是子代理会话');
        const entries=await this.tree(c,root,{includeArchived:true,rootArchived:true});trees.set(id,entries.map(e=>e.thread.id));
        for(const entry of entries){const row=await this.describe(entry.thread,{archived:entry.archived,selected:ids.includes(entry.thread.id)});affected.set(row.id,row);const file=sessionFile(this.home,entry.thread);if(file)files.set(file.file,file.bytes);}
        const reason=await this.treeProblem(entries);threads.push({id,title:threadTitle(root),canDelete:!reason,reason});
      }catch(e){threads.push({id,title:threadTitle(saved),canDelete:false,reason:e.message});}
    }
    return {threads,affected:[...affected.values()],trees,logBytes:[...files.values()].reduce((a,b)=>a+b,0),unknownSizes:[...affected.values()].filter(t=>t.logBytes==null).length};
  }
  async previewDelete(ids,{source='interactive'}={}){
    const unique=this.validateIds(ids);sourceFilter(source);
    return this.use(async c=>{
      const {trees,...preview}=await this.inspectDelete(c,unique,source);let planId=null;
      for(const [id,p] of this.plans)if(p.expiresAt<Date.now())this.plans.delete(id);
      if(preview.threads.every(t=>t.canDelete)){
        planId=randomUUID();this.plans.set(planId,{ids:unique,source,affected:preview.affected.map(t=>t.id).sort(),expiresAt:Date.now()+300000});
        if(this.plans.size>20)this.plans.delete(this.plans.keys().next().value);
      }
      return {...preview,planId};
    });
  }
  async change(ids,action,{source='interactive',planId}={}){
    const unique=this.validateIds(ids);if(!['archive','restore','delete'].includes(action))throw new Error('不支持该清理方式');sourceFilter(source);
    if(this.mutating)throw new Error('另一批会话操作正在执行');this.mutating=true;
    try{return await this.use(async c=>{
      if(action==='delete'){
        const plan=this.plans.get(planId);this.plans.delete(planId);
        if(!plan||plan.expiresAt<Date.now()||plan.source!==source||JSON.stringify([...unique].sort())!==JSON.stringify([...plan.ids].sort()))throw new Error('删除预览已失效，请重新预览并确认');
        const checked=await this.inspectDelete(c,unique,source),blocked=checked.threads.find(t=>!t.canDelete);
        if(blocked)throw new Error(blocked.reason);
        if(JSON.stringify(checked.affected.map(t=>t.id).sort())!==JSON.stringify(plan.affected))throw new Error('会话及子会话范围发生变化，请重新预览并确认');
        const roots=unique.filter(id=>!unique.some(other=>other!==id&&checked.trees.get(other)?.includes(id))),results=[],affected=new Set();
        for(const id of roots){const tree=checked.trees.get(id)||[id],selected=unique.filter(target=>tree.includes(target));try{await c.request('thread/delete',{threadId:id});for(const target of tree)affected.add(target);for(const target of selected)results.push({id:target,ok:true});}catch(e){for(const target of selected)results.push({id:target,ok:false,error:e.message});}}
        return {results,completed:results.filter(r=>r.ok).length,affectedCount:affected.size};
      }
      const results=[],handled=new Set();
      for(const id of unique){
        if(handled.has(id)){results.push({id,ok:true});continue;}
        try{
          if(action==='archive'||source==='subagent'){
            const r=await c.request('thread/read',{threadId:id,includeTurns:false}),root={...r.thread,id};
            if(source==='subagent'&&!isSubagent(root))throw new Error('所选会话不是子代理会话');
            if(action==='archive'){const entries=await this.tree(c,root),problem=await this.treeProblem(entries);if(problem)throw new Error(problem);}
          }
          await c.request(action==='archive'?'thread/archive':'thread/unarchive',{threadId:id});handled.add(id);results.push({id,ok:true});
        }catch(e){results.push({id,ok:false,error:e.message});}
      }
      return {results,completed:results.filter(r=>r.ok).length};
    });}finally{this.mutating=false;}
  }
}
