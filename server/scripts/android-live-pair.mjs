import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';

const config=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.codex-mobile-control','server.json'),'utf8'));
const cert=fs.readFileSync(config.https.certPath);
const fingerprint=new X509Certificate(cert).fingerprint256.replaceAll(':','');
const adb=path.join(process.env.ANDROID_HOME||path.join(os.homedir(),'AppData','Local','Android','Sdk'),'platform-tools','adb.exe');
function get(route,method='GET'){
  return new Promise((resolve,reject)=>{
    const request=https.request({hostname:'127.0.0.1',port:config.port,path:route,method,ca:cert,servername:'localhost',headers:{Authorization:`Bearer ${config.token}`},timeout:5000},response=>{
      let body='';response.setEncoding('utf8');response.on('data',part=>body+=part);
      response.on('end',()=>resolve({status:response.statusCode,body:body?JSON.parse(body):{}}));
    });
    request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('Gateway timeout')));request.end();
  });
}
const original=new Set((await get('/api/devices')).body.devices.map(device=>device.id));
let created;
try{
  execFileSync(adb,['reverse',`tcp:${config.port}`,`tcp:${config.port}`],{stdio:'ignore'});
  const pair=await get('/api/pair/start','POST');
  assert.equal(pair.status,200);
  const setup=`codex-control://pair?baseUrl=${encodeURIComponent(`https://127.0.0.1:${config.port}`)}&code=${encodeURIComponent(pair.body.code)}&certSha256=${fingerprint}`;
  execFileSync(adb,['shell','am','start','-a','android.intent.action.VIEW','-n','com.localcodex.control/.MainActivity','-d',`'${setup}'`],{stdio:'ignore'});
  for(let attempt=0;attempt<25;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    created=(await get('/api/devices')).body.devices.find(device=>!original.has(device.id));
    if(created?.lastSeenAt)break;
  }
  assert.ok(created?.lastSeenAt,'Android did not pair and open an authenticated connection');
  console.log('Android emulator paired with pinned HTTPS and opened an authenticated connection.');
}finally{
  if(created?.id)await get(`/api/devices/${encodeURIComponent(created.id)}`,'DELETE');
  execFileSync(adb,['reverse','--remove',`tcp:${config.port}`],{stdio:'ignore'});
}
