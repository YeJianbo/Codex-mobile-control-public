import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {codexHome} from './paths.js';
import {threadAgent,publicAgentAllowed,type Agent} from './agentProtocol.js';
import {assertControllableThread} from './cloudSnapshots.js';

const agents=z.enum(['codex','claude','antigravity','grok','deepseek','hermes','opencode','zcode','pi']);
const locks=new Map<string,Promise<unknown>>();
const version=(content:string)=>createHash('sha256').update(content).digest('hex');
const home=()=>os.homedir();
export function globalInstructionFile(agent:Agent){
  switch(agent){
    case 'codex':return path.join(codexHome(),'AGENTS.md');
    case 'claude':return path.join(process.env.CLAUDE_CONFIG_DIR||path.join(home(),'.claude'),'CLAUDE.md');
    case 'antigravity':return path.join(home(),'.gemini','GEMINI.md');
    case 'grok':return path.join(home(),'.grok','AGENTS.md');
    case 'deepseek':return path.join(process.env.DSH_HOME||path.join(home(),'.dsh'),'AGENTS.md');
    case 'hermes':return path.join(process.env.HERMES_HOME||path.join(home(),'.hermes'),'SOUL.md');
    case 'opencode':return path.join(process.env.XDG_CONFIG_HOME||path.join(home(),'.config'),'opencode','AGENTS.md');
    case 'zcode':return path.join(home(),'.zcode','AGENTS.md');
    case 'pi':return path.join(process.env.PI_CODING_AGENT_DIR||path.join(home(),'.pi','agent'),'AGENTS.md');
    case 'acp':throw Error('自定义 ACP 的全局指令由对应助手管理');
  }
}
async function readFile(file:string){try{return await fs.readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}}
export function stripSessionInstructionPrefix(text:string){return text.replace(/^<cmc-session-instructions>\s*[\s\S]*?<\/cmc-session-instructions>\s*/i,'');}
async function save(file:string,content:string,expected:string){
  const previous=locks.get(file)||Promise.resolve();
  const current=previous.catch(()=>{}).then(async()=>{
    if(version(await readFile(file))!==expected)throw Error('文件已在其他地方修改，请重新载入后再保存');
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temp,content,{encoding:'utf8',mode:0o600});await fs.rename(temp,file);}
    finally{await fs.unlink(temp).catch(()=>{});}
    return {revision:version(content)};
  });
  locks.set(file,current);try{return await current;}finally{if(locks.get(file)===current)locks.delete(file);}
}
export function registerAgentInstructions(app:FastifyInstance,authorizeThread:(request:FastifyRequest,id:string)=>Promise<string>,publicSecret:string|undefined){
  const resolve=async(request:FastifyRequest)=>{
    const query=z.object({scope:z.enum(['global','project','session']),agent:agents,threadId:z.string().max(140).optional()}).strict().parse(request.query);
    const viaPublic=publicSecret!=null&&request.headers['x-public-proxy-secret']===publicSecret;
    if(viaPublic&&!publicAgentAllowed(query.agent))throw Error('此助手的公网访问已关闭');
    if(query.scope==='global')return {file:globalInstructionFile(query.agent),scope:query.scope};
    const id=query.threadId||'';assertControllableThread(id);
    if(threadAgent(id)!==query.agent)throw Error('会话与助手不匹配');
    const project=await authorizeThread(request,id);
    return {file:path.join(project,query.agent==='claude'?'CLAUDE.md':'AGENTS.md'),scope:'project' as const};
  };
  app.get('/api/agent-instructions',async request=>{
    const {file,scope}=await resolve(request),content=await readFile(file);
    return {scope,file,content,revision:version(content)};
  });
  app.put('/api/agent-instructions',async request=>{
    const {file,scope}=await resolve(request);
    const body=z.object({content:z.string().max(200000),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(request.body);
    return save(file,body.content,body.revision);
  });
}
