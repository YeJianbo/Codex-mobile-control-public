import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readHarnessCatalog,harnessAcp} from '../dist/services/harnessAcp.js';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-pi-effort-'));
const requests=[];
const server=http.createServer((request,response)=>{
  let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
    requests.push(JSON.parse(body));
    response.writeHead(200,{'content-type':'text/event-stream'});
    const event=value=>response.write(`data: ${JSON.stringify(value)}\n\n`);
    event({id:'local',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]});
    event({id:'local',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
    response.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
process.env.PI_CODING_AGENT_DIR=dir;
const model=id=>({id,name:id,reasoning:true,contextWindow:4096,maxTokens:512,thinkingLevelMap:{off:'none',minimal:null,low:'low',medium:id==='ecnu-max'?'high':'medium',high:null,xhigh:id==='ecnu-max'?'max':'xhigh',max:null}});
await fs.writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{ecnu:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'local-only',compat:{supportsDeveloperRole:false,maxTokensField:'max_tokens',thinkingFormat:'deepseek'},models:[model('ecnu-max'),model('ecnu-plus')]}}}));
await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({defaultProvider:'ecnu',defaultModel:'ecnu-max',quietStartup:true}));
const command=path.join(os.homedir(),'.codex','tools','harnesses','pi','node_modules','.bin',process.platform==='win32'?'pi-acp.cmd':'pi-acp');
try{
  const catalog=await readHarnessCatalog('pi',command,dir);
  for(const id of ['ecnu-max','ecnu-plus']){
    const selected=catalog.models.find(entry=>entry.model===`pi::ecnu/${id}`);
    assert.deepEqual(selected?.supportedReasoningEfforts.map(entry=>entry.reasoningEffort),['off','low','medium','xhigh']);
    for(const [level,expected] of Object.entries({off:null,low:'low',medium:id==='ecnu-max'?'high':'medium',xhigh:id==='ecnu-max'?'max':'xhigh'})){
      const run=harnessAcp({agent:'pi',command,cwd:dir,model:`ecnu/${id}`,effort:level,permission:'full',content:[{type:'text',text:'Reply OK.'}],approve:async()=>false});
      run.stdout.resume();run.stderr.resume();
      assert.equal((await run).exitCode,0,`${id} ${level} failed`);
      const body=requests.at(-1);
      assert.equal(body.model,id);
      assert.equal(body.thinking?.type,expected?'enabled':'disabled');
      assert.equal(body.reasoning_effort,expected||undefined);
    }
  }
  console.log('Pi ECNU: both model catalogs and all eight request mappings passed');
}finally{
  await new Promise(resolve=>server.close(resolve));
  const relative=path.relative(os.tmpdir(),dir);
  if(relative.startsWith('cmc-pi-effort-')&&!relative.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});
}
