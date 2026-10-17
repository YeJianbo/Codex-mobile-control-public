import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readProjectlessWorkspaceRoot} from './codexSettings.js';

async function realDirectory(directory:string):Promise<void> {
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Codex 默认工作区必须是真实目录');
}

export async function createCodexProjectlessWorkspace(prompt=''):Promise<string> {
  const root=await readProjectlessWorkspaceRoot();
  await fs.mkdir(root,{recursive:true});
  await realDirectory(root);
  const now=new Date();
  const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const day=path.join(root,date);
  await fs.mkdir(day,{recursive:true});
  await realDirectory(day);
  // Match Codex Desktop's date/prompt directories and collision suffixes.
  const slug=(prompt.toLowerCase().match(/[a-z0-9]+/g)?.slice(0,6).join('-')||'new-chat').slice(0,80);
  for(let attempt=0;attempt<110;attempt++){
    const name=attempt===0?slug:attempt<100?`${slug}-${attempt+1}`:`${slug}-${randomUUID()}`;
    const directory=path.join(day,name);
    try{await fs.mkdir(directory);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      await realDirectory(directory);
      continue;
    }
    // Desktop keeps the task directory usable if split-folder creation fails.
    await Promise.allSettled(['outputs','work'].map(name=>fs.mkdir(path.join(directory,name))));
    return directory;
  }
  throw new Error('无法创建 Codex 默认任务目录');
}
