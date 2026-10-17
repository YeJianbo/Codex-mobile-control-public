import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import readline from 'node:readline';
import {resolveDesktopCli} from './desktop-cli-resolver.mjs';
import {ensureSharedBackend} from './shared-backend.mjs';

const [configPath,...args]=process.argv.slice(2);
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
const commandIndex=args.indexOf('app-server');
const subcommands=new Set(['daemon','proxy','generate-ts','generate-json-schema','help']);
if(commandIndex<0||subcommands.has(args[commandIndex+1])||args.includes('--help')||args.includes('-h')) {
  const realCli=await resolveDesktopCli(config.realCli);
  const child=spawn(realCli,args,{stdio:'inherit',windowsHide:true,env:{...process.env,CODEX_CLI_PATH:realCli,PATH:path.dirname(realCli)+path.delimiter+(process.env.PATH||'')}});
  child.once('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
} else {
  // Desktop is a client. Closing its stdin must never terminate the shared engine.
  const directory=path.dirname(configPath);
  await fs.writeFile(path.join(directory,'startup-args.json'),JSON.stringify(args),{mode:0o600});
  const endpoint=await ensureSharedBackend(configPath);
  const WebSocket=createRequire(path.join(config.gatewayRoot,'package.json'))('ws');
  const socket=new WebSocket(endpoint.desktopUrl||endpoint.url,{headers:{Authorization:`Bearer ${endpoint.token}`},handshakeTimeout:5000});
  socket.on('error',()=>{});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);socket.once('close',()=>reject(Error('shared backend disconnected')));});
  const reader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  reader.on('line',line=>{if(socket.readyState===WebSocket.OPEN)socket.send(line);});
  socket.on('message',data=>process.stdout.write(data.toString()+'\n'));
  let expectedClose=false;
  process.stdin.once('end',()=>{expectedClose=true;reader.close();socket.close();});
  socket.once('close',()=>{reader.close();process.exit(expectedClose?0:1);});
}
