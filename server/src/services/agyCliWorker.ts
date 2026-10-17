import {spawn} from 'node:child_process';
import {execa} from 'execa';

// The IPC channel closes when the gateway exits, including a Windows forced stop.
// Own and terminate only this worker's AGY tree so idle CLI processes cannot become orphans.
const [command,...args]=process.argv.slice(2);
if(!command)throw Error('Missing AGY executable');
const child=execa(command,args,{cwd:process.cwd(),windowsHide:true,reject:false,buffer:false,stdin:'pipe'});
void child.catch(()=>{});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on('error',()=>{});
let stopping=false;
function stop(){
  if(stopping)return;stopping=true;
  if(child.exitCode!==null||!child.pid)return;
  if(process.platform==='win32'){
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  }else child.kill('SIGTERM');
}
process.on('disconnect',stop);
process.stdout.on('error',stop);
process.stderr.on('error',stop);
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
child.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;process.stdin.unpipe(child.stdin);process.stdin.destroy();if(process.connected)process.disconnect();});
child.on('close',(code,signal)=>{process.exitCode=code??(signal?1:0);process.stdin.unpipe(child.stdin);process.stdin.destroy();if(process.connected)process.disconnect();});
