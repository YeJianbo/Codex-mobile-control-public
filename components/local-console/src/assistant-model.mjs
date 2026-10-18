// Responses protocol transport. Only completed responses may dispatch tools.
export async function assistantModel(requestModel,body,signal,onText=()=>{}){
  const response=await requestModel({...body,stream:true,store:false},signal);
  if(!response.ok)throw new Error(`模型请求失败（HTTP ${response.status}）`);
  let completed=null,emitted=false;
  const emit=text=>{if(text){emitted=true;onText(text);}};
  if(response.headers.get('content-type')?.includes('text/event-stream')){
    const decoder=new TextDecoder();let buffer='';
    const accept=frame=>{
      const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!data||data==='[DONE]')return;
      const event=JSON.parse(data);
      if(event.type==='response.output_text.delta')emit(event.delta||'');
      if(['error','response.failed','response.incomplete'].includes(event.type))throw new Error('模型响应失败或未完整结束，未执行未完成的工具调用');
      if(event.type==='response.completed')completed=event.response;
    };
    for await(const chunk of response.body){
      signal.throwIfAborted();buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');
      if(buffer.length>16*1024*1024)throw new Error('模型单条流事件过大');
      let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){accept(buffer.slice(0,boundary));buffer=buffer.slice(boundary+2);}
    }
    buffer+=decoder.decode();if(buffer.trim())accept(buffer);
  }else{
    const text=await response.text();if(text.length>16*1024*1024)throw new Error('模型响应过大');
    completed=JSON.parse(text);
  }
  signal.throwIfAborted();
  if(completed?.status!=='completed'||!Array.isArray(completed.output))throw new Error('模型流未确认完成，工具调用未执行');
  if(!emitted)for(const item of completed.output)for(const part of item.content||[])if(part.type==='output_text')emit(part.text||'');
  const calls=completed.output.filter(item=>item.type==='function_call'),ids=new Set();
  for(const call of calls){
    if(!call.call_id||ids.has(call.call_id)||typeof call.name!=='string'||typeof call.arguments!=='string'||call.status&&call.status!=='completed')throw new Error('模型工具调用不完整');
    JSON.parse(call.arguments);ids.add(call.call_id);
  }
  return {output:completed.output,calls};
}
