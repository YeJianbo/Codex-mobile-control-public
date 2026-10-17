import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import YAML from 'yaml';

type Proxy={name:string;type:string;now?:string;all?:string[];history?:{delay:number}[]};
type Controller={pipe?:string;url?:URL;secret:string};
async function controllerCandidates():Promise<Controller[]>{
 const files=process.env.CMC_CLASH_CONFIG?[process.env.CMC_CLASH_CONFIG]:[
  path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml'),
  path.join(os.homedir(),'.config/clash-verge/clash-verge.yaml'),
  path.join(os.homedir(),'.config/clash/config.yaml'),
 ];
 const result:Controller[]=[];
 for(const file of files){try{
  const config=YAML.parse(await fs.readFile(file,'utf8'));
  const secret=typeof config.secret==='string'?config.secret:'';
  const pipe=config['external-controller-pipe'];
  if(typeof pipe==='string'&&/^\\\\\.\\pipe\\[^\\]+$/i.test(pipe)){
   result.push({pipe,secret});
   // Verge writes the sidecar name to YAML while its service uses production.
   // Preserve the installation suffix and credentials when trying that alias.
   if(pipe.includes('\\verge-mihomo-sidecar-release-'))result.push({pipe:pipe.replace('\\verge-mihomo-sidecar-release-','\\verge-mihomo-production-'),secret});
  }
  const address=config['external-controller'];
  if(typeof address==='string'&&address){
   const url=new URL(address.includes('://')?address:'http://'+address);
   if(url.hostname==='0.0.0.0')url.hostname='127.0.0.1';
   if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)result.push({url,secret});
  }
 }catch{/* An absent or old profile is not the running controller. */}}
 return result;
}
function request<T>(controller:Controller,route:string,method='GET',body?:unknown,timeout=4000):Promise<T>{
 return new Promise((resolve,reject)=>{
  const content=body===undefined?undefined:JSON.stringify(body);
  const options={method,path:route,headers:{Authorization:'Bearer '+controller.secret,...(content?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(content)}:{})},
   ...(controller.pipe?{socketPath:controller.pipe}:{hostname:controller.url!.hostname,port:controller.url!.port||undefined})};
  const transport=controller.url?.protocol==='https:'?https:http;
  const call=transport.request(options,response=>{
   let data='';response.setEncoding('utf8');
   response.on('data',part=>{data+=part;if(data.length>4*1024*1024)call.destroy(Error('Clash 返回数据过大'));});
   response.on('error',reject);
   response.on('end',()=>{
    if(!response.statusCode||response.statusCode<200||response.statusCode>=300)return reject(Error('Clash 请求失败（HTTP '+response.statusCode+'）'));
    try{resolve((data?JSON.parse(data):{}) as T);}catch{reject(Error('Clash 返回格式异常'));}
   });
  });
  const deadline=setTimeout(()=>call.destroy(Error('Clash 读取超时，请确认电脑端正在运行')),timeout);
  call.on('close',()=>clearTimeout(deadline));call.on('error',reject);
  call.end(content);
 });
}
async function readController(){
 for(const controller of await controllerCandidates()){
  try{const data=await request<{proxies:Record<string,Proxy>}>(controller,'/proxies');if(data.proxies)return {controller,proxies:data.proxies};}catch{}
 }
 throw Error('未连接电脑端 Clash。请运行 Clash Verge，并启用外部控制器或命名管道。');
}
function openAIGroups(proxies:Record<string,Proxy>){return Object.values(proxies).filter(proxy=>/openai/i.test(proxy.name)&&Array.isArray(proxy.all));}
function snapshot(proxies:Record<string,Proxy>){
 const groups=openAIGroups(proxies);
 if(!groups.length)throw Error('Clash 中没有 OpenAI 分组，请先在电脑端添加该分组。');
 return {groups:groups.map(group=>({name:group.name,type:group.type,selected:group.now||'',nodes:group.all!.map(name=>({name,type:proxies[name]?.type||'',delay:proxies[name]?.history?.at(-1)?.delay??null}))}))};
}
export async function readClashOpenAI(){const {proxies}=await readController();return snapshot(proxies);}
export async function selectClashOpenAI(groupName:string,node:string){
 const {controller,proxies}=await readController();
 const group=openAIGroups(proxies).find(group=>group.name===groupName);
 if(!group?.all?.includes(node))throw Error('请选择 OpenAI 分组内的节点');
 await request(controller,'/proxies/'+encodeURIComponent(group.name),'PUT',{name:node});
 const current=await request<Proxy>(controller,'/proxies/'+encodeURIComponent(group.name));
 if(current.now!==node)throw Error('Clash 尚未确认节点切换，请刷新后检查');
 return readClashOpenAI();
}
export async function testClashOpenAI(groupName:string,node:string){
 const {controller,proxies}=await readController();
 const group=openAIGroups(proxies).find(group=>group.name===groupName);
 if(!group?.all?.includes(node))throw Error('请选择 OpenAI 分组内的节点');
 return request<{delay:number}>(controller,'/proxies/'+encodeURIComponent(node)+'/delay?url='+encodeURIComponent('https://www.gstatic.com/generate_204')+'&timeout=5000','GET',undefined,6500);
}
