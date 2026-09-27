import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.codex-mobile-control','server.json'),'utf8'));
if(config.https?.enabled)throw new Error('Gateway HTTPS already enabled');
const body=JSON.stringify({enabled:true,generateSelfSigned:true});
const result=await new Promise((resolve,reject)=>{
  const request=http.request({
    hostname:'127.0.0.1',port:config.port,path:'/api/config/https',method:'PUT',
    headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
    timeout:10000,
  },response=>{
    let text='';
    response.setEncoding('utf8');
    response.on('data',part=>text+=part);
    response.on('end',()=>{
      if(response.statusCode!==200)return reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0,200)}`));
      try{resolve(JSON.parse(text));}catch(error){reject(error);}
    });
  });
  request.on('timeout',()=>request.destroy(new Error('HTTPS setup timed out')));
  request.on('error',reject);
  request.end(body);
});
if(!result.https?.enabled||!result.https?.certExists||!result.https?.keyExists)throw new Error('HTTPS certificate was not generated');
console.log('Gateway HTTPS certificate generated; restart required.');
