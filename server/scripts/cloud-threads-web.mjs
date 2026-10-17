import assert from 'node:assert/strict';
import path from 'node:path';

export async function auditCloudThreads(page,artifacts,{base,token}){
  const id='cloud:live';
  const thread={id,title:'体验优化 Codex 控制台',status:'idle',source:'cloudCodex',readOnly:true};
  const json=(route,body)=>route.fulfill({json:body});
  await page.route('**/api/threads',route=>json(route,{threads:[thread]}));
  await page.route('**/api/threads/**',route=>{
    if(new URL(route.request().url()).pathname.endsWith('/events'))return json(route,{status:'idle',hasMore:false,events:[{type:'user.message',threadId:id,eventId:'request',text:'请完成附件交付',messageSource:{kind:'thread',threadId:'source',name:'项目助手'}},{type:'message.delta',threadId:id,eventId:'answer',itemId:'answer',text:'云端可见回复'}]});
    return json(route,{messages:[],canSteer:false});
  });
  await page.goto(base+'/console');await page.evaluate(token=>localStorage.setItem('cmc.token',token),token);await page.reload();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
  await page.locator('#openDrawer').click();
  await page.locator('#threads').getByText('云端 · 体验优化 Codex 控制台',{exact:true}).click();
  await page.locator('.message-source').getByText('来自 项目助手',{exact:true}).waitFor();
  assert.match(await page.locator('#snapshotNotice').innerText(),/自动刷新/);
  assert.doesNotMatch(await page.locator('#snapshotNotice').innerText(),/快照|Invalid Date/);
  assert.equal(await page.locator('.composer-wrap').isVisible(),false);
  assert.equal(await page.locator('.user-bubble').innerText(),'请完成附件交付');
  await page.screenshot({path:path.join(artifacts,'cloud-thread-source.png')});
}
