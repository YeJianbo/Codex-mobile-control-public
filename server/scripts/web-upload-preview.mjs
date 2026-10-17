import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';

export async function auditUploadedPreview(page,artifacts,{base,token,pdfBytes}){
  const checks=[];
  const image=new PNG({width:8,height:8});image.data.fill(255);
  const files=[
    {name:'附件阅读.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBytes)},
    {name:'附件说明.md',mimeType:'text/markdown',buffer:Buffer.from('# 附件正文\n\n查看后继续编辑。')},
    {name:'重试.txt',mimeType:'text/plain',buffer:Buffer.from('恢复后可读')},
    {name:'图片.png',mimeType:'image/png',buffer:PNG.sync.write(image)},
    {name:'下载.bin',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])},
  ];
  const modal=()=>page.locator('dialog.output-modal[open]');
  const open=async name=>{await page.locator('#fileDrafts .file-attachment-link').filter({hasText:name}).click();await modal().waitFor();};
  const close=async()=>{await modal().getByRole('button',{name:'关闭',exact:true}).click();await page.locator('dialog.output-modal').waitFor({state:'detached'});};
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    await page.locator('#openDrawer').click();await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    await page.locator('#prompt').fill('查看附件后继续写这条草稿');
    await page.locator('#fileInput').setInputFiles(files);
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===5&&document.querySelector('#uploadFeedback').hidden);
    await open('附件阅读.pdf');
    await modal().locator('canvas[data-rendered="1"]').waitFor();
    assert(await modal().locator('canvas').evaluate(canvas=>canvas.width>0&&canvas.height>0));
    assert(await modal().getByRole('link',{name:'下载',exact:true}).isVisible());
    assert.equal(page.context().pages().length,1);
    await close();await open('附件说明.md');
    await modal().getByRole('heading',{name:'附件正文',exact:true}).waitFor();
    assert(await modal().getByText('查看后继续编辑。',{exact:true}).isVisible());await close();
    checks.push('上传 PDF 实际绘制页面，Markdown 渲染正文，在原页保留下载入口');

    const href=await page.locator('#fileDrafts .file-attachment-link').filter({hasText:'重试.txt'}).getAttribute('href');
    let attempts=0;
    await page.route(base+href,async route=>{if(++attempts===1)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'电脑服务暂不可用'})});else await route.continue();});
    await open('重试.txt');await modal().getByRole('alert').waitFor();
    assert((await modal().getByRole('alert').textContent()).includes('电脑服务暂不可用'));
    await modal().getByRole('button',{name:'重试',exact:true}).click();await modal().getByText('恢复后可读',{exact:true}).waitFor();
    assert.equal(attempts,2);await close();await page.unroute(base+href);
    checks.push('读取失败留在预览内，原处重试恢复正文');

    await open('图片.png');await modal().locator('img').waitFor();
    assert(await modal().locator('img').evaluate(img=>img.naturalWidth===8));await close();
    const binary=page.locator('#fileDrafts .file-attachment-link').filter({hasText:'下载.bin'});
    assert.equal(await binary.getAttribute('download'),'下载.bin');
    const downloadWait=page.waitForEvent('download');await binary.click();const download=await downloadWait;
    assert.equal(download.suggestedFilename(),'下载.bin');
    assert.equal(await page.locator('dialog.output-modal').count(),0);
    assert.equal(await page.locator('#prompt').inputValue(),'查看附件后继续写这条草稿');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),5);
    checks.push('图片原页可见，二进制继续下载，关闭预览保留草稿和附件');

    await page.setViewportSize({width:411,height:900});
    await page.waitForFunction(()=>document.querySelector('#main').getBoundingClientRect().x<=1);
    await open('附件阅读.pdf');await modal().locator('canvas[data-rendered="1"]').waitFor();
    const heading=await modal().locator('.output-heading').boundingBox();assert(heading.x>=0&&heading.x+heading.width<=411);
    assert(await modal().getByRole('link',{name:'下载',exact:true}).isVisible());
    assert(await modal().getByRole('button',{name:'关闭',exact:true}).isVisible());
    await page.screenshot({path:path.join(artifacts,'web-upload-preview-278.png')});await close();
    checks.push('411px 页面内 PDF 可读，下载与关闭按钮可见');
    await fs.writeFile(path.join(artifacts,'web-upload-preview-278-checks.json'),JSON.stringify({checks,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({uploadedPreviewChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-upload-preview-278-failure.png')});throw error;}
}

export async function auditUploadMime(page,artifacts,{base,token,pdfBytes}){
  const image=new PNG({width:8,height:8});image.data.fill(255);
  const files=[
    {name:'规范PDF',mimeType:' Application/PDF; profile=preview ',buffer:Buffer.from(pdfBytes)},
    {name:'规范Markdown',mimeType:'Text/X-Markdown; charset=utf-8',buffer:Buffer.from('# MIME 附件正文\n\n关闭后继续编辑。')},
    {name:'规范图片',mimeType:'Image/PNG; fixture=1',buffer:PNG.sync.write(image)},
    {name:'下载.bin',mimeType:'invalid-type',buffer:Buffer.from([1,2,3])},
  ];
  const uploadResponses=[];
  page.on('response',response=>{if(response.request().method()==='POST'&&response.url()===base+'/api/uploads/files')uploadResponses.push(response.json());});
  const modal=()=>page.locator('dialog.output-modal[open]');
  const close=async()=>{await modal().getByRole('button',{name:'关闭',exact:true}).click();await page.locator('dialog.output-modal').waitFor({state:'detached'});};
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    if(await page.locator('#openDrawer').getAttribute('aria-expanded')==='false')await page.locator('#openDrawer').click();
    await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    await page.locator('#prompt').fill('规范类型后保留这条草稿');
    await page.locator('#fileInput').setInputFiles(files);
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===4&&document.querySelector('#uploadFeedback').hidden);
    const uploaded=await Promise.all(uploadResponses);
    assert.deepEqual(uploaded.map(file=>file.mime),['application/pdf','text/x-markdown','image/png','application/octet-stream']);
    for(const file of uploaded){
      const read=await page.request.get(base+'/api/uploads/files/'+file.id,{headers:{Authorization:'Bearer '+token}});
      assert.equal(read.status(),200);assert.equal(read.headers()['content-type'].split(';',1)[0],file.mime);
      assert((await read.body()).equals(files.find(source=>source.name===file.name).buffer));
    }
    for(const name of ['规范PDF','规范Markdown','规范图片']){
      await page.locator('#fileDrafts').getByRole('link',{name,exact:true}).click();await modal().waitFor();
      if(name==='规范PDF')await modal().locator('canvas[data-rendered="1"]').waitFor();
      else if(name==='规范Markdown')await modal().getByRole('heading',{name:'MIME 附件正文',exact:true}).waitFor();
      else await page.waitForFunction(()=>document.querySelector('dialog.output-modal[open] img')?.naturalWidth===8);
      await close();
    }
    const binary=page.locator('#fileDrafts').getByRole('link',{name:'下载.bin',exact:true});
    const pending=page.waitForEvent('download');await binary.click();assert.equal((await pending).suggestedFilename(),'下载.bin');
    assert.equal(await page.locator('#prompt').inputValue(),'规范类型后保留这条草稿');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),4);
    assert.equal(page.context().pages().length,1);
    const checks=['真实上传保留规范 MIME，读取正文与原字节一致，非法类型仍使用通用 MIME','无扩展名 PDF 实际绘制、Markdown 正文排版、图片尺寸可见','关闭保留草稿与附件，未知二进制继续下载，不打开新页面'];
    await fs.writeFile(path.join(artifacts,'web-upload-mime-284-checks.json'),JSON.stringify({checks,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({uploadMimeChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-upload-mime-284-failure.png')});throw error;}
}

export async function auditTextTypes(page,artifacts,{base,token}){
  const files=[
    {name:'JSON资料',mimeType:'Application/JSON; charset=utf-8',buffer:Buffer.from('{"title":"中文 <em>原文</em>"}\n'),preview:true},
    {name:'XML资料',mimeType:'application/xml',buffer:Buffer.from('<?xml version="1.0"?><note><em>中文原文</em></note>\n'),preview:true},
    {name:'sample.KT',mimeType:'application/octet-stream',buffer:Buffer.from('fun main() { println("中文原文") }\n'),preview:true},
    {name:'下载.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,1,128])},
    {name:'大JSON资料',mimeType:'application/json',buffer:Buffer.from('{"text":"'+'a'.repeat(6*1024*1024)+'"}\n')},
  ];
  let modelMessagesSent=0;
  page.on('websocket',socket=>socket.on('framesent',({payload})=>{
    try{if(['thread.start','turn.start','turn.steer'].includes(JSON.parse(payload).type))modelMessagesSent++;}catch{}
  }));
  const modal=()=>page.locator('dialog.output-modal[open]');
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    if(await page.locator('#openDrawer').getAttribute('aria-expanded')==='false')await page.locator('#openDrawer').click();
    await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    await page.locator('#prompt').fill('查看文本类型后继续写草稿');
    await page.locator('#fileInput').setInputFiles(files.map(({name,mimeType,buffer})=>({name,mimeType,buffer})));
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===5&&document.querySelector('#uploadFeedback').hidden);
    for(const file of files){
      const card=page.locator('#fileDrafts').getByRole('link',{name:file.name,exact:true});
      let link=card;
      if(file.preview){
        assert.equal(await card.getAttribute('download'),null);
        await card.click();await modal().locator('pre.output-text').waitFor();
        assert.equal(await modal().locator('pre.output-text').textContent(),file.buffer.toString());
        assert.equal(await modal().locator('.output-body em').count(),0);
        link=modal().getByRole('link',{name:'下载',exact:true});
      }else assert.equal(await card.getAttribute('download'),file.name);
      const pending=page.waitForEvent('download');await link.click();const download=await pending;
      assert.equal(download.suggestedFilename(),file.name);assert((await fs.readFile(await download.path())).equals(file.buffer));await download.delete();
      if(file.preview){await modal().getByRole('button',{name:'关闭',exact:true}).click();await page.locator('dialog.output-modal').waitFor({state:'detached'});}
      assert.equal(await page.locator('dialog.output-modal').count(),0);
    }
    assert.equal(page.context().pages().length,1);
    assert.equal(await page.locator('#prompt').inputValue(),'查看文本类型后继续写草稿');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),5);
    assert.equal(modelMessagesSent,0);
    const checks=['无扩展名 JSON/XML 与通用 MIME 的 Kotlin 文件显示原文，标记不作为排版执行','二进制与超过 5MB 的文本继续下载，五个下载与上传字节一致','关闭后草稿和五个附件保留，没有发送模型任务'];
    await fs.writeFile(path.join(artifacts,'web-text-types-288-checks.json'),JSON.stringify({checks,modelMessagesSent},null,2));
    console.log(JSON.stringify({textTypeChecks:checks,modelMessagesSent}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-text-types-288-failure.png')});throw error;}
}

export async function auditTextEncoding(page,artifacts,{base,token}){
  const markdown='# BOM 文档\n\n中文 🌏\n',json='{\"title\":\"中文 🌏\"}\n';
  const files=[
    {name:'UTF16LE.md',mimeType:'text/markdown',buffer:Buffer.concat([Buffer.from([255,254]),Buffer.from(markdown,'utf16le')]),content:markdown},
    {name:'UTF16BE.json',mimeType:'application/json',buffer:Buffer.concat([Buffer.from([254,255]),Buffer.from(json,'utf16le').swap16()]),content:json},
    {name:'UTF8BOM.txt',mimeType:'text/plain',buffer:Buffer.concat([Buffer.from([239,187,191]),Buffer.from('UTF-8 中文 🌏\n')]),content:'UTF-8 中文 🌏\n'},
    {name:'无法解码.txt',mimeType:'text/plain',buffer:Buffer.from([255,128])},
  ];
  const modal=()=>page.locator('dialog.output-modal[open]');
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    if(await page.locator('#openDrawer').getAttribute('aria-expanded')==='false')await page.locator('#openDrawer').click();
    await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    await page.locator('#prompt').fill('读完编码文档后继续写');
    await page.locator('#fileInput').setInputFiles(files.map(({name,mimeType,buffer})=>({name,mimeType,buffer})));
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===4&&document.querySelector('#uploadFeedback').hidden);
    for(const file of files){
      await page.locator('#fileDrafts').getByRole('link',{name:file.name,exact:true}).click();await modal().waitFor();
      if(file.name.endsWith('.md'))await modal().getByRole('heading',{name:'BOM 文档',exact:true}).waitFor();
      else if(file.content){await modal().locator('pre.output-text').waitFor();assert.equal(await modal().locator('pre.output-text').textContent(),file.content);}
      else{await modal().getByRole('alert').waitFor();assert((await modal().getByRole('alert').textContent()).includes('无法识别文本编码'));}
      const pending=page.waitForEvent('download');await modal().getByRole('link',{name:'下载',exact:true}).click();const download=await pending;
      assert.equal(download.suggestedFilename(),file.name);assert((await fs.readFile(await download.path())).equals(file.buffer));await download.delete();
      await modal().getByRole('button',{name:'关闭',exact:true}).click();await page.locator('dialog.output-modal').waitFor({state:'detached'});
    }
    assert.equal(await page.locator('#prompt').inputValue(),'读完编码文档后继续写');assert.equal(await page.locator('#fileDrafts .file-attachment').count(),4);
    const checks=['UTF-16LE Markdown 实际排版，UTF-16BE 与带 BOM 的 UTF-8 显示原文','无法解码时显示原因并保留下载入口，四个下载与原字节一致','关闭后草稿与附件保留，没有发送模型任务'];
    await fs.writeFile(path.join(artifacts,'web-text-encoding-286-checks.json'),JSON.stringify({checks,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({textEncodingChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-text-encoding-286-failure.png')});throw error;}
}

export async function auditPreviewConnection(page,artifacts,{base,token,pdfBytes}){
  const checks=[];
  await page.addInitScript(()=>{
    window.fixtureFileAborts=0;
    const original=window.fetch;
    window.fetch=function(url,options){
      if(String(url).includes('/api/uploads/files/')&&options?.signal)options.signal.addEventListener('abort',()=>window.fixtureFileAborts++,{once:true});
      return original.call(this,url,options);
    };
  });
  async function connect(){
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    if(await page.locator('#openDrawer').isVisible())await page.locator('#openDrawer').click();
    await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
  }
  const modal=()=>page.locator('dialog.output-modal[open]');
  const open=async name=>{await page.locator('#fileDrafts .file-attachment-link').filter({hasText:name}).click();await modal().waitFor();};
  // Invoke the actual connection button handler while another dialog is open,
  // matching a connection replacement triggered outside the preview itself.
  const disconnect=async()=>{await page.evaluate(()=>document.querySelector('#disconnectBtn').click());await page.locator('dialog.output-modal').waitFor({state:'detached'});};
  let release;
  try{
    await connect();await page.locator('#prompt').fill('断开连接后保留这条草稿');
    await page.locator('#fileInput').setInputFiles([
      {name:'连接阅读.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBytes)},
      {name:'连接说明.md',mimeType:'text/markdown',buffer:Buffer.from('# 已加载正文')},
      {name:'等待.txt',mimeType:'text/plain',buffer:Buffer.from('旧连接迟到内容')},
    ]);
    await page.waitForFunction(()=>document.querySelectorAll('#fileDrafts .file-attachment').length===3&&document.querySelector('#uploadFeedback').hidden);
    await open('连接阅读.pdf');await modal().locator('canvas[data-rendered="1"]').waitFor();await disconnect();
    assert.equal(await page.locator('#prompt').inputValue(),'断开连接后保留这条草稿');
    checks.push('已绘制 PDF 在断开连接时关闭，当前草稿保留');

    await connect();await open('连接说明.md');await modal().getByRole('heading',{name:'已加载正文',exact:true}).waitFor();
    // Reconnect through the same existing button handler without first closing
    // the preview, so already-loaded content is covered as well as pending IO.
    await page.evaluate(()=>document.querySelector('#connectBtn').click());
    await page.locator('dialog.output-modal').waitFor({state:'detached'});
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    checks.push('重新连接立即关闭已加载 Markdown，旧下载入口移除');

    const href=await page.locator('#fileDrafts .file-attachment-link').filter({hasText:'等待.txt'}).getAttribute('href');
    let arrived;const arrival=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>release=resolve);
    await page.route(base+href,async route=>{arrived();await held;await route.fulfill({status:200,contentType:'text/plain',body:'旧连接迟到内容'}).catch(()=>{});});
    const previousAborts=await page.evaluate(()=>window.fixtureFileAborts);
    await open('等待.txt');await arrival;await disconnect();
    await page.waitForFunction(previous=>window.fixtureFileAborts>previous,previousAborts);
    release();await page.unroute(base+href);
    assert.equal(await page.locator('dialog.output-modal').count(),0);
    assert.equal(await page.getByText('旧连接迟到内容',{exact:true}).count(),0);
    assert.equal(await page.locator('#prompt').inputValue(),'断开连接后保留这条草稿');
    assert.equal(await page.locator('#fileDrafts .file-attachment').count(),3);
    checks.push('挂起文本在断开时实际触发 AbortSignal，迟到内容不恢复窗口，附件保留');
    await fs.writeFile(path.join(artifacts,'web-preview-connection-279-checks.json'),JSON.stringify({checks,modelMessagesSent:0},null,2));
    console.log(JSON.stringify({previewConnectionChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-preview-connection-279-failure.png')});throw error;}
  finally{release?.();}
}
