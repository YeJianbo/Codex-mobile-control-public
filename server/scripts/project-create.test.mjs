import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('create a project directory without replacing existing directories',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-project-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  try{
    process.env.CODEX_MOBILE_CONTROL_HOME=home;
    const {addProject}=await import('../src/services/projects.ts');
    const config={host:'127.0.0.1',port:38457,token:'test',projectRoots:[]};
    const directory=path.join(home,'new-project');
    const project=await addProject(config,directory,true);
    assert.equal(project.name,'new-project');assert.equal(project.trusted,true);
    assert((await fs.stat(directory)).isDirectory());
    await fs.writeFile(path.join(directory,'keep.txt'),'keep');
    await assert.rejects(addProject(config,directory,true));
    assert.equal(await fs.readFile(path.join(directory,'keep.txt'),'utf8'),'keep');
    await assert.rejects(addProject(config,'relative-project',true));
    await assert.rejects(addProject(config,path.join(home,'missing-parent','child'),true));
  }finally{
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});
