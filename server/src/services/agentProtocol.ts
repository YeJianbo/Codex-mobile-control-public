export type Agent = 'codex'|'claude'|'antigravity'|'grok'|'deepseek'|'hermes'|'opencode'|'zcode'|'pi'|'acp';
export const agentNames:Record<Agent,string>={codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build',deepseek:'DeepSeek Harness',hermes:'Hermes',opencode:'OpenCode',zcode:'ZCode',pi:'Pi',acp:'自定义 ACP'};
export function modelAgent(model=''):Agent { const prefix=model.split('::')[0];return Object.hasOwn(agentNames,prefix)&&prefix!=='codex'?prefix as Agent:'codex'; }
export function threadAgent(id=''):Agent {const prefix=id.split('-')[0];return Object.hasOwn(agentNames,prefix)&&prefix!=='codex'?prefix as Agent:'codex';}
let publicAgentAccess:Partial<Record<Agent,boolean>>={};
export function configurePublicAgentAccess(access:Partial<Record<Agent,boolean>>={}){publicAgentAccess={...access};}
export function publicAgentAllowed(agent:Agent){return publicAgentAccess[agent]!==false;}
import {editedFilePaths,claudeFileChange} from './agentFileChanges.js';
export type AgentUpdate={kind:'text'|'tool'|'output'|'complete'|'session'|'result'|'plan'|'retry';id?:string;text?:string;name?:string;error?:boolean;usage?:any;files?:string[];diff?:string};
// Only public response text and tool records cross this boundary. Raw reasoning is not rendered.
// AGY tool ids are snake_case verbs; give the mobile timeline readable titles (Codex parity).
const agyToolLabels:Record<string,string>={
  write_to_file:'写入文件',replace_file_content:'修改文件',multi_replace_file_content:'批量修改文件',
  run_command:'运行命令',sed_file:'编辑文件',grep_search:'搜索代码',list_dir:'列出目录',
  view_file:'查看文件',read_url_content:'读取网页',search_web:'搜索网页',open_browser_url:'打开网页',
  execute_browser_javascript:'执行浏览器脚本',capture_browser_screenshot:'浏览器截图',
  generate_image:'生成图片',notebook_edit:'编辑笔记本',manage_task:'管理任务',
  invoke_subagent:'调用子代理',call_mcp_tool:'调用 MCP 工具',ask_question:'向你提问',
  ask_permission:'请求权限',ask_custom_permission:'请求权限',finish:'收尾',
};
function agyToolLabel(name:string):string{
  if(agyToolLabels[name])return agyToolLabels[name];
  if(name.startsWith('browser_'))return '浏览器操作';
  if(name.endsWith('_subagent')||name==='define_subagent')return '子代理';
  return name;
}
function recordText(value:unknown):string|undefined {
  if(value==null)return undefined;
  return typeof value==='string'?value:JSON.stringify(value);
}
export function agentUpdates(agent:Agent,line:any):AgentUpdate[]{
  if(agent==='antigravity'){
    if(line.event==='init')return [{kind:'session',id:line.conversation_id}];
    const s=line.step_update;
    if(s?.step_type==='agent_response'&&s.text_delta)return [{kind:'text',id:String(s.step_index),text:s.text_delta}];
    if(s?.step_type==='tool')return [{kind:'tool',id:String(s.step_index),name:agyToolLabel(String(s.tool_name||'')),text:JSON.stringify(s.tool_info?.parameters||{}),files:editedFilePaths(s.tool_name,s.tool_info?.parameters)},...(s.tool_info?.output!=null?[{kind:'output' as const,id:String(s.step_index),text:recordText(s.tool_info.output)}]:[]),...(['DONE','ERROR','FAILED'].includes(s.state)?[{kind:'complete' as const,id:String(s.step_index),error:s.state!=='DONE'||!!s.tool_info?.error}]:[])];
    if(line.event==='result'){const r=line.result||{};const failed=r.status!=='SUCCESS';return [{kind:'session',id:r.conversation_id},{kind:'result',text:recordText(failed?(r.error||r.response||'Antigravity 返回无效结果'):r.response),error:failed,usage:r.usage}];}
    return [];
  }
  const out:AgentUpdate[]=[];
  if(line.type==='system'&&line.subtype==='api_retry')out.push({kind:'retry',text:line.message||agentNames[agent]+' 服务请求未成功，正在重试'+(Number.isInteger(line.attempt)&&line.attempt>0?`（第 ${line.attempt} 次）`:'')});
  if(line.type==='tool_output'&&line.id)out.push({kind:'output',id:line.id,text:line.text});
  if(line.type==='plan'&&Array.isArray(line.entries))out.push({kind:'plan',text:line.entries.filter((entry:any)=>typeof entry.content==='string').map((entry:any)=>`${entry.status==='completed'?'✓':entry.status==='in_progress'?'进行中':'待开始'} ${entry.content}`).join('\n')});
  if(line.session_id)out.push({kind:'session',id:line.session_id});
  if(line.type==='assistant')for(const block of line.message?.content||[]){
    if(block.type==='text')out.push({kind:'text',id:line.message.id,text:block.text});
    if(block.type==='tool_use')out.push({kind:'tool',id:block.id,name:block.name,text:JSON.stringify(block.input||{}),files:editedFilePaths(block.name,block.input)});
  }
  if(line.type==='user')for(const block of line.message?.content||[])if(block.type==='tool_result'){
    out.push({kind:'output',id:block.tool_use_id,text:typeof block.content==='string'?block.content:JSON.stringify(block.content)});
    out.push({kind:'complete',id:block.tool_use_id,error:!!block.is_error,...(block.file_change||claudeFileChange(line.tool_use_result))});
  }
  if(line.type==='result')out.push({kind:'result',text:line.result||line.errors?.join('\n'),error:!!line.is_error,usage:line.usage});
  return out;
}
