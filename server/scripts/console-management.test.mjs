import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerConsoleManagement,consoleManagementAllowed} from '../src/services/consoleManagement.ts';
test('management UI has no embedded credentials and API requests keep device authentication',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'console-management-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'index.html'),'<html><head><meta name="local-token" content="__LOCAL_TOKEN__"><link href="/app.css"></head><body><script src="/app.js"></script></body></html>');
  const calls=[],app=Fastify();t.after(()=>app.close());
  app.addHook('preHandler',async(request,reply)=>{if(request.url.startsWith('/api/')&&request.headers.authorization!=='Bearer paired-fixture')return reply.code(401).send({error:'unauthorized'});});
  registerConsoleManagement(app,{webDirectory:directory,client:{managementRequest:async(...args)=>{calls.push(args);return {ok:true};}}});
  const page=await app.inject('/manage/');assert.equal(page.statusCode,200);assert.match(page.body,/content=""/);assert.match(page.body,/\/api\/console-management\//);assert.match(page.body,/\/manage\/app.js/);assert(!page.body.includes('__LOCAL_TOKEN__'));
  assert.equal((await app.inject('/api/console-management/state')).statusCode,401);assert.equal(calls.length,0);
  const result=await app.inject({url:'/api/console-management/analytics?range=day',headers:{authorization:'Bearer paired-fixture'}});assert.equal(result.statusCode,200);assert.equal(calls[0][0],'/api/analytics?range=day');
  assert.equal((await app.inject({method:'POST',url:'/api/console-management/access/remote',headers:{authorization:'Bearer paired-fixture',origin:'https://other.example'},payload:{publicUrl:'https://phone.example.com'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/console-management/arbitrary/http',headers:{authorization:'Bearer paired-fixture'},payload:{url:'https://other.example'}})).statusCode,404);
});
test('management forwarding allows only the console operations and supported HTTP methods',()=>{
  assert.equal(consoleManagementAllowed('POST','access/pair'),true);assert.equal(consoleManagementAllowed('GET','access/channels'),true);
  for(const [method,route]of [['DELETE','state'],['POST','http://other.example'],['GET','../auth.json'],['GET','access//channels'],['GET','access/%2e%2e']])assert.equal(consoleManagementAllowed(method,route),false);
});
