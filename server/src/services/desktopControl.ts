import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {BlockList,createConnection,createServer,isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage} from 'node:http';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type WebSocket from 'ws';

const networks=new BlockList();
for(const [address,prefix] of [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['169.254.0.0',16],['127.0.0.0',8]] as const)networks.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['fc00::',7],['fe80::',10],['::1',128]] as const)networks.addSubnet(address,prefix,'ipv6');
export function isLocalDesktopSocket(request:IncomingMessage){
  if(request.headers['x-public-proxy-secret']||request.headers['x-forwarded-for']||request.headers.forwarded)return false;
  let address=(request.socket.remoteAddress||'').split('%')[0]!;
  if(address.toLowerCase().startsWith('::ffff:')&&isIP(address.slice(7))===4)address=address.slice(7);
  const version=isIP(address);
  if(version===0||!networks.check(address,version===4?'ipv4':'ipv6'))return false;
  const loopback=address==='::1'||(version===4&&address.startsWith('127.'));
  return loopback||('encrypted' in request.socket&&request.socket.encrypted===true);
}
type Session={id:string;password:string;port:number;owner:string;peer:string;child:ChildProcess;timer:NodeJS.Timeout;used:boolean};
export class DesktopControl {
  private sessions=new Map<string,Session>();
  private creating=0;
  private closing=false;
  private remove(session:Session){
    if(this.sessions.get(session.id)!==session)return;
    this.sessions.delete(session.id);clearTimeout(session.timer);session.child.kill();
  }
  async create(owner:string,peer:string,scale:50|75|100=100){
    if(process.platform!=='win32')throw Error('远程桌面目前支持 Windows');
    if(this.closing||this.sessions.size+this.creating>=2)throw Error('远程桌面正在使用');
    this.creating++;
    try{
    const reserve=createServer();
    const port=await new Promise<number>((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',()=>resolve((reserve.address() as {port:number}).port));});
    await new Promise<void>(resolve=>reserve.close(()=>resolve()));
    if(this.closing)throw Error('远程桌面服务已关闭');
    const password=randomBytes(6).toString('base64url');
    const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase().startsWith('VNC_'))delete env[key];
    Object.assign(env,{VNC_BIND:`127.0.0.1:${port}`,VNC_PASSWORD:password,VNC_TLS:'off',VNC_STATE:'off',VNC_SCALE:String(scale)});
    const child=spawn(fileURLToPath(new URL('./vncfree-server.exe',import.meta.url)),[],{windowsHide:true,env,stdio:'ignore'});
    const session:Session={id:randomUUID(),password,port,owner,peer,child,used:false,timer:setTimeout(()=>{},1)};
    clearTimeout(session.timer);session.timer=setTimeout(()=>this.remove(session),30000);session.timer.unref();this.sessions.set(session.id,session);
    let failed:Error|undefined;child.once('error',error=>{failed=error;this.remove(session)});child.once('exit',()=>this.remove(session));
    try{
      const deadline=Date.now()+6000;
      while(Date.now()<deadline){
        if(failed||!this.sessions.has(session.id))throw Error('远程桌面服务无法启动');
        const ready=await new Promise<boolean>(resolve=>{const probe=createConnection({host:'127.0.0.1',port});probe.once('connect',()=>{probe.destroy();resolve(true)});probe.once('error',()=>resolve(false));});
        if(ready)return {id:session.id,password};
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error('远程桌面服务启动超时');
    }catch(error){this.remove(session);throw error;}
    }finally{this.creating--;}
  }
  attach(id:string,owner:string,peer:string,ws:WebSocket,authorized:()=>boolean){
    const session=this.sessions.get(id);
    if(!session||session.used||session.owner!==owner||session.peer!==peer){ws.close(1008,'invalid_session');return;}
    session.used=true;clearTimeout(session.timer);
    const tcp=createConnection({host:'127.0.0.1',port:session.port});
    const audit=setInterval(()=>{if(!authorized())close()},3000);audit.unref();
    const close=()=>{clearInterval(audit);tcp.destroy();if(ws.readyState<2)ws.close();this.remove(session)};
    tcp.on('data',data=>{if(ws.readyState!==1)return close();if(ws.bufferedAmount>8*1024*1024)return close();ws.send(data,{binary:true},error=>{if(error)close()});});
    tcp.on('error',close);tcp.on('close',close);
    ws.on('message',(data,binary)=>{if(!binary||!authorized()||!this.sessions.has(session.id))return close();const bytes=Array.isArray(data)?Buffer.concat(data):Buffer.isBuffer(data)?data:Buffer.from(data);if(!tcp.write(bytes))ws.pause();});
    tcp.on('drain',()=>ws.resume());ws.on('error',close);ws.on('close',close);
  }
  close(){this.closing=true;for(const session of [...this.sessions.values()])this.remove(session);}
}
export function registerDesktopControl(app:FastifyInstance,desktop:DesktopControl,token:(request:FastifyRequest)=>string){
  app.post('/api/desktop/session',async(request,reply)=>{
    if(!isLocalDesktopSocket(request.raw))return reply.code(403).send({error:'远程桌面仅支持内网连接'});
    const raw=(request.query as {scale?:string}).scale;
    if(raw!==undefined&&!['50','75','100'].includes(raw))return reply.code(400).send({error:'无效的传输分辨率'});
    const scale=raw===undefined?100:Number(raw) as 50|75|100;
    return reply.header('Cache-Control','no-store').send(await desktop.create(token(request),request.raw.socket.remoteAddress||'',scale));
  });
  app.addHook('onClose',async()=>desktop.close());
}
