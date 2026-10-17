import {randomBytes} from 'node:crypto';
import {createServer,type ServerResponse} from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parse,type ParseError} from 'jsonc-parser';

const plugin=pathToFileURL(fileURLToPath(new URL('../../scripts/opencode-mobile-policy.mjs',import.meta.url))).href;

function inlineConfig(source:string):Record<string,any>{
  // Parse only this child environment; strings and native substitutions survive.
  const errors:ParseError[]=[];
  const value:any=parse(source.replace(/^\uFEFF/,''),errors,{allowTrailingComma:true});
  if(errors.length)throw Error('OpenCode 内联配置无法解析，未发送任务');
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('OpenCode 内联配置必须是对象');
  if(value.plugin!==undefined&&!Array.isArray(value.plugin))throw Error('OpenCode 内联插件配置必须是数组');
  return value;
}

function permissionParams(value:any){
  if(!value||typeof value.sessionID!=='string'||typeof value.callID!=='string'||typeof value.tool!=='string'||!value.sessionID||!value.callID||!value.tool)return;
  const args=value.args&&typeof value.args==='object'&&!Array.isArray(value.args)?value.args:{};
  const tool=value.tool,edit=['edit','write','apply_patch'].includes(tool);
  const files:string[]=[];
  if(tool==='edit'||tool==='write'){
    if(typeof args.filePath==='string'&&args.filePath)files.push(args.filePath);
  }else if(tool==='apply_patch'&&typeof args.patchText==='string'){
    for(const match of args.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm))files.push(match[1].trim());
  }
  return {sessionId:value.sessionID,toolCall:{toolCallId:value.callID,title:tool,kind:edit?'edit':tool==='bash'?'execute':'other',rawInput:args,
    ...(files.length?{locations:[...new Set(files)].map(file=>({path:file}))}:{})}};
}

export interface OpencodePolicy {
  env:Record<string,string>;
  readonly ready:boolean;
  close:()=>Promise<void>;
}

export async function createOpencodePolicy(approve:(params:any)=>Promise<boolean>):Promise<OpencodePolicy>{
  const config=inlineConfig(process.env.OPENCODE_CONFIG_CONTENT||'{}'),token=randomBytes(32).toString('hex');
  const responses=new Set<ServerResponse>();
  let ready=false,closed=false,closing:Promise<void>|undefined;
  const reply=(response:ServerResponse,status:number,allowed=false)=>{
    if(response.destroyed||response.writableEnded)return;
    response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({allowed}));
  };
  const server=createServer({requestTimeout:0,headersTimeout:10000},(request,response)=>{
    if(closed||request.method!=='POST'||request.headers.authorization!==`Bearer ${token}`||!['/ready','/approve'].includes(request.url||'')){
      reply(response,403);request.resume();return;
    }
    if(request.url==='/ready'){ready=true;reply(response,200,true);request.resume();return;}
    responses.add(response);response.once('close',()=>responses.delete(response));
    let size=0;const chunks:Buffer[]=[];
    request.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024){reply(response,413);request.destroy();}else chunks.push(chunk);});
    request.on('error',()=>reply(response,400));
    request.on('end',()=>{
      if(response.writableEnded||response.destroyed)return;
      let params:any;try{params=permissionParams(JSON.parse(Buffer.concat(chunks).toString()));}catch{reply(response,400);return;}
      if(!params){reply(response,400);return;}
      void approve(params).then(allowed=>reply(response,200,!closed&&allowed===true),()=>reply(response,200));
    });
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address();
  if(!address||typeof address==='string'){server.close();throw Error('OpenCode 本机权限通道未启动');}
  const endpoint=`http://127.0.0.1:${address.port}`;
  return {
    env:{OPENCODE_CONFIG_CONTENT:JSON.stringify({...config,plugin:[...(config.plugin||[]),[plugin,{endpoint,token}]]})},
    get ready(){return ready&&!closed;},
    close(){
      if(closing)return closing;
      closed=true;for(const response of responses)reply(response,200);responses.clear();
      closing=new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
      return closing;
    },
  };
}
