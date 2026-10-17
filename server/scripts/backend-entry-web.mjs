import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {conversationBlocks} from '../public/console-core.js';

export async function auditBackendEntry(page,artifacts,{base,token,metrics}){
 const directory=path.join(artifacts,'backend-entry');await fs.mkdir(directory,{recursive:true});
 const checks=[];const check=async(name,fn)=>{try{await fn();checks.push(name);console.log('PASS '+name);}catch(error){
   await page.screenshot({path:path.join(directory,'failure.png')});
   console.error(JSON.stringify({fixtureCheck:name,ui:await page.evaluate(()=>({model:document.querySelector('#chatModel').value,title:document.querySelector('#threadTitle').textContent,prompt:document.querySelector('#prompt').value,sendDisabled:document.querySelector('#sendBtn').disabled,stopHidden:document.querySelector('#stopBtn').hidden,events:document.querySelector('#events').textContent.slice(-1200),toast:document.querySelector('.toast')?.textContent})),counts:await fs.readFile(metrics,'utf8').catch(()=>null)}));throw error;
 }};
 const drawer=async()=>{if(!await page.locator('#sidebar').evaluate(n=>n.classList.contains('open')))await page.locator(await page.locator('#mobileDrawer').isVisible()?'#mobileDrawer':'#openDrawer').click();};
 const choose=async label=>{await drawer();await page.locator('#harnessBtn').click();await page.locator('.harness-option').filter({hasText:label}).click();};
 const send=async text=>{await page.locator('#prompt').fill(text);await page.locator('#sendBtn').click();};
 const fresh=async()=>{await drawer();await page.locator('#newThreadBtn').click();if(!await page.locator('#chatProject').inputValue()){await page.locator('#chatProject + .custom-select').click();await page.locator('.choice-dialog .choice-option').filter({hasText:'Atlas Workspace'}).click();}};
 await page.goto(base+'/console');await page.locator('#welcomeConnect').click();await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
 const catalog=await fetch(base+'/api/models?agents=all',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 assert(catalog.backends.find(b=>b.agent==='claude').available);assert(catalog.backends.find(b=>b.agent==='antigravity').available);
 await check('LAN Claude launches, reports its actual model, resumes and restores saved history after reload',async()=>{
   await choose('Claude Code');await fresh();
   await send('START');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('claude fixture started')&&document.querySelector('#stopBtn').hidden);
   await page.waitForFunction(()=>document.querySelector('#backendNotice').textContent.includes('grok-fixture'));
   for(const viewport of [{width:1440,height:960},{width:390,height:844}]){
     await page.setViewportSize(viewport);
     await page.waitForFunction(()=>window.innerWidth>760||!document.body.classList.contains('sidebar-expanded'));
     await page.waitForFunction(()=>!document.querySelector('#main').getAnimations().some(a=>a.playState==='running'));
     const layout=await page.evaluate(()=>{const notice=document.querySelector('#backendNotice'),composer=document.querySelector('#composer'),n=notice.getBoundingClientRect(),c=composer.getBoundingClientRect();notice.hidden=true;const composerWithoutNoticeHeight=composer.getBoundingClientRect().height;notice.hidden=false;return {noticeWidth:n.width,noticeBottom:n.bottom,noticeHeight:n.height,composerWidth:c.width,composerTop:c.top,composerHeight:c.height,composerWithoutNoticeHeight}});
     assert(layout.noticeWidth>=layout.composerWidth-1,'backend notice spans the composer width');
     assert(layout.noticeBottom<=layout.composerTop+1,'backend notice sits above the input grid');
     assert(layout.noticeHeight<64&&Math.abs(layout.composerHeight-layout.composerWithoutNoticeHeight)<1,'backend notice must not stretch the input into a tall narrow column: '+JSON.stringify(layout));
     if(viewport.width===390)await page.screenshot({path:path.join(directory,'claude-model-mobile.png')});
   }
   await page.setViewportSize({width:1440,height:960});
   await page.waitForFunction(()=>!document.querySelector('#main').getAnimations().some(a=>a.playState==='running'));
   const id=await page.locator('#threadTitle').innerText();await page.screenshot({path:path.join(directory,'claude-model-desktop.png')});
   await send('CONTINUE');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('claude fixture resumed'));
   await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');await drawer();await page.locator('#threads .thread-row').filter({hasText:id}).first().click();
   await page.waitForFunction(()=>document.querySelector('#backendNotice').textContent.includes('grok-fixture'));
   assert.equal(await page.locator('#threadTitle').innerText(),id);await page.locator('#stopBtn').waitFor({state:'hidden'});
 });
 await check('Claude owned mock turn stops without a stale running state and provider failure remains explicit',async()=>{
   await send('SLOW');await page.locator('#sendBtn[data-action="stop"]').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('waiting'));await page.locator('#sendBtn').click();await page.waitForFunction(()=>document.querySelector('#sendBtn').dataset.action!=='stop'&&document.querySelector('#sendBtn').getAttribute('aria-busy')!=='true');
   await send('FAIL');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('fixture provider unavailable'));
   await page.screenshot({path:path.join(directory,'claude-error-desktop.png')});
 });
 await check('AGY installed mock backend starts, resumes and labels an unreported actual model',async()=>{
   await choose('Antigravity');await fresh();
   await send('START');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('agy fixture started')&&document.querySelector('#stopBtn').hidden);
   assert.match(await page.locator('#backendNotice').innerText(),/后端回报模型：未提供/);
   await send('CONTINUE');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('agy fixture resumed'));
   await page.waitForFunction(()=>document.querySelector('#sendBtn').dataset.action!=='stop'&&document.querySelector('#sendBtn').getAttribute('aria-busy')!=='true');
   await page.screenshot({path:path.join(directory,'agy-unreported-model.png')});
 });
 await check('AGY long fixture preserves exact head, tail, length and SHA256 in live Web, durable history and reload',async()=>{
   await fresh();const expected='AGY_HEAD|'+Array.from({length:12050},(_,i)=>'段🙂'+i+'|').join('')+'AGY_END';
   const sha=text=>createHash('sha256').update(text).digest('hex');
   await send('LONG');await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('AGY_END')&&document.querySelector('#sendBtn').dataset.action!=='stop',null,{timeout:90000});
   const title=await page.locator('#threadTitle').innerText(),visible=await page.locator('#events .message .markdown p').allTextContents();
   assert.equal(sha(visible.join('')),sha(expected));
   const listing=await fetch(base+'/api/threads',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
   const thread=listing.threads.find(t=>t.id.startsWith('antigravity-')&&t.title===title);assert(thread,'owned long fixture thread must be listed');const id=thread.id;
   const history=await fetch(base+'/api/threads/'+encodeURIComponent(id)+'/events?view=conversation&count=180',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
   const saved=conversationBlocks(history.events,id).filter(b=>b.type==='message.delta').map(b=>b.text).join('');assert.equal(sha(saved),sha(expected));
   await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');await drawer();await page.locator('#threads .thread-row').filter({hasText:title}).first().click();
   await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('AGY_END'),null,{timeout:60000});assert.equal(sha((await page.locator('#events .message .markdown p').allTextContents()).join('')),sha(expected));
   await fs.writeFile(path.join(directory,'agy-integrity.json'),JSON.stringify({threadId:id,chunkCount:12052,utf16Length:expected.length,utf8Bytes:Buffer.byteLength(expected),sha256:sha(expected),liveWeb:true,durableHistory:true,reload:true,realModelRequests:0},null,2));
   await page.screenshot({path:path.join(directory,'agy-long-complete.png')});
 });
 await check('Blocked public capability overrides cached Claude models and explains the existing boundary',async()=>{
   await page.setViewportSize({width:390,height:844});
   await page.route('**/api/models?agents=all',route=>route.fulfill({json:{...catalog,backends:catalog.backends.map(b=>b.agent==='claude'?{...b,available:false,reason:'当前公网入口不支持该助手，请使用已配对的局域网连接'}:b),models:catalog.models.map(m=>m.model.startsWith('claude::')?{...m,available:false,unavailableReason:'当前公网入口不支持该助手'}:m)}}));
   await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');await drawer();await page.locator('#harnessBtn').click();
   const row=page.locator('.harness-option').filter({hasText:'Claude Code'});assert.equal(await row.isDisabled(),true);assert.match(await row.innerText(),/公网不支持/);assert.match(await page.locator('.harness-dialog').innerText(),/已配对的局域网连接/);
   await page.screenshot({path:path.join(directory,'public-boundary-mobile.png')});await page.locator('.harness-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 });
 const counts=JSON.parse(await fs.readFile(metrics,'utf8'));assert.equal(counts.claude,4);assert.equal(counts.agy,3);
 await fs.writeFile(path.join(directory,'results.json'),JSON.stringify({checks,counts,realModelRequests:0,scope:'Actual browser + HTTP/WebSocket gateway + owned Windows mock CLI processes; public UI capability simulated, server refusal covered separately'},null,2));
}
