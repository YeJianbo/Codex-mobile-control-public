import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';

export async function auditImageCount(page,artifacts,{base,token}){
  await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
  await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
  await page.locator('#openDrawer').click();await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
  const png=new PNG({width:4,height:4});png.data.fill(255);const bytes=PNG.sync.write(png);
  const files=Array.from({length:9},(_,i)=>({name:`image-${i}.png`,mimeType:'image/png',buffer:bytes}));
  await page.locator('#prompt').fill('IMAGE_COUNT_TEST');
  await page.locator('#imageInput').setInputFiles(files);
  await page.waitForFunction(()=>document.querySelectorAll('#imageDrafts img').length===9&&document.querySelector('#uploadFeedback').hidden);
  await page.locator('#sendBtn').click();
  await page.locator('#events .message.assistant').filter({hasText:'任务：IMAGE_COUNT_TEST'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
  assert.equal(await page.locator('#events .message.user img').count(),9);
  await page.locator('#composerTools').click();await page.getByRole('menuitem',{name:'再次使用上一条',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#imageDrafts img').length===9);
  assert.equal(await page.locator('#prompt').inputValue(),'IMAGE_COUNT_TEST');
  const threadTitle=await page.locator('.thread-row.active:not(.goal-row)').getAttribute('title');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
  if(await page.locator('#openDrawer').getAttribute('aria-expanded')==='false')await page.locator('#openDrawer').click();
  await page.getByTitle(threadTitle,{exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#imageDrafts img').length===9);
  await fs.writeFile(path.join(artifacts,'web-image-count-290-checks.json'),JSON.stringify({uploadedImages:9,submittedImages:9,localInputs:9,historyReuseImages:9,reloadedDraftImages:9,backend:'mock',modelRequests:0},null,2));
  console.log(JSON.stringify({imageCountChecks:9,localInputs:true,historyReuse:true,draftReload:true,backend:'mock'}));
}

export async function auditComposerTransfer(page,artifacts,{base,token}){
  const checks=[],uploads=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/uploads/'))uploads.push(request.url().split('/api/uploads/')[1]);});
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    await page.locator('#openDrawer').click();await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    const prompt=page.locator('#prompt');await prompt.fill('原文：');await prompt.focus();
    const box=await prompt.boundingBox(),position={x:box.x+box.width*.6,y:box.y+box.height*.5};
    const session=await page.context().newCDPSession(page);
    const data={items:[{mimeType:'text/plain',data:'拖入中文\n保留第二行'}],dragOperationsMask:1};
    try{for(const type of ['dragEnter','dragOver','drop'])await session.send('Input.dispatchDragEvent',{type,...position,data});}
    finally{await session.detach();}
    await page.waitForFunction(()=>document.querySelector('#prompt').value.includes('拖入中文\n保留第二行'));
    assert.equal(await prompt.inputValue(),'原文：拖入中文\n保留第二行');assert.equal(uploads.length,0);
    const original=await prompt.inputValue();await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    if(await page.locator('#openDrawer').getAttribute('aria-expanded')==='false')await page.locator('#openDrawer').click();
    await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    assert.equal(await prompt.inputValue(),original);
    checks.push('Chrome 原生拖入中文多行文本，未启动上传，重载后草稿保留');

    const png=new PNG({width:4,height:4});png.data.fill(255);
    // Synthetic clipboard events test the app's default-prevention policy and
    // upload handling without changing the user's operating-system clipboard.
    const mixed=await prompt.evaluate((node,bytes)=>{
      const clipboard=new DataTransfer();clipboard.setData('text/plain','原生粘贴文字');
      clipboard.items.add(new File([new Uint8Array(bytes)],'粘贴图片.png',{type:'image/png'}));
      clipboard.items.add(new File(['粘贴文件'],'粘贴文件.txt',{type:'text/plain'}));
      const event=new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true});node.dispatchEvent(event);return event.defaultPrevented;
    },[...PNG.sync.write(png)]);
    assert.equal(mixed,false);
    await page.waitForFunction(()=>document.querySelectorAll('#imageDrafts img').length===1&&document.querySelectorAll('#fileDrafts .file-attachment').length===1&&document.querySelector('#uploadFeedback').hidden);
    assert.equal(await prompt.inputValue(),original);
    assert.deepEqual(uploads,['images','files']);
    checks.push('混合剪贴事件保留原生文字输入，图片和普通文件在同一批次上传');

    const fileOnly=await prompt.evaluate(node=>{
      const clipboard=new DataTransfer();clipboard.items.add(new File(['普通文件'],'文件剪贴.txt',{type:'text/plain'}));
      const event=new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true});node.dispatchEvent(event);return event.defaultPrevented;
    });
    assert.equal(fileOnly,true);
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===2&&document.querySelector('#uploadFeedback').hidden);
    assert.equal(await prompt.inputValue(),original);assert.equal(await page.locator('#events .message.user').count(),0);
    checks.push('仅文件的剪贴事件可上传普通附件，草稿保留且没有自动发送');
    await fs.writeFile(path.join(artifacts,'web-composer-transfer-281-checks.json'),JSON.stringify({checks,uploads,nativeTextDrop:true,clipboardEventsSynthetic:true,systemClipboardChanged:false,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({composerTransferChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-composer-transfer-281-failure.png')});throw error;}
}
