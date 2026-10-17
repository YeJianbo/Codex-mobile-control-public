import {execa} from 'execa';
import type {PickerModel} from './modelCatalog.js';
import {agentNames} from './agentProtocol.js';

// Both CLIs support a control handshake without creating a session or sending a prompt.
export async function readAgentCatalog(agent:'claude'|'grok',command:string,run:typeof execa=execa){
  const args=agent==='claude'?['-p','--input-format','stream-json','--output-format','stream-json','--verbose']:['agent','--no-leader','stdio'];
  const request=agent==='claude'?{type:'control_request',request_id:'catalog',request:{subtype:'initialize'}}:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}};
  const result=await run(command,args,{input:JSON.stringify(request)+'\n',timeout:12000,windowsHide:true,reject:false});
  const records=result.stdout.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const payload=agent==='claude'?records.find(r=>r.type==='control_response'&&r.response?.request_id==='catalog')?.response?.response:records.find(r=>r.id===1)?.result;
  const entries=agent==='claude'?payload?.models:payload?._meta?.modelState?.availableModels;
  const models:PickerModel[]=[];
  for(const entry of Array.isArray(entries)?entries:[]){
    const id=agent==='claude'?entry.value:entry.modelId;if(typeof id!=='string'||!id)continue;
    const levels=agent==='claude'?entry.supportedEffortLevels:entry._meta?.reasoningEfforts?.map((e:any)=>e.id??e.value);
    const supportedReasoningEfforts=(Array.isArray(levels)?levels:[]).filter((v:unknown)=>typeof v==='string').map((reasoningEffort:string)=>({reasoningEffort}));
    // Aliases and user supplied display names may point at a different provider.
    const name=agent==='claude'?(id==='default'?'默认模型':`${id} · ${entry.resolvedModel||entry.displayName||id}`):(entry.name===id?id:`${entry.name||id} · ${id}`);
    models.push({model:`${agent}::${id}`,displayName:`${agentNames[agent]} · ${name}`,supportedReasoningEfforts,...(agent==='grok'&&entry._meta?.reasoningEffort?{defaultReasoningEffort:entry._meta.reasoningEffort}:{})});
  }
  if(agent==='grok'&&models.length){
    const current=models.find(m=>m.model===`grok::${payload?._meta?.modelState?.currentModelId}`);
    models.unshift({model:'grok::default',displayName:'Grok Build · 默认模型',supportedReasoningEfforts:current?.supportedReasoningEfforts||[],defaultReasoningEffort:current?.defaultReasoningEffort});
  }
  return {models,supportsImages:agent==='grok'?payload?.agentCapabilities?.promptCapabilities?.image:undefined};
}
