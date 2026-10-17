import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {readClashOpenAI,selectClashOpenAI,testClashOpenAI} from '../dist/services/clashOpenAI.js';
test('OpenAI group read, acknowledged selection and delay stay within the group',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-clash-')),previous=process.env.CMC_CLASH_CONFIG;let selected='node-a',writes=0;
 const proxies=()=>({'🤖 OpenAI':{name:'🤖 OpenAI',type:'Selector',now:selected,all:['node-a','node-b']},Other:{name:'Other',type:'Selector',now:'node-a',all:['node-a']},'node-a':{name:'node-a',type:'Shadowsocks',history:[{delay:40}]},'node-b':{name:'node-b',type:'Shadowsocks'}});
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-secret');res.setHeader('Content-Type','application/json');
  if(req.url==='/proxies')return res.end(JSON.stringify({proxies:proxies()}));
  if(req.url.includes('/delay?'))return res.end('{"delay":31}');
  if(req.method==='PUT'){let data='';for await(const part of req)data+=part;selected=JSON.parse(data).name;writes++;res.statusCode=204;return res.end();}
  res.end(JSON.stringify(proxies()['🤖 OpenAI']));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const file=path.join(temp,'config.yaml');await fs.writeFile(file,`external-controller: 127.0.0.1:${server.address().port}\nsecret: fixture-secret\n`);process.env.CMC_CLASH_CONFIG=file;
  const first=await readClashOpenAI();assert.equal(first.groups.length,1);assert.equal(first.groups[0].selected,'node-a');assert(!JSON.stringify(first).includes('fixture-secret'));
  assert.equal((await selectClashOpenAI('🤖 OpenAI','node-b')).groups[0].selected,'node-b');assert.equal(writes,1);
  await assert.rejects(selectClashOpenAI('Other','node-a'),/OpenAI/);await assert.rejects(selectClashOpenAI('🤖 OpenAI','unknown'),/OpenAI/);assert.equal(writes,1);
  assert.equal((await testClashOpenAI('🤖 OpenAI','node-b')).delay,31);
 }finally{if(previous===undefined)delete process.env.CMC_CLASH_CONFIG;else process.env.CMC_CLASH_CONFIG=previous;await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
