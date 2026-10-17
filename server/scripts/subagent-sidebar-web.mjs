import assert from 'node:assert/strict';
import path from 'node:path';

export async function auditSubagentSidebar(page,artifacts,{base,token}){
 const fixtures=[
  {id:'agent-main',title:'协作研究任务',status:'idle',projectPath:'X:/fixture'},
  {id:'agent-sol',title:'检查实现',status:'running',projectPath:'X:/fixture',subagent:{parentThreadId:'agent-main',nickname:'Sol',role:'sol',task:'implementation'}},
  {id:'agent-terra',title:'检查兼容性',status:'idle',projectPath:'X:/fixture',subagent:{parentThreadId:'agent-main',nickname:'Terra',role:'terra'}},
  {id:'agent-nested',title:'检查测试',status:'idle',projectPath:'X:/fixture',subagent:{parentThreadId:'agent-sol',nickname:'Luna Max',role:'lunamax'}},
  {id:'ordinary',title:'普通会话',status:'idle',projectPath:'X:/fixture'}];
 const json=(route,body)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 await page.route('**/api/threads',route=>json(route,{threads:fixtures}));
 await page.route('**/api/threads/agent-*/**',route=>{
   const url=new URL(route.request().url()),id=url.pathname.split('/')[3];
   if(url.pathname.endsWith('/events'))return json(route,{events:[
     ...(id==='agent-main'?[{type:'tool.started',threadId:id,itemId:'patch',eventId:'patch-start',detail:'*** Begin Patch\n*** Update File: example.ts\n@@ -36,12 +36,13 @@\n'+Array.from({length:12},(_,i)=>' context'+i).join('\n')+'\n+hello\n*** Add File: sibling.ts\n+notSelected\n*** End Patch'},
       {type:'tool.completed',threadId:id,itemId:'patch',eventId:'patch-end',status:'ok',fileChanges:[{path:'example.ts',added:1,removed:0}]}]:[]),
     {type:'message.delta',threadId:id,itemId:'body',eventId:'answer',text:'子代理可见结果'},
     {type:'turn.completed',threadId:id,eventId:'finished',status:'ok'},
     ...(id==='agent-sol'?[{type:'turn.started',threadId:id,eventId:'active',turnId:'active'}]:[])],status:id==='agent-sol'?'running':'idle',hasMore:false});
   if(url.pathname.endsWith('/queue'))return json(route,{messages:[]});
   return json(route,{thread:fixtures.find(t=>t.id===id)});
 });
 await page.goto(base+'/console');await page.evaluate(token=>localStorage.setItem('cmc.token',token),token);await page.reload();
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
 await page.locator('#openDrawer').click();
 const recent=page.locator('#threads');
 await recent.getByText('协作研究任务',{exact:true}).waitFor();
 assert.equal(await recent.locator(':scope > .thread-row').count(),2);
 assert.equal(await recent.getByText('子代理 · Sol',{exact:true}).count(),0);
 assert.equal(await page.locator('#activeGoals .goal-row').count(),1,'running child keeps its parent in progress');
 assert.equal(await page.locator('#sidebar .subagent-toggle').count(),0);
 assert.equal(await recent.getByText('子代理 · Luna Max',{exact:true}).count(),0);
 await page.screenshot({path:path.join(artifacts,'subagents-desktop.png')});
 await recent.getByText('协作研究任务',{exact:true}).click();
 assert.equal(await page.locator('#conversationScroll #conversationAgents').count(),0,'agents use a header button');
 await page.locator('#chatHeader #conversationAgents').click();
 await page.locator('#actionMenu').getByRole('menuitem',{name:'子代理 · Sol · 运行中',exact:true}).waitFor({state:'visible'});
 await page.keyboard.press('Escape');
 await page.locator('#events > .activity-with-files .file-change-summary > summary').filter({hasText:'已更改 1 个文件'}).waitFor({state:'visible'});
 assert.equal(await page.locator('#events .file-change-summary').count(),1,'one file summary including folded process contents');
 const card=page.locator('#events > .activity-with-files .file-change-summary');
 await card.locator('summary').click();
 await card.getByRole('button',{name:/example.ts/}).click();
 await page.locator('dialog.change-modal').getByText('+hello',{exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('dialog.change-modal').getByText('+notSelected',{exact:true}).count(),0,'only selected file appears');
 await page.locator('dialog.change-modal .diff-context > summary').getByText('6 行未修改',{exact:true}).click();
 await page.locator('dialog.change-modal .diff-source').getByText(' context5',{exact:true}).waitFor({state:'visible'});
 await page.screenshot({path:path.join(artifacts,'compact-file-diff.png')});
 await page.locator('dialog.change-modal').getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#conversationAgents').click();
 await page.locator('#actionMenu').getByRole('menuitem',{name:'子代理 · Sol · 运行中',exact:true}).click();
 await page.locator('#conversationParentBack').click();
 await page.locator('#conversationAgents').click();
 await page.locator('#actionMenu').getByRole('menuitem',{name:'子代理 · Sol · 运行中',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('#actionMenu').getByRole('menuitem',{name:/Terra/}).count(),0,'idle agents stay in the sidebar');
 await page.screenshot({path:path.join(artifacts,'subagents-main-conversation.png')});
 await page.locator('#conversationAgents').click();
 await page.locator('#actionMenu').waitFor({state:'hidden'});
 assert.equal(await page.locator('#actionMenu').isVisible(),false,'agent menu can close again');
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>!document.body.classList.contains('sidebar-expanded'));
 if(!await page.locator('#sidebar').evaluate(n=>n.classList.contains('open')))await page.locator('#mobileDrawer').click();
 await page.waitForFunction(()=>{const style=getComputedStyle(document.querySelector('#sidebar'));return Number(style.opacity)>.99&&(style.transform==='none'||Math.abs(new DOMMatrixReadOnly(style.transform).m41)<1);});
 await page.screenshot({path:path.join(artifacts,'subagents-mobile.png')});
 await page.locator('#sidebarSearchToggle').click();
 await page.locator('#search').fill('Luna Max');
 await page.waitForFunction(()=>document.querySelectorAll('#threads .thread-row').length===0);
 assert.equal(await recent.getByText('子代理 · Luna Max',{exact:true}).count(),0);
 await page.locator('#search').fill('');
 await page.waitForFunction(()=>!document.querySelector('#threads .subagent-tree'));
 console.log('PASS main-only sidebar on desktop/mobile/search; conversation agents and compact diff preserved');
}
