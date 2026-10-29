import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';

const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-message-edit-'));
const previous=process.env.CODEX_MOBILE_CONTROL_HOME,previousCodex=process.env.CODEX_HOME;
process.env.CODEX_MOBILE_CONTROL_HOME=home;process.env.CODEX_HOME=path.join(home,'codex');
const {SessionManager}=await import('../dist/services/sessionManager.js');
const {StateStore}=await import('../dist/services/stateStore.js');
const {readCodexConversationEvents}=await import('../dist/services/codexSessions.js');
const store=new StateStore();await store.load();
const sessions=path.join(process.env.CODEX_HOME,'sessions');await fs.mkdir(sessions,{recursive:true});
const row=(type,payload)=>({timestamp:'2026-10-14T00:00:00.000Z',type,payload});
const transcript=(id,text)=>[
 row('event_msg',{type:'task_started',turn_id:id}),
 row('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]}),
 row('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'reply '+text}]}),
 row('event_msg',{type:'task_complete',turn_id:id}),
];
let number=0;const managers=[];
async function fixture(failure=''){
 const id=`44444444-4444-4444-4444-${String(++number).padStart(12,'0')}`;
 const file=path.join(sessions,`rollout-${id}.jsonl`);
 await fs.writeFile(file,[...transcript('prior','保留上一条'),...transcript('last','旧的最后一条')].map(JSON.stringify).join('\n')+'\n');
 const turns=[{id:'prior',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'保留上一条'}]}]},
  {id:'last',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'# Files mentioned by the user:\n\n## doc.md: C:/isolated/doc.md\n\n## My request:\n旧的最后一条'},{type:'localImage',path:'C:/isolated/image.png'}]}]}];
 await store.upsertThread({id,title:'isolated',status:'completed'});
 for(const [n,event] of [
  {type:'turn.started',turnId:'prior'},{type:'user.message',turnId:'prior',text:'保留上一条'},
  {type:'turn.completed',turnId:'prior',status:'completed'},
  {type:'turn.started',turnId:'last'},{type:'user.message',turnId:'last',text:'旧的最后一条'},
  {type:'message.delta',itemId:'old-answer',text:'旧回复'},
  {type:'turn.completed',turnId:'last',status:'completed'},
 ].entries())await store.appendEvent({...event,threadId:id,eventId:`${id}-${n}`,createdAt:`2026-10-14T00:00:0${n}.000Z`});
 const codex=new EventEmitter(),calls=[],published=[];let rejected=false;
 codex.request=async(method,params)=>{
  calls.push({method,params});
  if(method==='thread/resume')return {thread:{id,status:{type:'idle'}}};
  if(method==='thread/turns/list')return {data:turns.slice(-params.limit).reverse()};
  if(method==='thread/revert'){
   assert.equal(params.beforeTurnId,'last');turns.pop();
   await fs.writeFile(file,transcript('prior','保留上一条').map(JSON.stringify).join('\n')+'\n');
   return {thread:{id,turns:[]},turnsBackwardsCursor:'prior',itemsBackwardsCursor:null};
  }
  if(method==='turn/start'){
   if(failure&&!rejected){rejected=true;throw Error(failure);}
   turns.push({id:'edited',status:'completed',items:[{type:'userMessage',content:params.input}]});
   await fs.appendFile(file,transcript('edited',params.input[0].text).map(JSON.stringify).join('\n')+'\n');
   return {turn:{id:'edited'}};
  }
  return {};
 };
 const hub={publish:event=>{published.push(event);void store.appendEvent({...event,eventId:`published-${id}-${published.length}`,createdAt:new Date().toISOString()});}};
 const makeManager=()=>{const manager=new SessionManager(codex,hub,store,()=>new Map());managers.push(manager);return manager;};
 return {id,file,turns,calls,published,makeManager,manager:makeManager(),command:{type:'turn.start',threadId:id,requestId:`edit-${id}`,text:'修改后的最后一条',replaceTurnId:'last'}};
}
try{
 const f=await fixture();assert((await readCodexConversationEvents(f.id,10)).some(e=>e.text==='旧的最后一条'));
 await Promise.all([f.manager.handleClientCommand(f.command),f.manager.handleClientCommand(f.command)]);
 await f.manager.handleClientCommand(f.command);
 assert.equal(f.calls.filter(c=>c.method==='thread/revert').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 const history=await readCodexConversationEvents(f.id,10);
 assert(history.some(e=>e.text==='保留上一条'));assert(!history.some(e=>e.text==='旧的最后一条'||e.text==='reply 旧的最后一条'));
 assert.equal(history.filter(e=>e.type==='user.message'&&e.text==='修改后的最后一条').length,1);
 assert(!store.eventsForThread(f.id).some(e=>e.text==='旧的最后一条'||e.text==='旧回复'));
 assert(f.calls.find(c=>c.method==='turn/start').params.input.some(input=>input.type==='localImage'));
 assert(f.calls.find(c=>c.method==='turn/start').params.input[0].text.includes('C:/isolated/doc.md'));
 console.log('PASS replacement drops old turn from backend, warm rollout cache and persisted live history; keeps prior turn and images; duplicate request runs once');

 const retry=await fixture('selected model at capacity');
 await assert.rejects(retry.manager.handleClientCommand(retry.command),/capacity/);
 const receipt=await retry.manager.receipts.get(retry.command.requestId);assert(receipt.retryAllowed);assert.equal(receipt.replacement.headTurnId,'prior');
 await retry.makeManager().handleClientCommand(retry.command);
 assert.equal(retry.calls.filter(c=>c.method==='thread/revert').length,1);
 assert.equal(retry.calls.filter(c=>c.method==='turn/start').length,2);
 assert(retry.calls.filter(c=>c.method==='turn/start')[1].params.input.some(input=>input.type==='localImage'));
 assert(retry.calls.filter(c=>c.method==='turn/start')[1].params.input[0].text.includes('C:/isolated/doc.md'));
 await assert.rejects(retry.makeManager().handleClientCommand({...retry.command,requestId:'stale-edit'}),/最后一条/);
 assert.equal(retry.calls.filter(c=>c.method==='thread/revert').length,1);
 console.log('PASS definite send failure can retry after manager restart without another rollback; stale edit cannot delete a newer turn');

 const uncertain=await fixture('turn/start timeout');
 await assert.rejects(uncertain.manager.handleClientCommand(uncertain.command),/timeout/);
 assert.equal((await uncertain.manager.receipts.get(uncertain.command.requestId)).state,'uncertain');
 await assert.rejects(uncertain.makeManager().handleClientCommand(uncertain.command),/timeout/);
 assert.equal(uncertain.calls.filter(c=>c.method==='thread/revert').length,1);
 assert.equal(uncertain.calls.filter(c=>c.method==='turn/start').length,1);
 console.log('PASS uncertain send is preserved and never replayed');
 const removed=await fixture();
 await removed.manager.handleClientCommand({...removed.command,images:[],files:[],keepAttachmentPaths:[]});
 const removedInput=removed.calls.find(call=>call.method==='turn/start').params.input;
 assert(!removedInput.some(item=>item.type==='localImage'));assert.equal(removedInput[0].text,removed.command.text);
 const kept=await fixture();
 const upload={id:'55555555-5555-4555-8555-555555555555',name:'new.txt',mime:'text/plain',size:3};
 const folder=path.join(home,'uploads','files',upload.id);await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(folder,'meta.json'),JSON.stringify(upload));await fs.writeFile(path.join(folder,'content'),'new');
 await kept.manager.handleClientCommand({...kept.command,images:[],files:[upload],keepAttachmentPaths:['C:/isolated/doc.md']});
 const keptInput=kept.calls.find(call=>call.method==='turn/start').params.input;
 assert(!keptInput.some(item=>item.type==='localImage'));assert(keptInput[0].text.includes('C:/isolated/doc.md'));assert(keptInput[0].text.includes('new.txt'));
 assert.equal(keptInput[0].text.match(/# Files mentioned by the user:/g).length,1);
 console.log('PASS explicit attachment edits remove originals and merge retained documents with new uploads in one envelope');
}finally{
 for(const manager of managers){manager.closeCapacityRetries();manager.receipts.close();}
 store.close();
 if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
 if(previousCodex===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousCodex;
 await fs.rm(home,{recursive:true,force:true});
}
