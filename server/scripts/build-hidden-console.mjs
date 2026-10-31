import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(process.platform==='win32'){
  const root=path.dirname(fileURLToPath(import.meta.url));
  const windows=process.env.SystemRoot||'C:\\Windows';
  const compiler=['Framework64','Framework'].map(folder=>path.join(windows,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  if(!compiler)throw Error('无法构建 AGY 隐藏控制台启动器：未找到 .NET Framework C# 编译器');
  const output=path.resolve(root,'../dist/services/hidden-console-launcher.exe');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const result=spawnSync(compiler,['/nologo','/target:exe','/out:'+output,path.join(root,'hidden-console-launcher.cs')],{encoding:'utf8',windowsHide:true});
  if(result.error||result.status!==0)throw Error('AGY 启动器编译失败：'+(result.stderr||result.stdout||result.error?.message));
  fs.copyFileSync(path.resolve(root,'../vendor/vncfree/vncfree-server.exe'),path.resolve(root,'../dist/services/vncfree-server.exe'));
  fs.copyFileSync(path.resolve(root,'../../components/vncfree/LICENSE'),path.resolve(root,'../dist/services/vncfree-LICENSE.txt'));
}
