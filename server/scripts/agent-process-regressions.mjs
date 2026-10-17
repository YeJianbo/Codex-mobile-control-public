// Actual AgentSessions + EventHub + SQLite + WebSocket with spawned NDJSON fixtures.
// The installed AGY/Claude commands and account configuration are never invoked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import WebSocket,{WebSocketServer} from 'ws';
import {execa} from 'execa';
const root=path.resolve(import.meta.dirname,'..');
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-agent-process-'));
const project=path.join(home,'project'),bin=path.join(home,'bin');await fs.mkdir(project);await fs.mkdir(bin);
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,token='isolated-agent-process';
await fs.writeFile(path.join(home,'server.json'),JSON.stringify({host:'127.0.0.1',port,token,projectRoots:[project]}));
await fs.writeFile(path.join(home,'config.toml'),'model="fixture-codex"\n');
const mock=path.join(bin,'agent.mjs');
await fs.writeFile(mock,`import readline from 'node:readline';
const agent=process.argv[2],args=process.argv.slice(3),arg=name=>args[args.indexOf(name)+1];
const send=value=>console.log(JSON.stringify(value));
if(args.includes('models')){console.log('fixture-medium\\tFixture (Medium)\\nfixture-high\\tFixture (High)');process.exit(0);}
const session=args.includes('--resume')?arg('--resume'):args.includes('--conversation')?arg('--conversation'):'fixture-'+agent+'-session';
let pending=false;
const finish=(failed=false,response='fixture complete')=>{if(agent==='agy')send({event:'result',result:{status:failed?'FAILED':'SUCCESS',conversation_id:session,response:failed?'fixture provider unavailable':response}});else send({type:'result',session_id:session,is_error:failed,result:failed?'fixture provider unavailable':'fixture complete'});process.stdout.write('',()=>process.exit(0));};
const reply=()=>{send({type:'stream_event',event:{delta:{type:'text_delta',text:'fixture '+session+' effort='+arg('--effort')}}});finish();};
readline.createInterface({input:process.stdin}).on('line',line=>{const record=JSON.parse(line);
 if(record.type==='control_response'){if(pending){pending=false;reply();}return;}
 const text=agent==='agy'?record.message.content:record.message.content[0].text;
 if(text==='MALFORMED'){console.log('malformed fixture output');setTimeout(()=>process.exit(0),20);return;}
 if(agent==='agy')send({event:'init',conversation_id:session});else send({type:'system',session_id:session});
 if(text==='SLOW'){setInterval(()=>agent==='agy'?send({event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'waiting'}}):send({type:'stream_event',event:{delta:{type:'text_delta',text:'waiting'}}}),100);return;}
 if(text==='FAIL'){finish(true);return;}
 if(agent==='claude'&&text==='APPROVE'){pending=true;send({type:'control_request',request_id:'fixture-request',request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'fixture.txt'}}});return;}
 if(agent==='agy'){
   send({event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'fixture '+session+' effort='+arg('--effort')}});
   for(const output of ['a','ab','ab'])send({event:'step_update',step_update:{step_type:'tool',step_index:2,tool_name:'view_file',state:output==='a'?'RUNNING':'DONE',tool_info:{output}}});finish(false,'fixture '+session+' effort='+arg('--effort'));
 }else reply();
});`);

