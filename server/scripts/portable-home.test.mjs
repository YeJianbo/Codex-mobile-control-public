import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('installation health probe reads the explicit instance directory instead of the current user Gateway',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'portable-home-'));const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer isolated-token');res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,version:'isolated-instance'}));});
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.writeFile(path.join(home,'server.json'),JSON.stringify({port:server.address().port,token:'isolated-token',https:{enabled:false}}));const {stdout}=await promisify(execFile)(process.execPath,[path.join(import.meta.dirname,'local-gateway-check.mjs'),'health'],{env:{...process.env,CODEX_MOBILE_CONTROL_HOME:home},windowsHide:true});assert.equal(JSON.parse(stdout).version,'isolated-instance');}
 finally{await new Promise(resolve=>server.close(resolve));await fs.rm(home,{recursive:true,force:true});}
});
