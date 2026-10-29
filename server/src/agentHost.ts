import fs from 'node:fs';
import {AgentSessions} from './services/agentSessions.js';
import {AgentHostServer,randomHostToken} from './services/agentHostProtocol.js';
import {threadAgent} from './services/agentProtocol.js';
import {StateStore} from './services/stateStore.js';
import type {EventHub} from './services/eventHub.js';

const version=String((JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')) as {version?:string}).version||'');
const store=new StateStore();
await store.load();
let server:AgentHostServer;
const hub={publish(event:unknown){server.publish(event);}} as unknown as EventHub;
const agents=new AgentSessions(store,hub);
agents.onThreadCreated=async(requestId,threadId)=>{server.threadCreated(requestId,threadId);};
const running=()=>store.threads.filter(thread=>threadAgent(thread.id)!=='codex'&&agents.owns(thread.id)).map(thread=>thread.id);
const methods:Record<string,(params:unknown[])=>Promise<unknown>>={
  validate:async([model,id])=>{await agents.validate(model as string|undefined,id as string|undefined);},
  models:async([refresh])=>agents.models(refresh===true),
  backends:async([viaPublic])=>agents.backends(viaPublic===true),
  pickerCatalog:async([refresh,viaPublic])=>agents.pickerCatalog(refresh===true,viaPublic===true),
  officialModels:async([agent,refresh])=>agents.officialModels(agent as 'claude'|'antigravity',refresh===true),
  health:async([refresh,viaPublic])=>agents.health(refresh===true,viaPublic===true),
  usage:async([id,agent,model])=>agents.usage(id as string,agent as never,model as string|undefined),
  steer:async([id,text,images,files])=>agents.steer(id as string,text as string,images as never,files as never),
  settings:async([id])=>agents.settings(id as string),
  handle:async([command])=>{await agents.handle(command);},
  resume:async([id])=>{await agents.resume(id as string);},
  resolveApproval:async([id,decision])=>{await agents.resolveApproval(id as string,decision as 'accept'|'decline');},
  answerQuestions:async([id,answers])=>{await agents.answerQuestions(id as string,answers as never);},
  forget:async([id])=>{await agents.forget(id as string);},
};
server=new AgentHostServer(randomHostToken(),version,async(method,params)=>{
  const handler=methods[method];if(!handler)throw Error(`执行器不支持 ${method}`);
  return handler(params);
},running,()=>{});
try{
  // ZCode runtime state belongs to its native shared backend, including desktop turns.
  // A scoped host must not reset another host's persisted tasks during startup.
  for(const thread of store.threads.filter(item=>!process.env.CODEX_MOBILE_CONTROL_AGENT_HOST_SCOPE&&threadAgent(item.id)!=='codex'&&threadAgent(item.id)!=='zcode'&&item.status==='running')){
    await store.upsertThread({id:thread.id,status:'interrupted'});
    server.publish({type:'turn.completed',threadId:thread.id,status:'interrupted'});
  }
  await server.listen();
}catch(error){
  await agents.close().catch(()=>{});
  throw error;
}
let idleSince=Date.now();
setInterval(()=>{
  if(server.clients>0||running().length>0){idleSince=Date.now();return;}
  if(Date.now()-idleSince>(process.env.CODEX_MOBILE_CONTROL_AGENT_HOST_SCOPE?60000:30*60*1000))void shutdown(0);
},30000).unref();
let closing=false;
async function shutdown(code:number){
  if(closing)return;closing=true;
  await agents.close().catch(()=>{});
  server.close();
  process.exit(code);
}
process.on('SIGTERM',()=>void shutdown(0));
process.on('SIGINT',()=>void shutdown(0));
