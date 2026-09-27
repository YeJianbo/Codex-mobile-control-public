export type Agent = 'codex'|'claude'|'antigravity'|'grok';
export const agentNames:Record<Agent,string>={codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build'};
export function modelAgent(model=''):Agent { const prefix=model.split('::')[0];return Object.hasOwn(agentNames,prefix)&&prefix!=='codex'?prefix as Agent:'codex'; }
export function threadAgent(id=''):Agent {const prefix=id.split('-')[0];return Object.hasOwn(agentNames,prefix)&&prefix!=='codex'?prefix as Agent:'codex';}
export type AgentUpdate={kind:'text'|'tool'|'output'|'complete'|'session'|'result';id?:string;text?:string;name?:string;error?:boolean;usage?:any};
// Only public response text and tool records cross this boundary. Raw reasoning is not rendered.
export function agentUpdates(agent:Agent,line:any):AgentUpdate[]{
  if(agent==='antigravity'){
    if(line.event==='init')return [{kind:'session',id:line.conversation_id}];
    const s=line.step_update;
    if(s?.step_type==='agent_response'&&s.text_delta)return [{kind:'text',id:String(s.step_index),text:s.text_delta}];
    if(s?.step_type==='tool')return [{kind:'tool',id:String(s.step_index),name:s.tool_name,text:JSON.stringify(s.tool_info?.parameters||{})},...(s.tool_info?.output?[{kind:'output' as const,id:String(s.step_index),text:String(s.tool_info.output)}]:[]),...(s.state==='DONE'?[{kind:'complete' as const,id:String(s.step_index),error:!!s.tool_info?.error}]:[])];
    if(line.event==='result'){const r=line.result;return [{kind:'session',id:r.conversation_id},{kind:'result',text:r.response||r.error,error:r.status!=='SUCCESS',usage:r.usage}];}
    return [];
  }
  const out:AgentUpdate[]=[];
  if(line.session_id)out.push({kind:'session',id:line.session_id});
  if(line.type==='assistant')for(const block of line.message?.content||[]){
    if(block.type==='text')out.push({kind:'text',id:line.message.id,text:block.text});
    if(block.type==='tool_use')out.push({kind:'tool',id:block.id,name:block.name,text:JSON.stringify(block.input||{})});
  }
  if(line.type==='user')for(const block of line.message?.content||[])if(block.type==='tool_result'){
    out.push({kind:'output',id:block.tool_use_id,text:typeof block.content==='string'?block.content:JSON.stringify(block.content)});
    out.push({kind:'complete',id:block.tool_use_id,error:!!block.is_error});
  }
  if(line.type==='result')out.push({kind:'result',text:line.result||line.errors?.join('\n'),error:!!line.is_error,usage:line.usage});
  return out;
}
