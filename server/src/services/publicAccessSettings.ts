import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {appHome} from './paths.js';

type PublicAccessConfig={port:number;publicUrl?:string;passwordSha256:string;proxySecret:string};

export async function readPublicAccessSettings(home=appHome()){
  try{
    const config=JSON.parse(await fs.readFile(path.join(home,'public-access.json'),'utf8')) as PublicAccessConfig;
    return {configured:/^[a-f0-9]{64}$/i.test(config.passwordSha256),publicUrl:config.publicUrl||''};
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return {configured:false,publicUrl:''};
    throw error;
  }
}

export async function updatePublicAccessPassword(password:string,home=appHome()){
  const configPath=path.join(home,'public-access.json');
  const passwordPath=path.join(home,'public-password.txt');
  const config=JSON.parse(await fs.readFile(configPath,'utf8')) as PublicAccessConfig;
  if(!Number.isInteger(config.port)||typeof config.proxySecret!=='string'||config.proxySecret.length<40)
    throw new Error('公网入口尚未正确配置');
  const current=await fs.readFile(passwordPath,'utf8');
  const newConfig={...config,passwordSha256:createHash('sha256').update(password).digest('hex')};
  const nextPassword=`${passwordPath}.${randomUUID()}.tmp`;
  const nextConfig=`${configPath}.${randomUUID()}.tmp`;
  try{
    await fs.writeFile(nextPassword,password+'\n',{flag:'wx',mode:0o600});
    await fs.writeFile(nextConfig,JSON.stringify(newConfig,null,2),{flag:'wx',mode:0o600});
    await fs.rename(nextPassword,passwordPath);
    try{await fs.rename(nextConfig,configPath)}
    catch(error){await fs.writeFile(passwordPath,current,{mode:0o600});throw error;}
  }finally{
    await Promise.all([fs.rm(nextPassword,{force:true}),fs.rm(nextConfig,{force:true})]);
  }
  return {configured:true,publicUrl:newConfig.publicUrl||''};
}
