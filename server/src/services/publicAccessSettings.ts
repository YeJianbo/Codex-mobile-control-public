import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {appHome} from './paths.js';

type PublicAccessConfig={port:number;publicUrl?:string;passwordSha256:string;proxySecret:string};
const updates=new Map<string,Promise<unknown>>();

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
  return updatePublicAccessSettings({password},home);
}

export async function updatePublicAccessSettings(input:{password?:string;publicUrl?:string},home=appHome()){
  const key=path.resolve(home);
  const operation=(updates.get(key)??Promise.resolve()).catch(()=>{}).then(()=>applyPublicAccessSettings(input,home));
  updates.set(key,operation);
  try{return await operation;}finally{if(updates.get(key)===operation)updates.delete(key);}
}

async function applyPublicAccessSettings(input:{password?:string;publicUrl?:string},home:string){
  if(input.password!==undefined&&(input.password.length<6||input.password.length>128||input.password.trim()!==input.password||/[\r\n]/.test(input.password)))throw new Error('密码需要 6 至 128 个字符，首尾不能有空格');
  let publicUrl=input.publicUrl;
  if(publicUrl){
    const url=new URL(publicUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('公网地址需要 HTTPS 域名，不带路径');
    publicUrl=url.origin;
  }
  if(input.password===undefined&&publicUrl===undefined)throw new Error('请填写要更新的连接设置');
  const configPath=path.join(home,'public-access.json');
  const passwordPath=path.join(home,'public-password.txt');
  const config=JSON.parse(await fs.readFile(configPath,'utf8')) as PublicAccessConfig;
  if(!Number.isInteger(config.port)||typeof config.proxySecret!=='string'||config.proxySecret.length<40)
    throw new Error('公网入口尚未正确配置');
  const current=input.password!==undefined?await fs.readFile(passwordPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}):null;
  const newConfig={...config,...(input.password!==undefined?{passwordSha256:createHash('sha256').update(input.password).digest('hex')}:{}),...(publicUrl!==undefined?{publicUrl}:{})};
  const nextPassword=`${passwordPath}.${randomUUID()}.tmp`;
  const nextConfig=`${configPath}.${randomUUID()}.tmp`;
  try{
    if(input.password!==undefined)await fs.writeFile(nextPassword,input.password+'\n',{flag:'wx',mode:0o600});
    await fs.writeFile(nextConfig,JSON.stringify(newConfig,null,2),{flag:'wx',mode:0o600});
    if(input.password!==undefined)await fs.rename(nextPassword,passwordPath);
    try{await fs.rename(nextConfig,configPath)}
    catch(error){if(input.password!==undefined){if(current===null)await fs.rm(passwordPath,{force:true});else await fs.writeFile(passwordPath,current,{mode:0o600});}throw error;}
  }finally{
    await Promise.all([fs.rm(nextPassword,{force:true}),fs.rm(nextConfig,{force:true})]);
  }
  return {configured:/^[a-f0-9]{64}$/i.test(newConfig.passwordSha256),publicUrl:newConfig.publicUrl||''};
}
