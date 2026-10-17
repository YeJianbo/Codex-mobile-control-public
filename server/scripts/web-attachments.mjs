import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';

export async function auditAttachments(page,artifacts,{base,token}){
  const png=PNG.sync.write(new PNG({width:2,height:2}));
  const checks=[];
  const uploadRequests=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/uploads/'))uploadRequests.push(request.url().split('/api/uploads/')[1]);});
  const drawer=async()=>{
    if(!await page.locator('#sidebar').evaluate(node=>node.classList.contains('open')))
      await page.locator(await page.locator('#mobileDrawer').isVisible()?'#mobileDrawer':'#openDrawer').click();
  };
  const project=async name=>{await drawer();await page.locator('#projects .project-row').filter({hasText:name}).click();};
  const drafts=()=>page.evaluate(()=>({images:JSON.parse(localStorage.getItem('cmc.imageDrafts')||'{}'),files:JSON.parse(localStorage.getItem('cmc.fileDrafts')||'{}')}));
  async function transfer(kind,name,withFile=false){
    await page.evaluate(({kind,name,bytes,withFile})=>{
      const data=new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)],name,{type:'image/png'}));
      if(withFile)data.items.add(new File(['original project file'],'mixed.txt',{type:'text/plain'}));
      const event=kind==='paste'?new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true});
      document.querySelector(kind==='paste'?'#prompt':'#composer').dispatchEvent(event);
    },{kind,name,bytes:[...png],withFile});
  }
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    await project('Atlas Workspace');
    const originalKey='project:'+await page.locator('#chatProject').inputValue();
    let arrived,release;
    const pending=new Promise(resolve=>arrived=resolve);
    const held=new Promise(resolve=>release=resolve);
    await page.route('**/api/uploads/images',async route=>{arrived();await held;await route.continue();});
    try{
      await transfer('drop','mixed.png',true);
      await pending;
      await project('Other Workspace');
    }finally{release();}
    await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('cmc.fileDrafts')||'{}')).flat().some(file=>file.name==='mixed.txt'));
    const uploaded=await drafts();
    assert.deepEqual(Object.keys(uploaded.images).filter(key=>uploaded.images[key].length),[originalKey]);
    assert.deepEqual(Object.keys(uploaded.files).filter(key=>uploaded.files[key].length),[originalKey],'整批图片和文件必须保留在最初项目');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),0,'切换后的项目不能出现前一项目的文件');
    await page.unroute('**/api/uploads/images');
    await project('Atlas Workspace');
    await page.locator('#imageDrafts img').waitFor();await page.locator('#fileDrafts .file-attachment').waitFor();
    checks.push('混合附件上传期间切换项目仍保留原归属');

    await drawer();await page.locator('#harnessBtn').click();
    await page.locator('.harness-option').filter({hasText:'Antigravity'}).click();
    await page.waitForFunction(()=>document.querySelector('#prompt').placeholder.includes('Antigravity'));
    for(const kind of ['paste','drop','picker']){
      if(kind==='picker')await page.locator('#imageInput').setInputFiles({name:kind+'.png',mimeType:'image/png',buffer:png});
      else await transfer(kind,kind+'.png');
      await page.locator('#fileDrafts .file-attachment').filter({hasText:kind+'.png'}).waitFor();
    }
    assert.equal(await page.locator('#imageDrafts img').count(),0);
    assert.equal(uploadRequests.filter(kind=>kind==='images').length,1,'不支持图片的助手不得通过粘贴或拖入绕过能力检查');
    assert.equal(uploadRequests.filter(kind=>kind==='files').length,4);
    checks.push('不支持图片的助手将粘贴、拖入和选择的图片统一保存为文件');
    await page.screenshot({path:path.join(artifacts,'web-attachments-198.png')});
    await fs.writeFile(path.join(artifacts,'web-attachments-198.json'),JSON.stringify({checks,uploadRequests,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({attachmentChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-attachments-198-failure.png')});throw error;}
}
