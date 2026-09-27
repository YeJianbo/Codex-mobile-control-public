import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentSessions} from '../src/services/agentSessions.ts';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-agent-check-'));
const records=[];const meta=new Map();const events=[];
const store={threads:records,readAgentMeta:id=>meta.get(id),writeAgentMeta:(id,value)=>meta.set(id,structuredClone(value)),async upsertThread(value){let t=records.find(t=>t.id===value.id);if(t)Object.assign(t,value);else records.push(t={...value});return t;}};
const agents=new AgentSessions(store,{publish:event=>events.push(event)});
const models=await agents.models();
const results=[];
for(const agent of process.argv.length>2?process.argv.slice(2):['claude','antigravity','grok']){
  let result={agent,installed:models.some(m=>m.model.startsWith(agent+'::')),completed:false};
  try{
    await agents.handle({type:'thread.start',model:process.env.CMC_CHECK_MODEL||agent+'::default',effort:process.env.CMC_CHECK_EFFORT,projectPath:directory,permission:'ask',initialText:'Reply with exactly CONNECTED. Do not use tools or access files.'});
    const id=records.at(-1).id;
    const deadline=Date.now()+90000;
    while(agents.owns(id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,300));
    if(agents.owns(id)){await agents.handle({type:'turn.interrupt',threadId:id});result.error='Timed out after 90 seconds';}
    else{result.completed=records.at(-1).status==='completed';result.hasResponse=events.some(e=>e.threadId===id&&e.type==='message.delta');result.resumable=!!meta.get(id)?.session;result.error=events.find(e=>e.threadId===id&&e.type==='error')?.message?.slice(0,600);}
    if(result.completed&&result.resumable){
      const original=meta.get(id).session,start=events.length;
      await agents.handle({type:'turn.start',threadId:id,model:process.env.CMC_CHECK_MODEL||agent+'::default',effort:process.env.CMC_CHECK_EFFORT,projectPath:directory,permission:'ask',text:'What exact word did you reply with in the previous message? Reply with that word only. Do not use tools.'});
      const deadline=Date.now()+90000;
      while(agents.owns(id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,300));
      if(agents.owns(id))await agents.handle({type:'turn.interrupt',threadId:id});
      result.sameSession=meta.get(id)?.session===original;
      result.continuity=events.slice(start).filter(e=>e.type==='message.delta').map(e=>e.text).join('').includes('CONNECTED');
    }
  }catch(error){result.error=error.message;}
  results.push(result);console.log(JSON.stringify(result));
}
const output=new URL('../../artifacts/agent-live-results.json',import.meta.url);
const previous=await fs.readFile(output,'utf8').then(JSON.parse).catch(()=>[]);
await fs.writeFile(output,JSON.stringify([...previous.filter(r=>!results.some(n=>n.agent===r.agent)),...results],null,2));
// Keep the tiny workspace available for the CLI's persistent session metadata.
