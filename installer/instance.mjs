import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),manifest=JSON.parse(await fs.readFile(path.join(root,'installation.json'),'utf8'));
process.env.CODEX_HOME=manifest.codexHome;process.env.CODEX_MOBILE_CONTROL_HOME=manifest.dataDirectory;
const home=manifest.dataDirectory,configPath=path.join(home,'server.json'),publicFile=path.join(home,'public-access.json');
async function publicSettings(){try{return JSON.parse(await fs.readFile(publicFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function request(route,method='GET'){const config=JSON.parse(await fs.readFile(configPath,'utf8'));return new Promise((resolve,reject)=>{
 const req=(config.https.enabled?https:http).request({hostname:'127.0.0.1',port:config.port,path:route,method,headers:{Authorization:'Bearer '+config.token},timeout:10000},res=>{let body='';res.on('data',c=>{body+=c;if(body.length>2*1024*1024)req.destroy(Error('响应过大'));});res.on('end',()=>{try{if(res.statusCode!==200)throw Error('HTTP '+res.statusCode);resolve(JSON.parse(body));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('请求超时')));req.end();});}
// Set the per-instance CA without disabling TLS verification globally.
async function prepareTls(){const c=JSON.parse(await fs.readFile(configPath,'utf8'));if(c.https.enabled)https.globalAgent=new https.Agent({ca:await fs.readFile(c.https.certPath)});}
const command=process.argv[2];
try{
if(command==='initialize'){
 await fs.mkdir(home,{recursive:true});await fs.mkdir(manifest.codexHome,{recursive:true});
 try{const c=JSON.parse(await fs.readFile(configPath,'utf8'));if(typeof c.token!=='string'||c.token.length<20||!Number.isInteger(c.port))throw Error('已有网关配置无效，未覆盖');}
 catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(configPath,JSON.stringify({host:'0.0.0.0',port:manifest.gatewayPort,token:crypto.randomBytes(32).toString('base64url'),projectRoots:[],https:{enabled:false}},null,2),{flag:'wx'});}
 const {loadServerConfig}=await import(pathToFileURL(path.join(root,'gateway/dist/services/configStore.js')));const {updateHttpsConfig}=await import(pathToFileURL(path.join(root,'gateway/dist/services/httpsConfig.js')));const config=await loadServerConfig();
 if(!config.https.enabled)await updateHttpsConfig(config,{enabled:true,generateSelfSigned:true});
 else {await fs.access(config.https.certPath);await fs.access(config.https.keyPath);}
 if(!await publicSettings()){const password=crypto.randomBytes(24).toString('base64url');await fs.writeFile(publicFile,JSON.stringify({port:48763,publicUrl:'',passwordSha256:crypto.createHash('sha256').update(password).digest('hex'),proxySecret:crypto.randomBytes(40).toString('base64url'),tunnelRelay:{enabled:false}},null,2),{flag:'wx'});await fs.writeFile(path.join(home,'public-password.txt'),password+'\n',{flag:'wx'});}
 console.log(JSON.stringify({initialized:true,https:true}));
}else if(command==='password'){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw Error('输入过长');}
 const {password,publicUrl}=JSON.parse(input);if(typeof password!=='string'||password.length<8||password.length>128||/[\r\n]/.test(password))throw Error('密码需要 8–128 个字符');
 let url='';if(publicUrl){const parsed=new URL(publicUrl);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('公网地址需要使用 HTTPS 域名，不带路径');url=parsed.origin;}
 const c=await publicSettings();if(!c)throw Error('请先完成安装');
 const {updatePublicAccessPassword}=await import(pathToFileURL(path.join(root,'gateway/dist/services/publicAccessSettings.js')));await updatePublicAccessPassword(password,home);
 const temp=publicFile+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({...c,passwordSha256:crypto.createHash('sha256').update(password).digest('hex'),publicUrl:url},null,2),{flag:'wx'});await fs.rename(temp,publicFile);console.log(JSON.stringify({saved:true}));
}else{
 await prepareTls();
 if(command==='health'){const health=await request('/health');console.log(JSON.stringify({ok:health.ok,version:health.version}));}
 else if(command==='update-check'){const value=await request('/api/codex/status');const threads=await request('/api/threads');const blocking=threads.threads.filter(t=>t.status==='running'&&(value.codex.transport!=='desktop'||/^(claude|antigravity|grok|deepseek|hermes)-/.test(t.id)));if(blocking.length||value.codex.pendingRequests>0)throw Error('网关有活动任务或未完成请求，请结束后再安装');console.log(JSON.stringify({safe:true}));}
 else if(command==='browser'){const config=JSON.parse(await fs.readFile(configPath,'utf8'));const pairing=await request('/api/pair/start');const setup=await request('/api/channels/bootstrap','POST');const certificate=new crypto.X509Certificate(await fs.readFile(config.https.certPath));const spki=crypto.createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');console.log(JSON.stringify({url:`https://127.0.0.1:${config.port}/console#desktopPair=${pairing.code}&channelSetup=${setup.code}`,spki,profile:path.join(home,'browser-profile')}));}
 else if(command==='dashboard'){
  const params=new URLSearchParams();if(process.argv[3])params.set('baseUrl',process.argv[3]);const pairing=await request('/api/pair/start?'+params);const {default:QRCode}=await import(pathToFileURL(path.join(root,'gateway/node_modules/qrcode/lib/index.js')));const png=await QRCode.toBuffer(pairing.setupUrl,{width:320,margin:4});let desktop=false;try{desktop=(await request('/api/codex/status')).codex.initialized;}catch{}
  const settings=await publicSettings();console.log(JSON.stringify({version:manifest.gatewayVersion,desktop,addresses:pairing.addresses,baseUrl:pairing.baseUrl,code:pairing.code,expiresAt:pairing.expiresAt,qr:png.toString('base64'),publicUrl:settings?.publicUrl||'',hasPassword:Boolean(settings?.passwordSha256)}));
 }else throw Error('未知管理命令');
}
}catch(error){if(command!=='health')console.error(error.message);process.exitCode=1;}
