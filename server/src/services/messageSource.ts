import type {GatewayEvent} from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {codexHome,appHome} from './paths.js';

const decode=(s:string)=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function scheduledMessage(input:unknown){
  if(typeof input!=='string')return;
  const wrapper=/^\s*<heartbeat(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/heartbeat>\s*$/.exec(input);if(!wrapper)return;
  const id=/<automation_id>\s*([a-zA-Z0-9][a-zA-Z0-9_-]{0,159})\s*<\/automation_id>/.exec(wrapper[1])?.[1];
  const instructions=/<instructions>\s*([\s\S]*?)\s*<\/instructions>/.exec(wrapper[1])?.[1];
  if(!id||instructions===undefined)return;
  return {text:decode(instructions),messageSource:{kind:'schedule' as const,automationId:id,name:'定时任务'}};
}
export function delegatedMessage(input:unknown):{text:string;messageSource:NonNullable<GatewayEvent['messageSource']>}|undefined{
  if(typeof input!=='string')return;
  const match=/^\s*<codex_delegation>\s*<source_thread_id>([a-zA-Z0-9-]{1,160})<\/source_thread_id>\s*<input>([\s\S]*?)<\/input>\s*<\/codex_delegation>\s*$/.exec(input);
  if(!match)return;
  return {text:decode(match[2]),messageSource:{kind:'thread',threadId:match[1],name:'其他任务'}};
}

async function cloudProfiles(){
  try{
    const [state,auth]=await Promise.all([fs.readFile(path.join(codexHome(),'.codex-global-state.json'),'utf8').then(JSON.parse),fs.readFile(path.join(codexHome(),'auth.json'),'utf8').then(JSON.parse)]);
    const cache=state['electron-persisted-atom-state']?.['cloud-aeon-sidebar-cache-v1'];
    if(!cache||cache.accountId!==auth.tokens?.account_id)return {};
    return cache.profilesByThreadId??{};
  }catch{return {};}
}
export async function enrichMessageSources<T extends {type:string}>(events:T[],titles:Map<string,string>=new Map()){
  events=events.map(event=>event.type==='user.message'?{...event,...scheduledMessage((event as GatewayEvent & {text?:string}).text)}:event);
  if(!events.some(e=>(e as GatewayEvent).messageSource?.threadId))return events;
  const profiles=await cloudProfiles();
  return events.map(event=>{
    const source=(event as GatewayEvent).messageSource;if(!source?.threadId)return event;
    const profile=profiles[source.threadId];
    return {...event,messageSource:{...source,name:profile?.display_name||titles.get(source.threadId)||source.name,avatar:profile?.avatar_url?`/api/cloud/avatar/${encodeURIComponent(source.threadId)}`:undefined}};
  });
}
const avatars=new Map<string,{type:string;body:Buffer}>();
export async function cloudSourceAvatar(threadId:string){
  const profile=(await cloudProfiles())[threadId];
  if(!profile?.avatar_url)throw Error('头像暂不可用');
  const key=profile.id+':'+(profile.avatar_manifest?.snapshot?.content_sha256||profile.avatar_url);
  const saved=avatars.get(key);if(saved)return saved;
  // Signed image URLs expire. Keep the successfully fetched image by the
  // desktop manifest's content identity so restarts do not lose the avatar.
  const digest=profile.avatar_manifest?.snapshot?.content_sha256;
  const file=typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest)?path.join(appHome(),'cloud-avatars',digest+'.json'):undefined;
  if(file)try{
    const cached=JSON.parse(await fs.readFile(file,'utf8'));const body=Buffer.from(cached.body,'base64');
    if(body.length<=2_000_000&&/^image\/(png|jpeg|webp)$/.test(cached.type)&&createHash('sha256').update(body).digest('hex')===digest){const image={type:cached.type as string,body};avatars.set(key,image);return image;}
  }catch{}
  const url=new URL(profile.avatar_url);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.oaiusercontent.com'))throw Error('头像地址无效');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  const type=response.headers.get('content-type')||'';
  if(!response.ok||!/^image\/(png|jpeg|webp)$/.test(type)||Number(response.headers.get('content-length'))>2_000_000)throw Error('头像暂不可用');
  const reader=response.body!.getReader();const parts:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw Error('头像过大');parts.push(value);}}finally{await reader.cancel();}
  const image={type,body:Buffer.concat(parts)};
  if(file&&createHash('sha256').update(image.body).digest('hex')===digest){
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,JSON.stringify({type,body:image.body.toString('base64')}),{mode:0o600});
  }
  avatars.set(key,image);if(avatars.size>20)avatars.delete(avatars.keys().next().value!);
  return image;
}
