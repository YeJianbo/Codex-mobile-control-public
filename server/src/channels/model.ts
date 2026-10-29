import type {ClientCommand} from '../services/sessionManager.js';
import {threadAgent} from '../services/agentProtocol.js';
import type {ChannelTaskPort} from './types.js';

export function channelDefaultModel(models:ReadonlyArray<{model:string}>){
  const available=new Set(models.map(model=>model.model));
  const selected=['gpt-6.1-sol','gpt-6-sol'].find(model=>available.has(model))||models.find(model=>/^gpt-[\d.]+-sol$/.test(model.model))?.model;
  if(!selected)throw Error('当前没有可用的 Sol 模型，请刷新模型目录');
  return selected;
}

export function channelAssistantModel<T extends {model:string;defaultReasoningEffort?:string}>(models:ReadonlyArray<T>):T{
  const selected=models.find(model=>model.model==='antigravity::gemini-3.8-flash');
  if(!selected)throw Error('AGY 当前没有可用的 Gemini 3.8 Flash，请检查 AGY 登录与模型目录');
  return selected;
}
export function channelAssistantCommand(input:Parameters<ChannelTaskPort['submit']>[0],model:{model:string;defaultReasoningEffort?:string}):ClientCommand {
  if(model.model!=='antigravity::gemini-3.8-flash')throw Error('小助理使用 AGY Gemini 3.8 Flash');
  if(input.threadId&&threadAgent(input.threadId)!=='antigravity')throw Error('请为 AGY 助理创建新会话');
  const fields={requestId:input.requestId,projectPath:input.projectPath,model:model.model,effort:model.defaultReasoningEffort,permission:'auto' as const};
  // Use the existing AGY CLI adapter in accept-edits mode; do not enable permission bypass.
  return input.threadId?{type:'turn.start',...fields,threadId:input.threadId,text:input.text}:{type:'thread.start',...fields,initialText:input.text};
}
