import type {FastifyInstance} from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalConsoleClient} from './localConsole.js';
import {readPublicAccessSettings} from './publicAccessSettings.js';

const assets:Record<string,string>={
  'app.js':'text/javascript',
  'app.css':'text/css',
  'management.css':'text/css',
  'quota-warmup.js':'text/javascript',
  'request-records.js':'text/javascript',
  'request-records.css':'text/css',
  'management-overview.js':'text/javascript',
  'management-overview.css':'text/css',
  'channel-auth.js':'text/javascript',
  'relay-management.js':'text/javascript',
  'console-management-client.js':'text/javascript',
  'credit-history.js':'text/javascript',
  'console-management-ui.css':'text/css',
};
export const consoleManagementPublicPaths=new Set(['/manage','/manage/',...Object.keys(assets).map(file=>'/manage/'+file)]);

const reads=new Set(['state','access','access/channels','agy/usage','external/usage','analytics','usage/speed','usage/history','sessions','routing/progress','maintenance/report','maintenance/process-status','extensions','harnesses','harnesses/health','harnesses/updates','opencode','agy/accounts','agy/history','claude-accounts','model-accounts','model-accounts/oauth','personal-assistant/catalog','personal-assistant/projects','personal-assistant/tasks']);
const writes=new Set(['access/pair','access/remote','access/devices/revoke','access/channel','agy/accounts/import','agy/accounts/refresh','agy/accounts/select-preview','agy/accounts/select','claude-accounts/preview-switch','claude-accounts/switch','claude-accounts/select','claude-accounts/refresh','claude-accounts/import','claude-accounts/import-current','claude-accounts/import-cc-switch','model-accounts/save','model-accounts/test','model-accounts/models','model-accounts/oauth/start','model-accounts/oauth/cancel','analytics/refresh','analytics/pause','maintenance/diagnose','maintenance/repair-preview','maintenance/repair','maintenance/cleanup-preview','maintenance/cleanup','maintenance/process-preview','maintenance/process-apply','backend/restart-preview','backend/restart','maintenance/send','compatibility','usage/auto','sessions/delete-preview','sessions/change','opencode/provider-preview','opencode/model-preview','opencode/provider-apply','opencode/model-apply','harnesses/read','harnesses/save','harnesses/delete','harnesses/switch-preview','harnesses/switch','gateway/start','gateway/autostart','providers/import','providers/discover','providers/save','providers/delete','model/settings','model/toggle','model/order','model','routing/preview','takeover','routing/direct','routing/http','routing/profile','backup','restore','account/switch-preview','account/switch','catalog/rebuild','catalog/refresh','mcp','subagents','usage','test','personal-assistant/tasks']);
reads.add('usage/warmup');writes.add('usage/warmup');reads.add('usage/requests');
reads.add('quota-overview');reads.add('harnesses/catalog');writes.add('quota-overview/refresh');
export function consoleManagementAllowed(method:string,raw:string){
  const pathname=raw.split('?')[0]!;
  if(!/^[a-zA-Z0-9/_-]+$/.test(pathname)||pathname.includes('//'))return false;
  if(method==='GET')return reads.has(pathname)||/^personal-assistant\/tasks\/[a-zA-Z0-9_-]{8,100}$/.test(pathname);
  if(method==='POST')return writes.has(pathname)||/^personal-assistant\/tasks\/[a-zA-Z0-9_-]{8,100}\/(continue|stop|approve)$/.test(pathname);
  return false;
}
export function registerConsoleManagement(app:FastifyInstance,{client=new LocalConsoleClient(),webDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../dist')}={}){
  // Static UI contains no gateway or console credentials. APIs retain the normal paired-device authentication.
  for(const url of ['/manage','/manage/'])app.get(url,async(_request,reply)=>{
    let html=(await fs.readFile(path.join(webDirectory,'index.html'),'utf8'))
      .replace('__LOCAL_TOKEN__','')
      .replace('</head>','<meta name="local-api-base" content="/api/console-management/"><meta name="console-gateway" content="true"></head>');
    for(const file of Object.keys(assets))html=html.replaceAll(`="/${file}`,`="/manage/${file}`);
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").type('text/html; charset=utf-8').send(html);
  });
  for(const [file,type]of Object.entries(assets))app.get('/manage/'+file,async(_request,reply)=>reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').type(type).send(await fs.readFile(path.join(webDirectory,file))));
  app.route({method:['GET','POST'],url:'/api/console-management/*',handler:async(request,reply)=>{
    const tail=(request.params as {'*':string})['*'];
    if(!consoleManagementAllowed(request.method,tail))return reply.code(404).send({error:'未提供此管理操作'});
    if(request.headers.origin){
      let origin:URL;try{origin=new URL(request.headers.origin);}catch{return reply.code(403).send({error:'来源不允许'});}let publicHost='';
      if(request.headers['x-public-proxy-secret']){const settings=await readPublicAccessSettings();if(settings.publicUrl)publicHost=new URL(settings.publicUrl).host;}
      if(origin.host!==request.headers.host&&origin.host!==publicHost)return reply.code(403).send({error:'来源不允许'});
    }
    if(request.method==='POST'&&(!request.body||typeof request.body!=='object'||Array.isArray(request.body)))return reply.code(400).send({error:'请求参数无效'});
    const query=request.url.includes('?')?request.url.slice(request.url.indexOf('?')):'';
    if(query.length>16384)return reply.code(400).send({error:'查询参数过长'});
    reply.header('Cache-Control','no-store');
    try{return await client.managementRequest('/api/'+tail+query,request.method==='POST'?request.body as Record<string,unknown>:undefined,tail==='backend/restart'?135000:70000);}
    catch(error){const value=error as {status?:number;message?:string};return reply.code(value.status&&value.status>=400&&value.status<=599?value.status:502).send({error:value.message||'管理服务暂不可用'});}
  }});
}
