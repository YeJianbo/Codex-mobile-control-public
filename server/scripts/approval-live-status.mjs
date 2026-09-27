import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.codex-mobile-control','server.json'),'utf8'));
const ca=fs.readFileSync(config.https.certPath);
function get(route){return new Promise((resolve,reject)=>{
  const req=https.get({hostname:'127.0.0.1',port:config.port,path:route,ca,servername:'localhost',headers:{Authorization:`Bearer ${config.token}`},timeout:30000},res=>{
    let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>res.statusCode===200?resolve(JSON.parse(body)):reject(new Error(`${route}: HTTP ${res.statusCode}`)));
  });req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);
});}
const threadId=process.argv[2];
const status=await get('/api/codex/status');
const settings=await get('/api/settings/remote-approval');
const approvals=await get('/api/approvals'+(threadId?`?threadId=${encodeURIComponent(threadId)}`:''));
const queue=threadId?await get(`/api/threads/${encodeURIComponent(threadId)}/queue`):{messages:[]};
console.log(JSON.stringify({codex:status.codex,bridge:{configured:settings.bridgeConfigured,connected:settings.connected,auto:settings.desktopAutoApprove},approvals:approvals.approvals.map(item=>({type:item.approvalType,status:item.status,method:item.method,threadKnown:item.threadId!=='unknown',ageSeconds:Math.round((Date.now()-Date.parse(item.createdAt))/1000)})),queue:queue.messages.map(item=>({status:item.status,canSteer:item.canSteer,sourcePublic:item.sourcePublic===true}))},null,2));
