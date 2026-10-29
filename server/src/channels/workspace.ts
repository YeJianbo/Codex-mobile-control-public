import fs from 'node:fs/promises';
import path from 'node:path';

/** Stable per first-message ID: retries reuse a space without adding sidebar projects. */
export class ChannelWorkspaces{
  constructor(readonly root:string){}
  owns(directory:string){return path.dirname(path.resolve(directory))===path.resolve(this.root)&&/^[a-f0-9-]{36}$/i.test(path.basename(directory));}
  async validate(directory:string){
    if(!this.owns(directory))throw Error('助理工作目录无效');
    for(const item of [this.root,directory]){
      const stat=await fs.lstat(item);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('助理工作目录必须是真实目录');
    }
    return path.resolve(directory);
  }
  async prepare(requestId:string){
    if(!/^[a-f0-9-]{36}$/i.test(requestId))throw Error('助理请求 ID 无效');
    const directory=path.join(this.root,requestId);
    await fs.mkdir(directory,{recursive:true});
    return this.validate(directory);
  }
}
