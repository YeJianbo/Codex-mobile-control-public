import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {grokAcp} from '../src/services/grokAcp.ts';
import {officialAcp} from '../src/services/claudeAcp.ts';

function peer(failMode=false){
  const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough(),requests=[];
  let finish;const done=new Promise(resolve=>finish=resolve);
  const child={stdin,stdout,stderr,then:done.then.bind(done),kill(){stdout.end();stderr.end();finish({exitCode:0});return true;}};
  stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){
    const request=JSON.parse(line);requests.push(request);
    queueMicrotask(()=>{
      if(request.id===undefined)return;
      let result={};
      if(request.method==='initialize')result={agentCapabilities:{loadSession:true,promptCapabilities:{image:true}}};
      if(request.method==='session/new')result={sessionId:'fixture-session',modes:{availableModes:failMode?[]:[{id:'default'}]}};
      if(request.method==='session/prompt')result={stopReason:'end_turn'};
      stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
    });
  }});
  return {child,requests};
}

test('official ACP reports preparation failure without sending and retains the native session',async()=>{
  const f=peer(true),run=officialAcp({agent:'claude',cwd:process.cwd(),permission:'ask',content:[{type:'text',text:'test'}],approve:async()=>false},()=>f.child);
  const dispatch=await run.promptDispatch;await run;
  assert.equal(dispatch.phase,'not_started');assert.equal(dispatch.session,'fixture-session');
  assert(!f.requests.some(row=>row.method==='session/prompt'));
});

for(const agent of ['grok','claude'])test(`${agent} ACP confirms only after writing the prompt`,async()=>{
  const f=peer(),options={cwd:process.cwd(),permission:'ask',content:[{type:'text',text:'test'}],approve:async()=>false};
  const run=agent==='grok'?grokAcp(options,()=>f.child):officialAcp({...options,agent:'claude'},()=>f.child);
  const dispatch=await run.promptDispatch;assert.equal(dispatch.phase,'written');assert.equal(dispatch.session,'fixture-session');
  await run;assert(f.requests.some(row=>row.method==='session/prompt'));
});
