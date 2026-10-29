type ToolState={name:string;input:unknown;signature?:string;output:string;completed:boolean};

export function zcodeToolText(value:any):string {
  if(value==null)return '';
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(zcodeToolText).filter(Boolean).join('\n');
  if(typeof value.text==='string')return value.text;
  if(value.content!=null)return zcodeToolText(value.content);
  if(value.output!=null)return zcodeToolText(value.output);
  if(value.error!=null)return zcodeToolText(value.error);
  if(typeof value.message==='string')return value.message;
  return JSON.stringify(value);
}

/** ZCode can send the input on the model stream and omit it from tool.updated. */
export function zcodeToolStream(write:(record:any)=>void){
  const tools=new Map<string,ToolState>();
  function tool(id:string,name?:string,input?:unknown){
    let state=tools.get(id);
    if(!state){state={name:name||'执行工具',input:input??{},output:'',completed:false};tools.set(id,state);}
    if(name)state.name=name;
    if(input!==undefined)state.input=input;
    const signature=JSON.stringify([state.name,state.input]);
    if(signature!==state.signature&&!state.completed){
      state.signature=signature;
      write({type:'assistant',message:{content:[{type:'tool_use',id,name:state.name,input:state.input}]}});
    }
    return state;
  }
  function output(id:string,state:ToolState,text:string){
    if(!text||state.output===text||state.output.endsWith(text))return;
    let delta=text;
    if(text.startsWith(state.output))delta=text.slice(state.output.length);
    else for(let size=Math.min(state.output.length,text.length,4096);size>0;size--)if(state.output.endsWith(text.slice(0,size))){delta=text.slice(size);break;}
    if(delta){state.output+=delta;write({type:'tool_output',id,text:delta});}
  }
  function complete(id:string,state:ToolState,value:any,failed=false){
    if(state.completed)return;
    output(id,state,zcodeToolText(value));state.completed=true;
    write({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:'',is_error:failed||value?.success===false||!!value?.error}]}});
  }
  return (type:string,payload:any)=>{
    const id=payload.toolCallId;
    if(type==='model.streaming'&&id&&(payload.kind==='tool_input_start'||payload.kind==='tool_call'))tool(id,payload.toolName||payload.name,payload.input);
    if(type==='tool.updated'&&id){
      const state=tool(id,payload.toolName,payload.input);
      if(payload.kind==='progress')output(id,state,zcodeToolText(payload.outputPreview??payload.stdoutTail??payload.stderrTail));
      if(payload.kind==='result'||payload.kind==='error')complete(id,state,payload.kind==='error'?payload.error:payload.result,payload.kind==='error');
    }
    if(type==='part.upserted'||type==='part.started'){
      const part=payload.part;
      if(part?.type!=='tool')return;
      const id=part.callID||part.toolCallId||part.id;if(!id)return;
      const state=tool(id,part.tool,part.state?.input);
      if(part.state?.output)output(id,state,zcodeToolText(part.state.output));
      if(['completed','error'].includes(part.state?.status))complete(id,state,part.state.output||part.state.error,part.state.status==='error');
    }
  };
}
