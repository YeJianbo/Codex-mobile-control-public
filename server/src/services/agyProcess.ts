import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// A hidden console is inherited by AGY's own child processes. CREATE_NO_WINDOW
// on AGY alone does not prevent those children from allocating visible consoles.
export function agyProcess(command:string,args:string[]){
  const launcher=fileURLToPath(new URL('./hidden-console-launcher.exe',import.meta.url));
  return process.platform==='win32'&&existsSync(launcher)&&/\.exe$/i.test(command)
    ?{command:launcher,args:[command,...args]}:{command,args};
}
