import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

test('hidden launcher preserves arguments and terminates its process tree', {skip:process.platform!=='win32'},async()=>{
 const launcher=fileURLToPath(new URL('../dist/services/hidden-console-launcher.exe',import.meta.url));
 const program='console.log(JSON.stringify({pid:process.pid,args:process.argv.slice(1)}));setInterval(()=>{},1000)';
 const args=['space value','引号"和\\斜线','trailing\\'];
 const child=spawn(launcher,[process.execPath,'-e',program,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout});let pid,timer;
 try{
  const [line]=await Promise.race([once(lines,'line'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('launcher timeout')),10000);})]);clearTimeout(timer);
  const result=JSON.parse(line);pid=result.pid;assert.deepEqual(result.args,args);
  child.kill();await once(child,'close');
  const deadline=Date.now()+5000;let alive=true;
  while(Date.now()<deadline){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(alive,false,'launched child must not outlive the wrapper');
 }finally{clearTimeout(timer);lines.close();child.kill();}
});
