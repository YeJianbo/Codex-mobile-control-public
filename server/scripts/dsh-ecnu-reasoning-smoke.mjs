import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {harnessAcp} from '../dist/services/harnessAcp.js';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-dsh-effort-'));
const requests=[];
const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
  requests.push(JSON.parse(body));response.writeHead(200,{'content-type':'text/event-stream'});
  const event=value=>response.write(`data: ${JSON.stringify(value)}\n\n`);
  event({id:'local',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]});
  event({id:'local',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  response.end('data: [DONE]\n\n');
});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const original=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
await fs.mkdir(path.join(dir,'profiles','desktop'),{recursive:true});
await fs.cp(path.join(original,'profiles','acp'),path.join(dir,'profiles','acp'),{recursive:true});
process.env.DSH_HOME=dir;process.env.ECNU_API_KEY='local-only';
const model=(id,reasoningEfforts)=>({id,name:id,contextWindow:4096,maxTokens:512,reasoningEfforts});
const patch=[{id:'llm-pi-ai',config:{providers:{ecnu:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'ECNU_API_KEY',reasoning:'off',compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens',thinkingFormat:'deepseek'},models:[model('ecnu-max',{off:null,low:'low',high:'high',max:'max'}),model('ecnu-plus',{off:null,low:'low',medium:'medium',max:'xhigh'})]}}}}];
await fs.writeFile(path.join(dir,'profiles','desktop','cordis.patch.yml'),JSON.stringify(patch));
const command=path.join(os.homedir(),'.codex','tools','harnesses','dsh.cmd');
try{
  for(const [id,levels] of Object.entries({'ecnu-max':{off:null,low:'low',high:'high',max:'max'},'ecnu-plus':{off:null,low:'low',medium:'medium',max:'xhigh'}}))for(const [level,expected] of Object.entries(levels)){
    const run=harnessAcp({agent:'deepseek',command,cwd:dir,model:JSON.stringify(['ecnu',id]),effort:level,permission:'full',content:[{type:'text',text:'Reply OK.'}],approve:async()=>false});
    run.stdout.resume();let error='';run.stderr.on('data',chunk=>error+=chunk);
    const result=await run;assert.equal(result.exitCode,0,`${id} ${level}: ${error}`);
    const body=requests.at(-1);assert.equal(body.model,id);assert.equal(body.thinking?.type,expected?'enabled':'disabled');assert.equal(body.reasoning_effort,expected||undefined);
  }
  console.log('DSH ECNU: all eight request mappings passed');
}finally{
  await new Promise(resolve=>server.close(resolve));
  const relative=path.relative(os.tmpdir(),dir);
  if(relative.startsWith('cmc-dsh-effort-')&&!relative.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});
}
