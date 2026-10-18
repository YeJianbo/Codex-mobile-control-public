import {WebSocketServer,WebSocket} from 'ws';
import {randomUUID} from 'node:crypto';

export function attachResponsesWebSocket(server,{authorize,request,onRequest,onFinish}){
  const sockets=new WebSocketServer({noServer:true,maxPayload:64*1024*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const status=authorize(req);
    if(status!==200){socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);return;}
    sockets.handleUpgrade(req,socket,head,peer=>sockets.emit('connection',peer,req));
  });
  sockets.on('connection',(peer,req)=>{
    const cache=new Map(),lanes=new Map(),controllers=new Set();
    let cacheBytes=0,queued=0;
    const send=event=>new Promise((resolve,reject)=>{
      if(peer.readyState!==WebSocket.OPEN){reject(Error('Client closed'));return;}
      peer.send(JSON.stringify(event),error=>error?reject(error):resolve());
    });
    const remember=(id,input)=>{
      const bytes=Buffer.byteLength(JSON.stringify(input));
      if(bytes>64*1024*1024)return;
      while(cache.size&&(cache.size>=8||cacheBytes+bytes>64*1024*1024)){
        const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);
      }
      cache.set(id,{input,bytes});cacheBytes+=bytes;
    };
    const errorEvent=(message,code='local_stream_error',streamId,status)=>({type:'error',...(streamId?{stream_id:streamId}:{}),...(status?{status}:{}),error:{type:'server_error',code,message}});
    async function run(message){
      const started=performance.now(),streamId=message.stream_id;
      let controller,status=0,model,errorCode;
      try{
        if(message.type!=='response.create')throw Error('Only response.create is supported');
        const {type,stream_id,generate,...body}=message;
        model=body.model;
        if(body.previous_response_id){
          const previous=cache.get(body.previous_response_id);
          if(!previous){await send(errorEvent('Response is not cached on this connection','previous_response_not_found',streamId,400));return;}
          body.input=[...previous.input,...(Array.isArray(body.input)?body.input:body.input?[{type:'message',role:'user',content:body.input}]:[])];
          delete body.previous_response_id;
        }
        if(generate===false){
          const response={id:'resp_local_'+randomUUID().replaceAll('-',''),object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model,output:[]};
          remember(response.id,Array.isArray(body.input)?body.input:[]);
          await send({type:'response.created',response,...(streamId?{stream_id:streamId}:{})});
          await send({type:'response.completed',response,...(streamId?{stream_id:streamId}:{})});return;
        }
        body.stream=true;
        controller=new AbortController();controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(Error('Upstream timeout')),300000);
        onRequest?.(model);
        try{
          const response=await request(body,controller.signal,req.headers);
          status=response.status;
          if(!response.ok){
            let failure;try{failure=await response.json();}catch{failure={};}
            errorCode=failure.error?.code||'upstream_http_error';
            await send(errorEvent(failure.error?.message||`Upstream HTTP ${status}`,errorCode,streamId,status));return;
          }
          if(!response.body)throw Error('Upstream response has no stream');
          const decoder=new TextDecoder();let buffer='',terminal=false;
          const completedItems=new Map();
          for await(const chunk of response.body){
            buffer+=decoder.decode(chunk,{stream:true});
            if(Buffer.byteLength(buffer)>64*1024*1024)throw Error('Upstream event exceeds limit');
            let delimiter;
            while((delimiter=/\r?\n\r?\n/.exec(buffer))){
              const block=buffer.slice(0,delimiter.index);buffer=buffer.slice(delimiter.index+delimiter[0].length);
              const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
              if(!data||data==='[DONE]')continue;
              const event=JSON.parse(data);
              if(streamId)event.stream_id=streamId;
              // Codex can emit the complete items only in output_item.done and
              // leave response.completed.output empty. Keep those items for replay.
              if(event.type==='response.output_item.done'&&event.item){
                completedItems.set(event.output_index??event.item.id??completedItems.size,event.item);
              }
              if(event.type==='response.completed'){
                const input=Array.isArray(body.input)?body.input:body.input?[{type:'message',role:'user',content:body.input}]:[];
                const output=[...completedItems.entries()].sort(([a],[b])=>typeof a==='number'&&typeof b==='number'?a-b:0).map(([,item])=>item);
                for(const item of event.response.output||[]){
                  const index=output.findIndex(existing=>(item.id&&existing.id===item.id)||(item.call_id&&existing.call_id===item.call_id&&existing.type===item.type));
                  if(index<0)output.push(item);else output[index]=item;
                }
                remember(event.response.id,[...input,...output]);
                terminal=true;
              }
              if(['response.failed','response.incomplete','error'].includes(event.type)){terminal=true;errorCode=event.error?.code||event.response?.error?.code||event.type;}
              await send(event);
              if(terminal)break;
            }
            if(terminal)break;
          }
          if(!terminal)throw Error('Upstream stream ended before completion');
        }catch(error){errorCode||='local_stream_error';throw error;}
        finally{clearTimeout(timer);controller.abort();controllers.delete(controller);onFinish?.({model,status,errorCode,durationMs:performance.now()-started});}
      }catch(error){
        if(peer.readyState===WebSocket.OPEN)await send(errorEvent(error.message,'local_stream_error',streamId)).catch(()=>{});
      }
    }
    peer.on('message',data=>{
      let message;try{message=JSON.parse(data.toString());}catch{void send(errorEvent('Invalid JSON','invalid_request')).catch(()=>{});return;}
      if(++queued>32){queued--;void send(errorEvent('Too many queued requests','rate_limit_exceeded')).catch(()=>{});return;}
      const lane=message.stream_id||'';
      const previous=lanes.get(lane)||Promise.resolve();
      const task=previous.then(()=>run(message)).finally(()=>{queued--;if(lanes.get(lane)===task)lanes.delete(lane);});lanes.set(lane,task);
    });
    peer.on('error',()=>{});
    peer.on('close',()=>{for(const controller of controllers)controller.abort(Error('Client closed'));cache.clear();});
  });
  server.on('close',()=>{for(const peer of sockets.clients)peer.terminate();sockets.close();});
  return sockets;
}
