import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const home=process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control');
const config=JSON.parse(fs.readFileSync(path.join(home,'server.json'),'utf8'));
const transport=config.https?.enabled?https:http;
const ca=config.https?.enabled?fs.readFileSync(config.https.certPath):undefined;
function get(route,method='GET'){
  return new Promise((resolve,reject)=>{
    const request=transport.request({hostname:'127.0.0.1',port:config.port,path:route,method,headers:{Authorization:`Bearer ${config.token}`},ca,servername:'localhost',timeout:15000},response=>{
      let body='';
      response.setEncoding('utf8');
      response.on('data',part=>body+=part);
      response.on('end',()=>{
        if(response.statusCode!==200)return reject(new Error(`${route}: HTTP ${response.statusCode}`));
        try{resolve(JSON.parse(body));}catch(error){reject(error);}
      });
    });
    request.on('timeout',()=>request.destroy(new Error(`${route}: timeout`)));
    request.on('error',reject);
    request.end();
  });
}
try {
  const result=process.argv[2]==='start'
    ?await get('/api/codex/start','POST')
    :process.argv[2]==='health'
    ?await get('/health')
    :process.argv[2]==='pair'
      ?await get('/api/pair/start')
      :{threads:(await get('/api/threads')).threads,runtime:(await get('/api/codex/status')).codex};
  process.stdout.write(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}
