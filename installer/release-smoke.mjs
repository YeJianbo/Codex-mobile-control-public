import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{setup:{type:'string'},'work-root':{type:'string'},report:{type:'string'}}});
assert(values.setup,'Pass --setup with the actual Windows Setup EXE');
const root=path.resolve(import.meta.dirname,'..');
const setup=path.resolve(values.setup);
const work=path.resolve(values['work-root']||path.join(os.tmpdir(),'cmc-release-smoke'));
await fs.mkdir(work,{recursive:true});
const qa=await fs.mkdtemp(path.join(work,'isolated-'));
const installed=path.join(qa,'程序 with spaces'),codex=path.join(qa,'codex'),data=path.join(qa,'mobile-data');
const reportFile=path.resolve(values.report||path.join(work,'installation-verification.json'));
const report={setup:path.basename(setup),checks:[],productionChanged:false,modelCallsExecuted:false,physicalOtherMachine:false};
const children=[];
const endpoint=path.join(os.homedir(),'.codex-mobile-control','desktop-bridge','endpoint.json');
const previousEndpoint=await fs.readFile(endpoint,'utf8').catch(()=>null);
const env={...process.env,USERPROFILE:path.join(qa,'user'),HOME:path.join(qa,'user'),APPDATA:path.join(qa,'app-data'),LOCALAPPDATA:path.join(qa,'local-app-data'),CODEX_HOME:codex,CODEX_MOBILE_CONTROL_HOME:data,LOCAL_CONSOLE_DISABLE_ANALYTICS:'1'};
delete env.CODEX_CLI_PATH;
for(const directory of [codex,env.USERPROFILE,env.APPDATA,env.LOCALAPPDATA])await fs.mkdir(directory,{recursive:true});
const check=name=>{report.checks.push(name);console.log('ok - '+name);};
function run(exe,args,input){return new Promise((resolve,reject)=>{
 const child=spawn(exe,args,{env,windowsHide:true});let stdout='',stderr='';
 child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);
 child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(`exit ${code}: ${stderr+stdout}`)));
 child.stdin.end(input);
});}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(exe,args,name){
 const log=await fs.open(path.join(qa,name+'.log'),'w');
 const child=spawn(exe,args,{env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 children.push(child);await log.close();return child;
}
async function ready(url){
 for(let attempt=0;attempt<40;attempt++){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});if(response.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error('Service did not become ready: '+new URL(url).port);
}
let request;
try{
 const gatewayPort=await freePort(),consolePort=await freePort();
 assert.notEqual(consolePort,25819);assert.notEqual(gatewayPort,38457);
 const mock=path.join(qa,'codex-mock.mjs');
 const source=await fs.readFile(path.join(root,'server/scripts/smoke-test.mjs'),'utf8');
 const startAt=source.indexOf('function mockCodexScript() {');assert(startAt>=0);
 await fs.writeFile(mock,new Function(source.slice(startAt)+';return mockCodexScript();')());
 env.CODEX_MOBILE_CONTROL_CODEX_BIN=process.execPath;
 env.CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX=JSON.stringify([mock]);
 await fs.writeFile(path.join(codex,'config.toml'),'model = "release-smoke-model"\n');
 await run(setup,['/silent','-InstallDirectory',installed,'-CodexHome',codex,'-DataDirectory',data,'-GatewayPort',String(gatewayPort),'-ConsolePort',String(consolePort),'-NoAutostart','-NoStart','-SkipDesktopBridge','-NoShortcuts']);
 check('Actual Setup installs offline into an isolated Unicode/space directory');
 const metadata=JSON.parse(await fs.readFile(path.join(installed,'installation.json'),'utf8'));
 const release=JSON.parse(await fs.readFile(path.join(installed,'release.json'),'utf8'));
 assert.equal(metadata.gatewayVersion,release.gatewayVersion);assert.equal(metadata.consolePort,consolePort);assert.equal(metadata.dataDirectory,data);
 report.version=release.version;report.gatewayVersion=release.gatewayVersion;
 const config=JSON.parse(await fs.readFile(path.join(data,'server.json'),'utf8'));
 assert.equal(config.port,gatewayPort);assert(config.https.enabled);assert(config.https.certPath.startsWith(data));
 check('Fresh installation creates its own HTTPS identity and configured ports');
 config.host='127.0.0.1';await fs.writeFile(path.join(data,'server.json'),JSON.stringify(config,null,2));
 env.LOCAL_CONSOLE_PORT=String(consolePort);
 const runtime=path.join(installed,'runtime/node.exe');
 const serverModule=path.join(qa,'console-entry.mjs');
 const moduleUrl=new URL('file:///'+path.join(installed,'src/server.mjs').replaceAll('\\','/')).href;
 await fs.writeFile(serverModule,`import {createServer} from ${JSON.stringify(moduleUrl)};\nconst updater={start(){},stop(){},status(){return {};}};\nconst {server}=createServer({home:process.env.CODEX_HOME,port:Number(process.env.LOCAL_CONSOLE_PORT),officialUpdater:updater});server.listen(Number(process.env.LOCAL_CONSOLE_PORT),'127.0.0.1');`);
 await start(runtime,[serverModule],'console');
 await ready(`http://127.0.0.1:${consolePort}/health`);
 check('Bundled Web management service starts on the selected isolated port');
 await start(runtime,[path.join(installed,'gateway/dist/index.js')],'gateway');
 const ca=await fs.readFile(config.https.certPath);
 request=(route,body)=>new Promise((resolve,reject)=>{
  const req=https.request({hostname:'127.0.0.1',port:gatewayPort,path:route,ca,method:body?'POST':'GET',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},timeout:5000},response=>{
   const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString()}));
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Gateway request timeout')));req.end(body?JSON.stringify(body):undefined);
 });
 let health;
 for(let attempt=0;attempt<40;attempt++){
  try{health=await request('/health');if(health.status===200)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.equal(health?.status,200);assert.equal(JSON.parse(health.text).version,release.gatewayVersion);
 check('Bundled Gateway starts with its own HTTPS configuration');
 for(const route of ['/console','/manage/']){
  const response=await request(route);assert.equal(response.status,200,route);assert(response.text.length>100,route);
  if(route==='/manage/'){assert(response.text.includes('/api/console-management/'));assert(!response.text.includes('__LOCAL_TOKEN__'));}
  const assets=[...response.text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)].map(match=>new URL(match[1],`https://127.0.0.1:${gatewayPort}${route}`));
  assert(assets.length>0,route+' entry assets');
  for(const asset of assets){
   // Embedded favicons have no origin and require no server-side asset route.
   if(asset.protocol==='data:'&&asset.href.startsWith('data:image/'))continue;
   assert.equal(asset.origin,`https://127.0.0.1:${gatewayPort}`);
   const result=await request(asset.pathname+asset.search);assert.equal(result.status,200,asset.pathname);assert(result.text.length>0,asset.pathname);
  }
 }
 check('Packaged chat and management pages include all referenced entry assets');
 const state=await request('/api/local-console/state');assert.equal(state.status,200);
 assert.equal(JSON.parse(state.text).config.model,'release-smoke-model');
 const management=await request('/api/console-management/state');assert.equal(management.status,200);
 assert.equal(JSON.parse(management.text).config.model,'release-smoke-model');
 check('Both phone management and Web management use the configured companion service');
 const pairing=await request('/api/pair/start');assert.equal(pairing.status,200);
 const info=JSON.parse(pairing.text),link=new URL(info.setupUrl);
 assert.equal(link.protocol,'codex-control:');assert.equal(new URL(link.searchParams.get('baseUrl')).port,String(gatewayPort));
 assert.equal(link.searchParams.get('certSha256').length,64);assert(info.qrSvg.includes('<svg'));
 check('Phone pairing advertises this installation address and certificate');
 report.passed=true;
}catch(error){
 report.passed=false;report.error=error.message;process.exitCode=1;
 console.error(error.message);
}finally{
 for(const child of children.reverse())if(child.exitCode===null){
  await run('taskkill.exe',['/PID',String(child.pid),'/T','/F']).catch(()=>{});
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('close',resolve));
 }
 report.sharedCodexEndpointUnchanged=previousEndpoint===await fs.readFile(endpoint,'utf8').catch(()=>null);
 report.checkedAt=new Date().toISOString();
 await fs.mkdir(path.dirname(reportFile),{recursive:true});
 for(const name of ['console','gateway']){
  const log=await fs.readFile(path.join(qa,name+'.log')).catch(()=>null);
  if(log)await fs.writeFile(path.join(path.dirname(reportFile),name+'-smoke.log'),log);
 }
 await fs.writeFile(reportFile,JSON.stringify(report,null,2));
 // Only the unique temporary tree created by this invocation is disposable.
 assert(path.dirname(qa)===work&&path.basename(qa).startsWith('isolated-'));
 await fs.rm(qa,{recursive:true,force:true,maxRetries:5,retryDelay:500});
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,version:report.version,report:reportFile,sharedCodexEndpointUnchanged:report.sharedCodexEndpointUnchanged}));
}
