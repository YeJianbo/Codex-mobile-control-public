import type {WebSocket} from 'ws';

export type EventDisconnectCause='peer_close'|'socket_error'|'heartbeat_timeout'|'unauthorized'|'not_open'|'backpressure';
type Disconnected=(client:WebSocket,cause:EventDisconnectCause,closeCode?:number,errorCode?:string)=>void;
export type EventPayload={text:string;bytes:number};

const maxBufferedBytes=8*1024*1024;
const closeGraceMs=1000;

export function encodeEventPayload(event:unknown):EventPayload {
  const text=JSON.stringify(event);
  return {text,bytes:Buffer.byteLength(text)};
}

/** Bound each socket's pending writes; committed history handles reconnection. */
export class EventSocketWriter {
  constructor(private readonly disconnected:Disconnected){}

  send(client:WebSocket,payload:EventPayload):void {
    if(client.readyState!==client.OPEN)return;
    // Allow one large frame on an empty socket so replaying that same frame
    // cannot cause a permanent reconnect loop. Never skip a frame and keep streaming.
    if(client.bufferedAmount>0&&client.bufferedAmount+payload.bytes>maxBufferedBytes){
      this.disconnected(client,'backpressure',1013);
      const timer=setTimeout(()=>client.terminate(),closeGraceMs);timer.unref();
      client.once('close',()=>clearTimeout(timer));
      try{client.close(1013,'Client is too slow; reconnect to restore history');}
      catch{clearTimeout(timer);client.terminate();}
      return;
    }
    try{
      client.send(payload.text,error=>{if(error)this.failed(client,error);});
    }catch(error){this.failed(client,error);}
  }

  private failed(client:WebSocket,error:unknown):void {
    const code=error&&typeof error==='object'&&'code' in error?error.code:undefined;
    this.disconnected(client,'socket_error',undefined,typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code)?code:undefined);
    client.terminate();
  }
}
