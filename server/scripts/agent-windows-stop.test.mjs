import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execa} from 'execa';
import {AgentSessions} from '../src/services/agentSessions.ts';
import {backendCliFixtures} from './backend-cli-fixtures.mjs';

test('Windows CMD-owned Claude fixture stops its actual process tree and resumes', {skip:process.platform!=='win32',timeout:60000},async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-stop-fixture-'));
 const bins=await backendCliFixtures(home),threads=[],events=[],children=[],meta=new Map(),diagnostics=[];
 const store={threads,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,v)=>meta.set(id,structuredClone(v)),async upsertThread(value){let row=threads.find(t=>t.id===value.id);if(row)Object.assign(row,value);else threads.push(row={...value});return row}};
 const launch=(...args)=>{const child=execa(...args);children.push(child);return child};
 const terminate=async(...args)=>{const r=await execa(...args);diagnostics.push({pid:args[1][1],exitCode:r.exitCode,stderr:r.stderr,stdout:r.stdout});return r};
 const manager=new AgentSessions(store,{publish:event=>events.push(event)},launch,undefined,terminate,async()=>({command:bins.CODEX_MOBILE_CONTROL_CLAUDE_BIN,source:'configured'}));
 manager.models=async()=>[{model:'claude::default'}];
 const wait=async predicate=>{const until=Date.now()+10000;while(Date.now()<until){if(predicate())return;await new Promise(r=>setTimeout(r,25))}throw Error('Fixture condition timed out: '+JSON.stringify(diagnostics))};
 try{
  for(let i=0;i<3;i++){
   const start=events.length;
   await manager.handle({type:i?'turn.start':'thread.start',threadId:threads[0]?.id,model:'claude::default',permission:'full',text:'SLOW',initialText:i?undefined:'SLOW'});
   const id=threads[0].id;await wait(()=>events.slice(start).some(e=>e.type==='message.delta'));
   await manager.handle({type:'turn.interrupt',threadId:id});await wait(()=>!manager.owns(id));assert.equal(threads[0].status,'interrupted');
  }
  await manager.handle({type:'turn.start',threadId:threads[0].id,permission:'full',text:'CONTINUE'});
  await wait(()=>!manager.owns(threads[0].id));assert.equal(threads[0].status,'completed');
 }catch(error){console.error(JSON.stringify({diagnostics,owned:children.map(c=>({pid:c.pid,exitCode:c.exitCode,signalCode:c.signalCode}))}));throw error}
 finally{for(const child of children)if(child.exitCode==null&&child.signalCode==null&&child.pid)await execa('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{reject:false,windowsHide:true});}
});
