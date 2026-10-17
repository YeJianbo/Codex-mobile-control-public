import http from 'node:http';
import net from 'node:net';
import {Transform} from 'node:stream';

// Keep the TLS handshake bytes intact, but split its first record. Some proxy
// sniffers incorrectly replace the edge IP with the non-resolving Tunnel SNI.
// cloudflared still authenticates Cloudflare and encrypts the entire connection.
export function fragmentClientHello() {
  let pending=Buffer.alloc(0), complete=false;
  return new Transform({
    transform(chunk,_encoding,callback) {
      if(complete){callback(null,chunk);return;}
      pending=Buffer.concat([pending,chunk]);
      if(pending.length<5){callback();return;}
      const size=pending.readUInt16BE(3);
      if(pending[0]!==22||pending[1]!==3||size<17||size>18432){callback(new Error('Expected TLS ClientHello'));return;}
      if(pending.length<5+size){callback();return;}
      const first=Buffer.from(pending.subarray(0,5)),second=Buffer.from(first);
      first.writeUInt16BE(16,3);
      second.writeUInt16BE(size-16,3);
      this.push(Buffer.concat([first,pending.subarray(5,21),second,pending.subarray(21)]));
      pending=Buffer.alloc(0);complete=true;callback();
    },
    flush(callback){callback(complete?undefined:new Error('Incomplete TLS ClientHello'));},
  });
}

export function createTunnelRelay({proxyPort,edgeHost,connectTimeoutMs=10000}) {
  return net.createServer(client=>{
    client.pause();
    let remote;
    const request=http.request({hostname:'127.0.0.1',port:proxyPort,method:'CONNECT',path:`${edgeHost}:7844`,agent:false});
    const close=()=>{clearTimeout(timer);request.destroy();client.destroy();remote?.destroy();};
    const timer=setTimeout(close,connectTimeoutMs);
    client.on('error',close);
    client.on('close',close);
    request.on('error',close);
    request.on('connect',(response,socket,head)=>{
      remote=socket;
      if(response.statusCode!==200){close();return;}
      clearTimeout(timer);
      remote.on('error',close);
      remote.on('close',close);
      const fragmenter=fragmentClientHello();
      fragmenter.on('error',close);
      if(head.length)client.write(head);
      client.pipe(fragmenter).pipe(remote).pipe(client);
      client.resume();
    });
    request.end();
  });
}

export async function startTunnelRelays(settings) {
  if(!settings?.enabled)return [];
  const ports=settings.ports,proxyPort=settings.proxyPort;
  const validPort=p=>Number.isInteger(p)&&p>=1024&&p<=65535;
  if(!validPort(proxyPort)||!Array.isArray(ports)||ports.length!==2||!ports.every(validPort)||new Set([...ports,proxyPort]).size!==3)throw new Error('Invalid tunnel relay ports');
  const servers=[];
  try {
    for(let i=0;i<2;i++){
      const server=createTunnelRelay({proxyPort,edgeHost:`region${i+1}.v2.argotunnel.com`});
      servers.push(server);
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(ports[i],'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
      });
      server.on('error',error=>console.error(`Tunnel relay listener: ${error.code??error.message}`));
    }
    return servers;
  }catch(error){for(const server of servers)server.close();throw error;}
}
