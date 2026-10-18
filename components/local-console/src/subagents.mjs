import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parse} from 'smol-toml';

const efforts=['low','medium','high','xhigh','max','ultra'];
const roleName=/^[a-z][a-z0-9_-]{0,63}$/;

function setField(text,key,value){
  const line=`${key} = ${JSON.stringify(value)}`;
  const re=new RegExp(`^${key}\\s*=.*$`,'m');
  return re.test(text)?text.replace(re,line):line+'\n'+text;
}
function setAgentsField(text,key,value){
  const section=/^\[agents\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m;
  if(!section.test(text))return text+'\n[agents]\n'+key+' = '+JSON.stringify(value)+'\n';
  return text.replace(section,(whole,body)=>{
    const re=new RegExp(`^${key}\\s*=.*$`,'m');
    return whole.replace(body,re.test(body)?body.replace(re,`${key} = ${JSON.stringify(value)}`):`${key} = ${JSON.stringify(value)}\n`+body);
  });
}
function writeWithBackup(store,file,text,kind){
  const previous=fs.readFileSync(file,'utf8');
  if(previous===text)return null;
  parse(text);
  const id=`${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const dir=path.join(store.dir,'backups');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,kind,at:new Date().toISOString(),file,content:previous}));
  const temp=file+'.local.tmp';fs.writeFileSync(temp,text,{mode:0o600});fs.renameSync(temp,file);
  return id;
}
export function listSubagents(store){
  const config=parse(fs.readFileSync(store.config,'utf8'));
  const dir=path.join(store.home,'agents');
  const roles=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.toml')&&roleName.test(n.slice(0,-5))).map(n=>{
    const id=n.slice(0,-5),c=parse(fs.readFileSync(path.join(dir,n),'utf8'));
    return {id,name:c.name||id,description:c.description||'',model:c.model||'',effort:c.model_reasoning_effort||'medium',provider:c.model_provider||'openai'};
  }):[];
  const models=store.models().filter(m=>!m.slug.includes('::')&&/^gpt-6(?:[.-]|$)/.test(m.slug)).map(m=>m.slug);
  return {default:{model:config.agents?.default_subagent_model||'',effort:config.agents?.default_subagent_reasoning_effort||'medium',maxThreads:config.agents?.max_threads||6,maxDepth:config.agents?.max_depth||1},roles,models,efforts};
}
export function updateSubagent(store,input){
  const current=listSubagents(store),id=String(input.id||'');
  const model=String(input.model||''),effort=String(input.effort||'');
  if(!current.models.includes(model))throw new Error('请选择当前官方目录中的 GPT-6 模型');
  if(!efforts.includes(effort))throw new Error('思考强度无效');
  if(model==='gpt-6-luna'&&effort==='ultra')throw new Error('GPT-6 Luna 最高支持 max 思考强度');
  if(id==='default'){
    const maxThreads=Number(input.maxThreads),maxDepth=Number(input.maxDepth);
    if(!Number.isInteger(maxThreads)||maxThreads<1||maxThreads>32||!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>5)throw new Error('并行数或深度超出范围');
    let text=fs.readFileSync(store.config,'utf8');
    for(const [key,val] of Object.entries({default_subagent_model:model,default_subagent_reasoning_effort:effort,max_threads:maxThreads,max_depth:maxDepth}))text=setAgentsField(text,key,val);
    const backup=writeWithBackup(store,store.config,text,'config');return {backup};
  }
  if(!roleName.test(id)||!current.roles.some(r=>r.id===id))throw new Error('子代理不存在');
  const file=path.join(store.home,'agents',id+'.toml');
  let text=fs.readFileSync(file,'utf8');text=setField(setField(text,'model',model),'model_reasoning_effort',effort);
  const backup=writeWithBackup(store,file,text,'subagent');return {backup};
}
