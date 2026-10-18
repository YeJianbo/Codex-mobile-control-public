import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const base='http://127.0.0.1:25819';
const resultFile=path.join(os.homedir(),'.codex','codexmate','local-console','routing-direct-result.json');
const save=result=>fs.writeFileSync(resultFile,JSON.stringify({...result,at:new Date().toISOString()},null,2));
await new Promise(resolve=>setTimeout(resolve,1500));
try{
 const html=await(await fetch(base,{signal:AbortSignal.timeout(10000)})).text();
 const token=html.match(/name="local-token" content="([^"]+)"/)?.[1];
 if(!token)throw Error('Missing console authentication');
 const headers={'x-local-token':token,'content-type':'application/json'};
 const previewResponse=await fetch(base+'/api/routing/preview',{method:'POST',headers,body:JSON.stringify({enabled:false}),signal:AbortSignal.timeout(15000)});
 const preview=await previewResponse.json();
 if(!previewResponse.ok)throw Error(preview.error||'Preview failed');
 save({state:'running',preview:{processCount:preview.processCount,defaultModel:preview.defaultModel}});
 const response=await fetch(base+'/api/routing/direct',{method:'POST',headers,body:JSON.stringify({confirm:true,restart:true}),signal:AbortSignal.timeout(240000)});
 const result=await response.json();
 save({state:response.ok?'done':'error',status:response.status,result});
 if(!response.ok)process.exitCode=1;
}catch(error){save({state:'error',error:error.message});process.exitCode=1;}
