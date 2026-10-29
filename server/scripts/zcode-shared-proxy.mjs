import {createInterface} from 'node:readline';
import {connectSharedZcode} from './zcode-shared-backend.mjs';

const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const role=value('--role'),configPath=value('--config');
if(!['desktop','gateway'].includes(role)||!configPath)throw Error('ZCode shared proxy configuration missing');
let socket;
try{
  socket=await connectSharedZcode(configPath);
  const attached=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('ZCode 共享后端附着超时')),10000);
    socket.on('message',data=>{
      let reply;try{reply=JSON.parse(data.toString());}catch{return reject(Error('ZCode 共享后端响应无效'));}
      if(reply.type==='attached'){clearTimeout(timeout);resolve(reply);return;}
      if(!process.stdout.write(data.toString()+'\n'))socket.pause();
    });
    socket.once('close',()=>{clearTimeout(timeout);reject(Error('ZCode 共享后端已关闭'));});
  });
  socket.send(JSON.stringify({type:'attach',role,cwd:process.cwd(),env:Object.fromEntries(Object.entries(process.env).filter(([name])=>name.startsWith('ZCODE_')))}));
  await attached;
  process.stdout.on('drain',()=>socket.resume());
  const input=createInterface({input:process.stdin});
  input.on('line',line=>{if(socket.readyState===1)socket.send(line);});
  const close=()=>{input.close();socket.close();};
  input.on('close',()=>socket.close());process.once('SIGTERM',close);process.once('SIGINT',close);
  socket.once('close',()=>{input.close();process.exit(process.exitCode||0);});
  socket.on('error',()=>{process.exitCode=1;close();});
}catch(error){socket?.terminate();process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
