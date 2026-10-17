import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {activityOutputImageText,localOutputPath,resolvePublicOutputImage,resolveThreadOutputFile,storedOutputMessage} from '../src/services/threadOutputFiles.ts';
import {pathToFileURL} from 'node:url';
import {permittedPublicRequest} from './public-routes.mjs';

test('image operations expose only real preview links from that operation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-operation-image-'));
  try{
    const file=path.join(root,'preview.png');await fs.writeFile(file,'fixture');
    const text=activityOutputImageText({type:'tool.started',title:'查看图片',detail:`![查看图片](<${file}>)`});
    assert(text);assert.equal((await resolveThreadOutputFile(text,file,root)).fileName,'preview.png');
    await assert.rejects(resolveThreadOutputFile(text,path.join(root,'other.png'),root),/不是这条/);
    assert.equal(activityOutputImageText({type:'tool.started',title:'运行命令',detail:`![查看图片](<${file}>)`}),null);
    assert.equal(activityOutputImageText({type:'tool.started',title:'查看图片',detail:`\`![查看图片](<${file}>)\``}),null);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('encoded hash and percent resolve the referenced file rather than its filename prefix',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-output-'));
  try{
    const name='chapter %20#draft.md',file=path.join(root,name),href=encodeURIComponent(name);
    await fs.writeFile(file,'requested file');await fs.writeFile(path.join(root,'chapter %20'),'unrelated prefix');
    const resolved=await resolveThreadOutputFile(`[文档](${href})`,href,root);
    assert.equal(resolved.absolutePath,await fs.realpath(file));assert.equal(resolved.fileName,name);
    await assert.rejects(resolveThreadOutputFile(`[文档](${href})`,encodeURIComponent('chapter %20'),root),/不是这条可见回复/);
  }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'cmc-output-'));await fs.rm(root,{recursive:true,force:true});}
});
test('file URI locations and Windows namespaces normalize without losing encoded characters',()=>{
  const root=os.tmpdir(),file=path.join(root,'guide %20#final.md');
  assert.equal(localOutputPath(pathToFileURL(file).href+':12:3?download=1#heading',root),file);
  if(process.platform==='win32'){const simple=path.join(root,'guide.md');assert.equal(localOutputPath('\\\\?\\'+simple+':4',root),simple);}
});

test('LAN output link reads its exact file without registering a project',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-output-'));
  try{const file=path.join(root,'九宫格 预览.jpg');await fs.writeFile(file,'image fixture');
    const resolved=await resolveThreadOutputFile(`![九宫格预览](<${file}>)`,file,root);
    assert.equal(resolved.absolutePath,await fs.realpath(file));assert.equal(resolved.fileName,'九宫格 预览.jpg');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('LAN output link supports a visible relative path and encoded Chinese names',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-output-'));
  try{await fs.writeFile(path.join(root,'预览.png'),'fixture');const file=await resolveThreadOutputFile('![图](预览.png)',encodeURIComponent('预览.png'),root);assert.equal(file.fileName,'预览.png');}
  finally{await fs.rm(root,{recursive:true,force:true});}
});
test('output link cannot substitute an unreferenced or unrelated file',async()=>{
  await assert.rejects(resolveThreadOutputFile('![图](preview.jpg)','secret.txt',os.tmpdir()),/不是这条可见回复/);
  await assert.rejects(resolveThreadOutputFile('![图](preview.jpg)','../secret.txt',os.tmpdir()),/不是这条可见回复/);
  await assert.rejects(resolveThreadOutputFile('`![图](preview.jpg)`','preview.jpg',os.tmpdir()),/不是这条可见回复/);
});
test('output link rejects remote URLs and directories',async()=>{
  await assert.rejects(resolveThreadOutputFile('[网站](https://example.com/a)','https://example.com/a',''),/不是本地/);
  await assert.rejects(resolveThreadOutputFile(`[目录](<${os.tmpdir()}>)`,os.tmpdir(),''),/指向目录/);
});
test('public proxy admits image GET but keeps general output files and writes private',()=>{
  assert.equal(permittedPublicRequest('GET','/api/threads/thread/output-file/preview.jpg?eventId=one&path=preview.jpg'),true);
  for(const method of ['POST','HEAD','PUT','DELETE'])assert.equal(permittedPublicRequest(method,'/api/threads/thread/output-file/preview.jpg?eventId=one&path=preview.jpg'),false);
  for(const name of ['secret.txt','auth.json','page.svg','image.jpg.exe'])assert.equal(permittedPublicRequest('GET','/api/threads/thread/output-file/'+name),false);
});

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2kAAAAASUVORK5CYII=','base64');
test('public reply fallback reads only its referenced image in an authorized project',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-public-image-'));
  try{const file=path.join(root,'生产 页面.png');await fs.writeFile(file,png);
    const resolved=await resolvePublicOutputImage(`![图](<${file}>)`,file,root,[root]);
    assert.equal(resolved.mime,'image/png');assert.equal(resolved.absolutePath,await fs.realpath(file));
    await assert.rejects(resolvePublicOutputImage(`![图](<${file}>)`,file,root,[]),/已授权项目/);
    await assert.rejects(resolvePublicOutputImage(`\`![图](<${file}>)\``,file,root,[root]),/不是这条/);
    await assert.rejects(resolvePublicOutputImage(`[文件](<${file}>)`,file,root,[root]),/不是这条/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('public reply fallback rejects sibling directories, substituted paths and disguised non-images',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-public-boundary-'));
  try{const project=path.join(root,'project'),outside=path.join(root,'project-other');await fs.mkdir(project);await fs.mkdir(outside);
    const file=path.join(outside,'secret.png');await fs.writeFile(file,png);
    await assert.rejects(resolvePublicOutputImage(`![图](<${file}>)`,file,project,[project]),/已授权项目/);
    await assert.rejects(resolvePublicOutputImage('![图](preview.png)',file,project,[project]),/不是这条/);
    const html=path.join(project,'disguised.png');await fs.writeFile(html,'<html>private document</html>');
    await assert.rejects(resolvePublicOutputImage(`![图](<${html}>)`,html,project,[project]),/图片格式/);
    const huge=path.join(project,'large.png');await fs.writeFile(huge,png);await fs.truncate(huge,20*1024*1024+1);
    await assert.rejects(resolvePublicOutputImage(`![图](<${huge}>)`,huge,project,[project]),/20 MB/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('a streaming output link uses only the contiguous visible answer',()=>{
  const events=[{type:'message.delta',eventId:'first',itemId:'answer',text:'![图]('},{type:'message.delta',eventId:'next',itemId:'answer',text:'preview.jpg)'},{type:'user.message',text:'边界'},{type:'message.delta',eventId:'later',itemId:'answer',text:'[秘密](secret.txt)'}];
  assert.equal(storedOutputMessage(events,'first').text,'![图](preview.jpg)');
  assert.equal(storedOutputMessage(events,'later').text,'[秘密](secret.txt)');
  assert.equal(storedOutputMessage(events,'missing'),undefined);
});