const previousHome=process.env.CODEX_MOBILE_CONTROL_HOME;
process.env.CODEX_MOBILE_CONTROL_HOME=home;
// StateStore captures its path at module load; import only after isolation is set.
const {AgentSessions}=await import('../dist/services/agentSessions.js');
const {StateStore}=await import('../dist/services/stateStore.js');
const {EventHub}=await import('../dist/services/eventHub.js');
const fixtureExecutable=async agent=>({command:agent==='antigravity'?'agy':agent,source:'path'});
let store=new StateStore();await store.load();
let hub=new EventHub(store),manager;
const children=[];
const launch=(command,args,options)=>{const child=execa(process.execPath,[mock,command==='claude'?'claude':'agy',...args],options);children.push(child);return child;};
const configure=()=>{manager=new AgentSessions(store,hub,launch,undefined,undefined,fixtureExecutable);manager.models=async()=>[{model:'claude::default',supportedReasoningEfforts:[]},{model:'antigravity::fixture',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'medium'}];};configure();
const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
server.on('connection',socket=>{hub.add(socket);socket.on('message',async raw=>{const command=JSON.parse(raw.toString());try{if(command.type==='approval.resolve')await manager.resolveApproval(command.approvalId,command.decision);else await manager.handle(command);}catch(error){hub.publish({type:'error',requestId:command.requestId,message:error.message});}});});
let socket,events=[];const checks=[];
const wait=async fn=>{const deadline=Date.now()+12000;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw Error('Owned agent process condition timed out');};
const connect=async()=>{const start=events.length;socket=new WebSocket('ws://127.0.0.1:'+server.address().port);socket.on('message',raw=>events.push(JSON.parse(raw.toString())));await wait(()=>events.slice(start).some(e=>e.type==='connected'));};
const send=command=>socket.send(JSON.stringify(command));
const turn=async command=>{const start=events.length;send(command);const thread=command.threadId||((await wait(()=>events.slice(start).find(e=>e.type==='thread.started'&&e.requestId===command.requestId))).threadId);const terminal=await wait(()=>events.slice(start).find(e=>e.type==='turn.completed'&&e.threadId===thread&&!e.replayed));await wait(()=>!manager.owns(thread));return {thread,terminal,events:events.slice(start).filter(e=>e.threadId===thread&&!e.replayed)};};
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await connect();
 await check('AGY unsupported ask is rejected before any process or thread',async()=>{const start=events.length;send({type:'thread.start',requestId:'agy-ask',projectPath:project,model:'antigravity::fixture',permission:'ask',initialText:'must reject'});await wait(()=>events.slice(start).some(e=>e.type==='error'&&e.requestId==='agy-ask'));assert(!events.slice(start).some(e=>e.type==='thread.started'));assert.equal(children.length,0);});
 let agy,claude;
 await check('AGY real fixture process streams tools once and saves medium effort',async()=>{agy=await turn({type:'thread.start',requestId:'agy-first',projectPath:project,model:'antigravity::fixture',effort:'medium',permission:'auto',initialText:'fixture'});assert.equal(agy.terminal.status,'completed');assert.equal(agy.events.filter(e=>e.type==='tool.output').map(e=>e.text).join(''),'ab');assert.equal(agy.events.filter(e=>e.type==='tool.completed').length,1);assert.match(agy.events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),/effort=medium/);});
 await check('Claude spawned stdio approval reaches WebSocket and completes with high effort',async()=>{const start=events.length;send({type:'thread.start',requestId:'claude-first',projectPath:project,model:'claude::default',effort:'high',permission:'ask',initialText:'APPROVE'});const thread=(await wait(()=>events.slice(start).find(e=>e.type==='thread.started'&&e.requestId==='claude-first'))).threadId;const approval=await wait(()=>events.slice(start).find(e=>e.type==='approval.requested'&&e.threadId===thread));send({type:'approval.resolve',approvalId:approval.approvalId,decision:'accept'});const terminal=await wait(()=>events.slice(start).find(e=>e.type==='turn.completed'&&e.threadId===thread));await wait(()=>!manager.owns(thread));assert.equal(terminal.status,'completed');assert.match(events.slice(start).filter(e=>e.type==='message.delta').map(e=>e.text).join(''),/effort=high/);claude={thread};});
 await check('WebSocket reconnect and SQLite reload preserve session, effort and transcript',async()=>{socket.terminate();await new Promise(r=>setTimeout(r,60));store.close();store=new StateStore();await store.load();hub=new EventHub(store);configure();await connect();for(const [first,effort,permission] of [[agy,'medium','auto'],[claude,'high','ask']]){const next=await turn({type:'turn.start',threadId:first.thread,permission,text:'resume'});assert.equal(next.terminal.status,'completed');assert.match(next.events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''),new RegExp('effort='+effort));assert.equal(manager.settings(first.thread).effort,effort);assert.equal(store.eventsForThread(first.thread).filter(e=>e.type==='user.message').length,2);}});
 await check('Each owned process cancels and recovers on the same thread',async()=>{for(const [first,permission] of [[agy,'auto'],[claude,'ask']]){const start=events.length;send({type:'turn.start',threadId:first.thread,permission,text:'SLOW'});await wait(()=>events.slice(start).some(e=>e.type==='message.delta'));send({type:'turn.interrupt',threadId:first.thread});const end=await wait(()=>events.slice(start).find(e=>e.type==='turn.completed'&&e.threadId===first.thread));await wait(()=>!manager.owns(first.thread));assert.equal(end.status,'interrupted');assert.equal((await turn({type:'turn.start',threadId:first.thread,permission,text:'recovered'})).terminal.status,'completed');}});
 await check('Failed and malformed fixture provider output becomes an error',async()=>{for(const [first,permission] of [[agy,'auto'],[claude,'ask']])for(const text of ['FAIL','MALFORMED']){const failed=await turn({type:'turn.start',threadId:first.thread,permission,text});assert.equal(failed.terminal.status,'error');assert(failed.events.some(e=>e.type==='error'&&e.message));}});
 const artifacts=path.join(root,'..','artifacts');await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,'agent-process-results.json'),JSON.stringify({checks,passed:true,scope:'Actual adapter, owned Node NDJSON children, EventHub WebSocket and SQLite reload; CLI catalog tested separately with installed help',realModels:false,installedAccountsUsed:false},null,2));
}catch(error){
 console.error(JSON.stringify({threads:store.threads.map(t=>({id:t.id,status:t.status})),recentEvents:events.slice(-8).map(e=>({type:e.type,status:e.status,message:e.message})),ownedChildren:children.map(c=>({pid:c.pid,exitCode:c.exitCode,killed:c.killed}))}));throw error;
}finally{
 socket?.terminate();for(const client of server.clients)client.terminate();await new Promise(r=>server.close(r));
 for(const child of children)if(child.exitCode===undefined)child.kill();
 store.close();if(previousHome===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousHome;
}
