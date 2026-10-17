import {execa} from 'execa';
import type {PickerModel} from './modelCatalog.js';
import {agentNames} from './agentProtocol.js';

async function catalogHandshake(command:string,args:string[],request:unknown,agent:'claude'|'grok',run:typeof execa){
  const task=run(command,args,{input:JSON.stringify(request)+'\n',timeout:15000,windowsHide:true,reject:false});
  let output='',finished=false;
  void Promise.resolve(task).then(()=>{finished=true;},()=>{finished=true;});
  const stop=async()=>{
    if(finished)return;
    if(process.platform==='win32'&&task.pid)await execa('taskkill.exe',['/PID',String(task.pid),'/T','/F'],{windowsHide:true,reject:false,timeout:5000}).catch(()=>{});
    else task.kill?.();
  };
  // A stdio control server stays alive after initialize. Return its handshake
  // instead of waiting for EOF; on Windows, terminate the owned wrapper tree.
  let timer:ReturnType<typeof setTimeout>|undefined;
  const early=new Promise<{stdout:string}>(resolve=>{
    timer=setTimeout(()=>{void stop();resolve({stdout:output});},12000);
    task.stdout?.on?.('data',(chunk:Buffer)=>{
      output+=chunk.toString();
      for(const line of output.split(/\r?\n/)){
        try{const record=JSON.parse(line);if(agent==='claude'?record.type==='control_response'&&record.response?.request_id==='catalog':record.id===1){resolve({stdout:output});return;}}catch{}
      }
    });
  });
  try{return await Promise.race([task,early]);}
  finally{clearTimeout(timer);await stop();}
}

// Both CLIs support a control handshake without creating a session or sending a prompt.
export async function readAgentCatalog(agent:'claude'|'grok',command:string,run:typeof execa=execa){
  const args=agent==='claude'?['-p','--input-format','stream-json','--output-format','stream-json','--verbose']:['agent','--no-leader','stdio'];
  const request=agent==='claude'?{type:'control_request',request_id:'catalog',request:{subtype:'initialize'}}:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}};
  const result=await catalogHandshake(command,args,request,agent,run);
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
