import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import WebSocket from 'ws';
import {CodexAppServerClient} from '../src/codex/appServerClient.ts';
import {SessionManager} from '../src/services/sessionManager.ts';
import {writeRemoteAutoApproval} from '../src/services/remoteApprovalSettings.ts';

test('desktop MCP elicitation crosses the authenticated shared bridge and resolves once through the gateway',{timeout:30000},async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-mcp-relay-'));
  const directory=path.join(home,'desktop-bridge'),configPath=path.join(directory,'config.json');
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  const previousCodex=process.env.CODEX_HOME;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  process.env.CODEX_HOME=path.join(home,'codex');
  let gateway,desktop,endpoint;
  try{
    await fs.mkdir(directory);
    await fs.copyFile(path.join(root,'scripts/shared-backend.mjs'),path.join(directory,'shared-backend.mjs'));
    // Stub only CLI discovery. The approval proxy, transport and gateway below are production code.
    await fs.writeFile(path.join(directory,'desktop-cli-resolver.mjs'),'export async function resolveDesktopCli(fallback){return fallback}');
    const fake=path.join(directory,'fixture-app-server.mjs');
    await fs.writeFile(fake,`import fs from 'node:fs/promises';import {createRequire} from 'node:module';
      const {WebSocketServer}=createRequire(${JSON.stringify(path.join(root,'package.json'))})('ws');
      const args=process.argv.slice(2),url=new URL(args[args.indexOf('--listen')+1]);
      const token=await fs.readFile(args[args.indexOf('--ws-token-file')+1],'utf8');
      const server=new WebSocketServer({host:url.hostname,port:Number(url.port),verifyClient:({req})=>req.headers.authorization==='Bearer '+token});
      server.on('connection',socket=>{let resolved=0;socket.on('message',raw=>{
        const message=JSON.parse(raw.toString());
        if(message.method==='initialize')socket.send(JSON.stringify({id:message.id,result:{}}));
        else if(message.method==='fixture/elicitation')socket.send(JSON.stringify({id:777,method:'mcpServer/elicitation/request',params:{threadId:'fixture-thread',serverName:'computer',mode:'form',message:'Allow computer?',requestedSchema:{type:'object',properties:{}}}}));
        else if(message.id===777&&!message.method){resolved++;socket.send(JSON.stringify({method:'fixture/resolved',params:{resolved,result:message.result}}))}
        else if(message.method==='fixture/count')socket.send(JSON.stringify({id:message.id,result:{resolved}}));
      })});`);
    await fs.writeFile(configPath,JSON.stringify({realCli:process.execPath,node:process.execPath,gatewayRoot:root}));
    await fs.writeFile(path.join(directory,'startup-args.json'),JSON.stringify([fake,'app-server']));
    const {ensureSharedBackend}=await import(pathToFileURL(path.join(directory,'shared-backend.mjs')).href);
    endpoint=await ensureSharedBackend(configPath);
    await writeRemoteAutoApproval(true);
    gateway=new CodexAppServerClient();
    const events=[];
    const store={approvals:[],threads:[],async expirePendingApprovals(){return []},async addApproval(value){const row={...value,status:'pending'};this.approvals.push(row);return row},async resolveApproval(id,decision){this.approvals.find(row=>row.id===id).status=decision==='accept'?'accepted':'declined'}};
    const manager=new SessionManager(gateway,{publish:event=>events.push(event)},store);
    await gateway.start();
    const wait=async predicate=>{const deadline=Date.now()+10000;while(!predicate()){if(Date.now()>deadline)throw Error('fixture event timeout');await new Promise(resolve=>setTimeout(resolve,20))}};
    await wait(()=>gateway.desktopApprovalStatus().connected);
    desktop=new WebSocket(endpoint.desktopUrl,{headers:{Authorization:'Bearer '+endpoint.token}});
    const received=[];desktop.on('message',raw=>received.push(JSON.parse(raw.toString())));
    await once(desktop,'open');
    desktop.send(JSON.stringify({id:10,method:'fixture/elicitation'}));
    await wait(()=>received.some(message=>message.method==='fixture/resolved'));
    assert.deepEqual(received.find(message=>message.method==='fixture/resolved').params,{resolved:1,result:{action:'accept',content:{}}});
    assert.equal(events.some(event=>event.type==='approval.requested'),false);
    assert.equal(store.approvals[0].status,'accepted');
    desktop.send(JSON.stringify({id:777,result:{action:'decline',content:null}}));
    desktop.send(JSON.stringify({id:11,method:'fixture/count'}));
    await wait(()=>received.some(message=>message.id===11));
    assert.equal(received.find(message=>message.id===11).result.resolved,1);
    manager.closeCapacityRetries();
  }finally{
    desktop?.terminate();try{await gateway?.stop()}catch{}
    if(!endpoint){try{endpoint=JSON.parse(await fs.readFile(path.join(directory,'endpoint.json'),'utf8'))}catch{}}
    const pids=new Set([endpoint?.bridgePid,endpoint?.serverPid]);
    try{pids.add(Number(await fs.readFile(path.join(directory,'owner.lock'),'utf8')))}catch{}
    for(const pid of pids)if(Number.isInteger(pid)&&pid>0)try{process.kill(pid)}catch{}
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    if(previousCodex===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousCodex;
    assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
  }
});
