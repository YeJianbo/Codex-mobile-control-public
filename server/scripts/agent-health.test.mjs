import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentSessions} from '../dist/services/agentSessions.js';
import {AgentHealthMonitor} from '../dist/services/agentHealthMonitor.js';

test('health samples processes while CLI checks are pending and returns complete results',async()=>{
 let releaseAgents,releaseSample,markSampleStarted;
 const agents=new Promise(resolve=>releaseAgents=resolve),sampleGate=new Promise(resolve=>releaseSample=resolve);
 const sampleStarted=new Promise(resolve=>markSampleStarted=resolve);
 let samples=0,finished=false;
 const monitor=new AgentHealthMonitor({sample:async()=>{
  samples++;markSampleStarted();await sampleGate;
  return {processes:[{id:101,parent:0,name:'claude.exe',memoryBytes:4096}],desktop:{installed:true,version:'1.2.3.4'}};
 }});
 const result=monitor.enrich(agents).then(value=>{finished=true;return value;});
 await sampleStarted;
 assert.equal(finished,false);
 releaseAgents([{agent:'claude',version:'Claude 2.1.0',activeCount:2}]);
 await Promise.resolve();assert.equal(finished,false);
 releaseSample();
 const health=await result;
 assert.equal(health.agents[0].activeCount,2);assert.equal(health.agents[0].version,'Claude 2.1.0');
 assert.equal(health.agents[0].process.state,'running');assert.equal(health.agents[0].process.memoryBytes,4096);
 assert.equal(health.agents[0].update.installedVersion,'2.1.0');assert.equal(health.desktop.version,'1.2.3.4');
 await monitor.enrich([{agent:'claude',version:'Claude 2.2.0'}]);assert.equal(samples,1);
});

test('agent health reports live work, caches versions and never submits a prompt',async()=>{
 const calls=[];
 const agents=new AgentSessions({threads:[]},{publish(){}},()=>{throw Error('No task may be launched');},async(command,args)=>{calls.push({command,args});return {exitCode:0,stdout:'Claude 1.2.3\n',stderr:''};},undefined,async agent=>{if(agent==='claude')return {command:'claude',source:'path'};throw Error('not installed in fixture');});
 agents.models=async()=>{throw Error('Health must not load model catalogs');};
 agents.catalog={at:Date.now(),models:[{model:'claude::default'}]};
 agents.executables.set('claude',{command:'claude',source:'path'});
 agents.active.set('claude-active',{});agents.starting.add('claude-active');
 const first=(await agents.health()).find(a=>a.agent==='claude');
 assert.equal(first.version,'Claude 1.2.3');assert.equal(first.activeCount,1);assert.equal(first.modelCount,1);assert.equal(first.state,'ready');
 await agents.health();assert.equal(calls.length,1);
 await agents.health(true);assert.equal(calls.length,2);
 assert(calls.every(call=>call.args.length===1&&call.args[0]==='--version'));
});

test('cold health and explicit refresh read only local CLIs, preserving protocol failures and active counts',async()=>{
 const calls=[],located=[];
 const agents=new AgentSessions({threads:[]},{publish(){}},()=>{throw Error('No task may be launched');},async(command,args)=>{calls.push({command,args});return {exitCode:0,stdout:'Claude 2.0.0',stderr:''};},undefined,async agent=>{located.push(agent);if(agent==='claude')return {command:'claude',source:'configured'};throw Error('not installed in fixture');});
 agents.models=()=>{throw Error('A stalled remote model catalog must not be read');};
 agents.protocolErrors.set('claude','ACP connection failed');
 agents.active.set('grok-active',{});agents.starting.add('grok-active');
 const first=await agents.health(),claude=first.find(a=>a.agent==='claude');
 assert.equal(claude.installed,true);assert.equal(claude.version,'Claude 2.0.0');assert.equal(claude.modelCount,null);
 assert.equal(claude.available,false);assert.match(claude.reason,/ACP connection failed/);
 const grok=first.find(a=>a.agent==='grok');assert.equal(grok.installed,false);assert.equal(grok.activeCount,1);
 await agents.health();assert.equal(calls.length,1);const initial=located.length;
 await agents.health(true);assert.equal(located.length,initial*2);assert.equal(calls.length,2);
 assert(calls.every(call=>call.args.length===1&&call.args[0]==='--version'));
});

test('a late version reply from the previous CLI path cannot replace the current version',async()=>{
 let command='old-cli',releaseOld,started;
 const gate=new Promise(resolve=>releaseOld=resolve),oldStarted=new Promise(resolve=>started=resolve);
 const agents=new AgentSessions({threads:[]},{publish(){}},()=>{throw Error('No task may be launched');},async(binary,args)=>{
  assert.deepEqual(args,['--version']);if(binary==='old-cli'){started();await gate;return {exitCode:0,stdout:'Old 1.0.0',stderr:''};}
  return {exitCode:0,stdout:'New 2.0.0',stderr:''};
 },undefined,async agent=>{if(agent==='claude')return {command,source:'configured'};throw Error('not installed in fixture');});
 agents.models=()=>{throw Error('Health must not load model catalogs');};
 const old=agents.health(true);await oldStarted;command='new-cli';
 agents.active.set('grok-active',{});
 const current=(await agents.health(true)).find(a=>a.agent==='claude');assert.equal(current.version,'New 2.0.0');
 releaseOld();const delayed=await old;assert.equal(delayed.find(a=>a.agent==='grok').activeCount,1);
 assert.equal((await agents.health()).find(a=>a.agent==='claude').version,'New 2.0.0');
});
