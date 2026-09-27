import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const imageExtension=/\.(png|jpe?g|webp|gif)$/i;
const clipboardName=/^codex-clipboard-[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i;
const normalized=(value:string)=>process.platform==='win32'?value.toLowerCase():value;

export async function resolveHistoryImage(file:string,projectPaths:string[]):Promise<{absolutePath:string;size:number}|null> {
  if(!path.isAbsolute(file)||!imageExtension.test(file))return null;
  const absolutePath=await fs.realpath(file).catch(()=>null);
  if(!absolutePath)return null;
  const temp=await fs.realpath(os.tmpdir()).catch(()=>os.tmpdir());
  const clipboard=normalized(path.dirname(absolutePath))===normalized(temp)&&clipboardName.test(path.basename(absolutePath));
  let project=false;
  if(!clipboard)for(const root of projectPaths){
    const realRoot=await fs.realpath(root).catch(()=>null);
    if(realRoot&&normalized(absolutePath).startsWith(normalized(realRoot)+path.sep)){project=true;break;}
  }
  if(!clipboard&&!project)return null;
  const stat=await fs.stat(absolutePath).catch(()=>null);
  return stat?.isFile()&&stat.size<=20*1024*1024?{absolutePath,size:stat.size}:null;
}
