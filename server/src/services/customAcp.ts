import {readFileSync,statSync} from 'node:fs';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {appHome} from './paths.js';

const entrySchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  name:z.string().trim().min(1).max(80),
  command:z.string().trim().min(1).max(1024).refine(value=>path.isAbsolute(value)&&!/[\r\n\0]/.test(value),'请填写可执行文件的绝对路径'),
  args:z.array(z.string().max(2048).refine(value=>!/[\r\n\0]/.test(value))).max(32).default([]),
}).strict();
export type CustomAcp= z.infer<typeof entrySchema>;
const file=()=>path.join(appHome(),'custom-acp.json');
export function customAcpStamp(){try{return String(statSync(file()).mtimeMs);}catch{return 'missing';}}
export function readCustomAcp():CustomAcp[]{
  try{return z.array(entrySchema).max(30).parse(JSON.parse(readFileSync(file(),'utf8')));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw Error('自定义 ACP 配置无法读取');}
}
export async function saveCustomAcp(input:unknown){
  const entries=z.array(entrySchema).max(30).parse(input);
  if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error('ACP 标识不能重复');
  await fs.mkdir(path.dirname(file()),{recursive:true});
  const temp=file()+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temp,JSON.stringify(entries,null,2)+'\n',{mode:0o600});await fs.rename(temp,file());}
  finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  return entries;
}
export function customAcpModel(id:string,model:string){return `acp::${id}::${model}`;}
export function parseCustomAcpModel(model:string){
  const match=/^acp::([a-z][a-z0-9_]{0,31})::(.+)$/.exec(model);
  if(!match)throw Error('请选择自定义 ACP 模型');
  const config=readCustomAcp().find(entry=>entry.id===match[1]);
  if(!config)throw Error('此 ACP 配置已移除，请恢复配置后继续会话');
  return {config,model:match[2]};
}
