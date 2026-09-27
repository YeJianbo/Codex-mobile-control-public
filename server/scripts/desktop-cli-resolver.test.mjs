import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {selectDesktopCli} from './desktop-cli-resolver.mjs';

test('Desktop update selects bundled CLI before its cache exists; incomplete and staging caches are ignored',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'codex-cli-resolution-'));
  const cache=path.join(root,'cache');
  async function install(name,complete=true){
    const directory=path.join(root,name);
    await fs.mkdir(directory,{recursive:true});
    for(const file of complete?['codex.exe','codex-code-mode-host.exe','codex-command-runner.exe','codex-windows-sandbox-setup.exe']:['codex.exe'])await fs.writeFile(path.join(directory,file),'fixture');
    return path.join(directory,'codex.exe');
  }
  try{
    const old=await install('cache/old');
    const bundled=await install('package/resources');
    await install('cache/new-but-incomplete',false);
    await install('cache/.staging-next');
    await fs.utimes(old,new Date(),new Date(Date.now()+100000));
    assert.equal(await selectDesktopCli([path.dirname(bundled)],cache,old),bundled);
    assert.equal(await selectDesktopCli([],cache),old);
    await fs.unlink(path.join(path.dirname(old),'codex-code-mode-host.exe'));
    await assert.rejects(selectDesktopCli([],cache,old),/No complete/);
    assert.equal(await selectDesktopCli([],path.join(root,'missing'),bundled),bundled);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
