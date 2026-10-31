// Exercises the installed Pi adapter against an isolated local OpenAI-compatible endpoint.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readHarnessCatalog,harnessAcp} from '../dist/services/harnessAcp.js';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-pi-smoke-'));
const server=http.createServer((request,response)=>{
  request.resume();
  request.on('end',()=>{
    response.writeHead(200,{'content-type':'text/event-stream'});
    const event=value=>response.write(`data: ${JSON.stringify(value)}\n\n`);
    event({id:'local-smoke',object:'chat.completion.chunk',created:1,model:'local-test',choices:[{index:0,delta:{role:'assistant',content:'ACP_OK'},finish_reason:null}]});
    event({id:'local-smoke',object:'chat.completion.chunk',created:1,model:'local-test',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
    response.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
process.env.PI_CODING_AGENT_DIR=dir;
await fs.writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{localtest:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'local-only',models:[{id:'local-test',name:'Local test',contextWindow:4096,maxTokens:512}]}}}));
await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({defaultProvider:'localtest',defaultModel:'local-test',quietStartup:true}));
const command=path.join(os.homedir(),'.codex','tools','harnesses','pi','node_modules','.bin',process.platform==='win32'?'pi-acp.cmd':'pi-acp');
try{
  const catalog=await readHarnessCatalog('pi',command,dir);
  if(!catalog.models.some(model=>model.model==='pi::localtest/local-test'))throw Error('Pi ACP model missing from catalog');
  const run=harnessAcp({agent:'pi',command,cwd:dir,model:'localtest/local-test',permission:'full',content:[{type:'text',text:'Reply briefly.'}],approve:async()=>false});
  let output='';run.stdout.on('data',chunk=>{output+=chunk;});
  const dispatch=await run.promptDispatch;
  const result=await run;
  if(result.exitCode!==0||!output.includes('ACP_OK')||!dispatch.session)throw Error(`Pi ACP prompt failed: ${output.slice(-1500)}`);
  const continued=harnessAcp({agent:'pi',command,cwd:dir,session:dispatch.session,model:'localtest/local-test',permission:'full',content:[{type:'text',text:'Continue.'}],approve:async()=>false});
  let continuedOutput='';continued.stdout.on('data',chunk=>{continuedOutput+=chunk;});
  const resumed=await continued.promptDispatch,continuedResult=await continued;
  if(continuedResult.exitCode!==0||resumed.session!==dispatch.session||!continuedOutput.includes('ACP_OK'))throw Error(`Pi ACP resume failed: ${continuedOutput.slice(-1500)}`);
  console.log('Pi ACP catalog, isolated prompt and resume passed');
}finally{
  await new Promise(resolve=>server.close(resolve));
  const relative=path.relative(os.tmpdir(),dir);
  if(relative.startsWith('cmc-pi-smoke-')&&!relative.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});
}
