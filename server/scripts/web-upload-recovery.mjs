import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';

export async function auditUploadRecovery(page,artifacts,{base,token}){
  const checks=[],requests=[];
  let releaseFile,releaseImage,releaseTimeout;
  const waiting=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
  const fileWait=waiting(),imageWait=waiting(),timeoutWait=waiting();
  const file=(name)=>({name,mimeType:'text/plain',buffer:Buffer.from('fixture upload '+name)});
  await page.addInitScript(()=>{
    const header=XMLHttpRequest.prototype.setRequestHeader,send=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.setRequestHeader=function(name,value){if(name.toLowerCase()==='x-file-name')this.fixtureUploadName=decodeURIComponent(value);return header.call(this,name,value);};
    XMLHttpRequest.prototype.send=function(body){if(this.fixtureUploadName==='timeout.txt'){window.fixtureOriginalUploadTimeout=this.timeout;this.timeout=200;}return send.call(this,body);};
  });
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/uploads/'))requests.push({kind:request.url().split('/api/uploads/')[1],name:decodeURIComponent(request.headers()['x-file-name']||'')});});
  await page.route('**/api/uploads/files',async route=>{
    const name=decodeURIComponent(route.request().headers()['x-file-name']||'');
    if(name==='held.txt'){releaseFile=fileWait.release;await fileWait.promise;await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'late-file',name,mime:'text/plain',size:1})}).catch(()=>{});}
    else if(name==='timeout.txt'){releaseTimeout=timeoutWait.release;await timeoutWait.promise;await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'timeout-late',name,mime:'text/plain',size:1})}).catch(()=>{});}
    else await route.continue();
  });
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    await page.locator('#openDrawer').click();await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    await page.locator('#prompt').fill('保留这条草稿');
    await page.waitForFunction(()=>!document.querySelector('#sendBtn').disabled);
    await page.locator('#fileInput').setInputFiles([file('complete.txt'),file('held.txt')]);
    await page.waitForFunction(()=>document.querySelector('#uploadStatus').textContent.includes('held.txt'));
    await page.locator('#fileDrafts .file-attachment').filter({hasText:'complete.txt'}).waitFor();
    assert(await page.locator('#uploadCancel').isVisible());assert(await page.locator('#sendBtn').isDisabled());
    await page.locator('#fileInput').setInputFiles(file('duplicate.txt'));
    assert.equal(requests.filter(request=>request.name==='duplicate.txt').length,0);
    await page.locator('#uploadCancel').click();
    assert(await page.locator('#uploadFeedback').isHidden());assert(await page.locator('#sendBtn').isEnabled());
    assert.equal(await page.locator('#prompt').inputValue(),'保留这条草稿');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),1);
    checks.push('取消挂起文件后立即解锁，已完成附件及草稿保留，并阻止并行批次');

    await page.locator('#fileInput').setInputFiles(file('next.txt'));
    await page.locator('#fileDrafts .file-attachment').filter({hasText:'next.txt'}).waitFor();
    releaseFile();await page.waitForFunction(()=>document.querySelector('#uploadFeedback').hidden);
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),2);
    assert(!await page.locator('#fileDrafts').textContent().then(text=>text.includes('held.txt')));
    checks.push('取消后的迟到回包不追加附件，下一批正常完成');

    await page.locator('#fileInput').setInputFiles(file('timeout.txt'));
    await page.waitForFunction(()=>document.querySelector('#uploadStatus').textContent.includes('上传超时'));
    assert.equal(await page.evaluate(()=>window.fixtureOriginalUploadTimeout),300000);
    assert(await page.locator('#uploadCancel').isHidden());assert(await page.locator('#uploadDismiss').isVisible());assert(await page.locator('#sendBtn').isEnabled());
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),2);
    await page.setViewportSize({width:411,height:860});
    await page.waitForFunction(()=>!document.body.classList.contains('sidebar-expanded')&&document.querySelector('#main').getBoundingClientRect().x<=1);
    const feedback=await page.locator('#uploadFeedback').boundingBox();
    assert(feedback.width>=300&&feedback.x>=0&&feedback.x+feedback.width<=411,'手机宽度下上传反馈应正常换行并完整显示');
    const fileName=await page.locator('#fileDrafts .file-attachment-link').filter({hasText:'complete.txt'}).boundingBox();
    assert(fileName.width>=80,'手机输入框应显示文件名，而不只是文件大小');
    await page.screenshot({path:path.join(artifacts,'web-upload-277-timeout.png')});
    await page.locator('#uploadDismiss').click();assert(await page.locator('#uploadFeedback').isHidden());
    releaseTimeout();checks.push('真实浏览器 XHR 超时解除忙碌状态并保留附件，错误可关闭');

    await page.route('**/api/uploads/images',async route=>{releaseImage=imageWait.release;await imageWait.promise;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'cancelled.png',name:'mixed.png'})}).catch(()=>{});});
    const png=PNG.sync.write(new PNG({width:2,height:2}));
    const imageRequested=page.waitForRequest(request=>request.url().endsWith('/api/uploads/images'));
    await page.locator('#imageInput').setInputFiles([{name:'mixed.png',mimeType:'image/png',buffer:png},file('mixed.txt')]);
    await imageRequested;
    await page.waitForFunction(()=>document.querySelector('#uploadStatus').textContent.includes('mixed.png'));
    await page.locator('#uploadCancel').click();releaseImage();
    assert.equal(requests.filter(request=>request.name==='mixed.txt').length,0);
    assert.equal(await page.locator('#imageDrafts img').count(),0);
    assert(await page.locator('#sendBtn').isEnabled());checks.push('取消混合批次中的图片，不启动后续文件阶段');
    await fs.writeFile(path.join(artifacts,'web-upload-277-checks.json'),JSON.stringify({checks,requests,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({uploadChecks:checks}));
  }finally{releaseFile?.();releaseImage?.();releaseTimeout?.();}
}
