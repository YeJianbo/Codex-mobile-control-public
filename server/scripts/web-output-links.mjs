import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';

export async function auditOutputLinks(page,artifacts,{base,token,pdfBytes,home}){
  const directory=path.join(home,'Visible output files');await fs.mkdir(directory);
  const pdf=path.join(directory,'项目外 PDF.pdf'),markdown=path.join(directory,'chapter %20#draft.md');
  const image=path.join(directory,'figure %20#draft.png'),secret=path.join(directory,'unreferenced.txt');
  const html=path.join(directory,'reply.html');
  const png=new PNG({width:12,height:12});png.data.fill(255);
  await fs.writeFile(pdf,pdfBytes);await fs.writeFile(image,PNG.sync.write(png));await fs.writeFile(secret,'unreferenced fixture');
  await fs.writeFile(markdown,`# 百分号与井号文件\n\n![关联图片](${encodeURIComponent(path.basename(image))})`);
  await fs.writeFile(html,'<h1>HTML 原文</h1><script>parent.postMessage("OUTPUT_HTML_EXECUTED","*")</script>');
  await page.addInitScript(()=>{window.fixtureOutputHtmlExecuted=false;window.addEventListener('message',event=>{if(event.data==='OUTPUT_HTML_EXECUTED')window.fixtureOutputHtmlExecuted=true;});});
  const checks=[];
  try{
    await page.goto(base+'/console');await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    await page.locator('#openDrawer').click();await page.locator('#projects .project-row').filter({hasText:'Atlas Workspace'}).click();
    const roots=await page.request.get(base+'/api/projects',{headers:{Authorization:`Bearer ${token}`}});
    const before=await roots.json();
    await page.locator('#prompt').fill(`[项目外 PDF](<${pathToFileURL(pdf).href}>) · [特殊文件名](<${pathToFileURL(markdown).href}>) · [HTML 原文](<${pathToFileURL(html).href}>)\n\n![回复图片](<${pathToFileURL(image).href}>)`);
    await page.locator('#sendBtn').click();
    const reply=page.locator('.message.assistant').filter({hasText:'项目外 PDF'}).last();
    await reply.locator('img.inline-output-image').waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.message.assistant img.inline-output-image')].some(img=>img.naturalWidth===12));
    await page.waitForFunction(()=>!document.querySelector('#stopBtn')||document.querySelector('#stopBtn').disabled||document.querySelector('#stopBtn').hidden);
    await reply.getByRole('link',{name:'项目外 PDF',exact:true}).click();
    const modal=page.locator('dialog.output-modal[open]');await modal.locator('canvas[data-rendered="1"]').waitFor();
    const download=modal.getByRole('link',{name:'下载',exact:true});const endpoint=await download.getAttribute('href');
    const downloadEvent=page.waitForEvent('download');await download.click();const saved=await downloadEvent;
    assert.equal(saved.suggestedFilename(),'项目外 PDF.pdf');assert((await fs.readFile(await saved.path())).subarray(0,5).equals(Buffer.from('%PDF-')));
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    checks.push('项目外可见回复 PDF 实际绘制并下载，回复图片实际可见');

    await reply.getByRole('link',{name:'特殊文件名',exact:true}).click();
    await modal.getByRole('heading',{name:'百分号与井号文件',exact:true}).waitFor();
    assert.equal(await modal.locator('.output-heading h2').textContent(),'chapter %20#draft.md');
    await page.waitForFunction(()=>document.querySelector('dialog.output-modal .inline-output-image')?.naturalWidth===12);
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('dialog.output-modal')).opacity)>.99);
    await page.screenshot({path:path.join(artifacts,'web-output-links-280.png')});
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    checks.push('百分号及编码井号文件名完整保留，Markdown 关联图片可见');

    await reply.getByRole('link',{name:'HTML 原文',exact:true}).click();await modal.locator('pre.output-text').waitFor();
    assert((await modal.locator('pre.output-text').textContent()).includes('<script>'));
    assert.equal(await modal.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>window.fixtureOutputHtmlExecuted),false);
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    checks.push('会话文件读取路径中的 HTML 显示原文，不执行内嵌脚本');

    const forged=new URL(endpoint,base);forged.searchParams.set('path',pathToFileURL(secret).href);
    const rejected=await page.request.get(forged.href,{headers:{Authorization:`Bearer ${token}`}});
    assert(!rejected.ok());assert((await rejected.text()).includes('不是这条可见回复'));
    const after=await (await page.request.get(base+'/api/projects',{headers:{Authorization:`Bearer ${token}`}})).json();assert.deepEqual(after,before);
    checks.push('替换为未引用文件仍被电脑拒绝，项目授权列表保持原值');
    await fs.writeFile(path.join(artifacts,'web-output-links-280-checks.json'),JSON.stringify({checks,mockModelCommands:1,productionModelCommands:0},null,2));
    console.log(JSON.stringify({outputLinksChecks:checks}));
  }catch(error){await page.screenshot({path:path.join(artifacts,'web-output-links-280-failure.png')});throw error;}
}
