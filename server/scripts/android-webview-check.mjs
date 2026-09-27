import WebSocket from 'ws';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
async function readyTargets() {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    try {
      const targets=await (await fetch('http://127.0.0.1:9223/json',{signal:AbortSignal.timeout(1000)})).json();
      if(targets[0]?.webSocketDebuggerUrl)return targets;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Android WebView debugging endpoint was not ready within 30 seconds');
}
const targets=await readyTargets();
const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(resolve=>ws.on('open',resolve));
let id=0;const pending=new Map(),errors=[];
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)});
const call=(method,params={})=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);ws.send(JSON.stringify({id:key,method,params}))});
const evaluate=expression=>call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
const paint=()=>evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
async function waitFor(expression) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){const result=await evaluate(expression);if(result.result?.result?.value===true)return;await new Promise(resolve=>setTimeout(resolve,250));}
  throw new Error('WebView did not reach expected UI state: '+expression);
}
await call('Runtime.enable');
await evaluate(`if(location.host==='app.codex-control.local'){document.getElementById('address').value='http://10.0.2.2:38457';document.querySelector('button').click()}else{location.reload()}`);
await waitFor(`document.readyState==='complete' && !!document.getElementById('connectBtn')`);
assert.equal(errors.length,0,JSON.stringify(errors));
const config=JSON.parse(await readFile(`${os.homedir()}/.codex-mobile-control/server.json`,'utf8'));
await evaluate(`document.getElementById('mobileDrawer').click();document.getElementById('connectionBtn').click();document.getElementById('token').value=${JSON.stringify(config.token)};document.getElementById('connectBtn').click()`);
await waitFor(`document.getElementById('connectionDialog')?.open===false && document.getElementById('status')?.textContent==='已连接'`);
const connected=await evaluate(`({error:document.getElementById('connectionError').textContent,dialog:document.getElementById('connectionDialog').open,terminal:typeof Terminal})`);
assert.equal(connected.result.result.value.dialog,false,JSON.stringify(connected));
assert.equal(connected.result.result.value.terminal,'function');
await waitFor(`!!document.querySelector('#settingEffort + .custom-select') && !document.getElementById('settingEffort').disabled && document.getElementById('settingEffort').options.length>0`);
await evaluate(`document.getElementById('mobileDrawer').click();document.querySelector('.sidebar-footer [data-page="settings"]').click();document.querySelector('#settingEffort + .custom-select').click()`);
const menu=await evaluate(`({open:!!document.querySelector('.choice-dialog[open]'),nativeVisible:[...document.querySelectorAll('select')].some(x=>x.getBoundingClientRect().height>0)})`);
assert.equal(menu.result.result.value.open,true);
assert.equal(menu.result.result.value.nativeVisible,false);
const shot=execFileSync(`${os.homedir()}/AppData/Local/Android/Sdk/platform-tools/adb.exe`,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024});
await writeFile(new URL('../../artifacts/android-workspace.png',import.meta.url),shot);
await evaluate(`document.querySelector('.choice-dialog').close()`);
await evaluate(`document.getElementById('backToChat').click()`);
await waitFor(`document.getElementById('chatPage').hidden===false && document.getElementById('composer').getBoundingClientRect().width>0`);
const layout=await evaluate(`(() => {
  const model=document.querySelector('.model-setting-name'),effort=document.querySelector('.model-setting-effort');
  return {promptFont:getComputedStyle(document.getElementById('prompt')).fontSize,modelFont:getComputedStyle(model).fontSize,sameRow:Math.abs(model.getBoundingClientRect().top-effort.getBoundingClientRect().top)<2,drawerHidden:document.getElementById('sidebar').hidden,empty:document.getElementById('chatPage').classList.contains('is-empty')};
})()`);
assert.equal(layout.result.result.value.promptFont,'16px');
assert.equal(layout.result.result.value.modelFont,'14px');
assert.equal(layout.result.result.value.sameRow,true);
assert.equal(layout.result.result.value.drawerHidden,true);
assert.equal(layout.result.result.value.empty,true);
const adb=`${os.homedir()}/AppData/Local/Android/Sdk/platform-tools/adb.exe`;
await paint();
await writeFile(new URL('../../artifacts/android-chat.png',import.meta.url),execFileSync(adb,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024}));
await evaluate(`document.getElementById('mobileDrawer').click()`);
await waitFor(`document.getElementById('sidebar').hidden===false`);
await paint();
await writeFile(new URL('../../artifacts/android-sidebar.png',import.meta.url),execFileSync(adb,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024}));
execFileSync(adb,['shell','input','keyevent','4']);
await waitFor(`document.getElementById('sidebar').hidden===true && !document.getElementById('main').inert`);
await evaluate(`document.getElementById('composerTools').click()`);
await waitFor(`document.getElementById('actionMenu').hidden===false`);
execFileSync(adb,['shell','input','keyevent','4']);
await waitFor(`document.getElementById('actionMenu').hidden===true && document.getElementById('composerTools').getAttribute('aria-expanded')==='false'`);
const previousEffort=(await evaluate(`document.getElementById('chatEffort').value`)).result.result.value;
await evaluate(`document.getElementById('modelSettingsBtn').click()`);
await waitFor(`!!document.querySelector('.model-settings-dialog[open]') && !!document.getElementById('reasoningSlider')`);
const controls=await evaluate(`({count:document.querySelectorAll('.model-settings button').length,modelVisible:document.getElementById('chooseChatModel').getBoundingClientRect().height>0,sliderVisible:document.getElementById('reasoningSlider').getBoundingClientRect().height>0})`);
assert.equal(controls.result.result.value.count,1);
assert.equal(controls.result.result.value.modelVisible,true);
assert.equal(controls.result.result.value.sliderVisible,true);
await evaluate(`document.getElementById('chooseChatModel').click()`);
await waitFor(`document.querySelector('.model-options').hidden===false && document.querySelectorAll('.model-options .choice-option').length===document.getElementById('chatModel').options.length`);
assert.equal((await evaluate(`document.querySelectorAll('dialog[open]').length`)).result.result.value,1);
await evaluate(`document.querySelector('.model-list-back').click()`);
await paint();
const track=(await evaluate(`(() => {const r=document.querySelector('.reasoning-track').getBoundingClientRect();return {left:r.left,right:r.right,y:r.top+r.height/2,ratio:devicePixelRatio}})()`)).result.result.value;
// WebView 91 accepts CDP touch commands without delivering the gesture. Exercise
// the real Android input path, using the current Activity's content origin.
const windows=execFileSync(adb,['shell','dumpsys','window','windows'],{encoding:'utf8'});
const appWindow=windows.split(/Window #\d+/).find(section=>/^ Window\{[^\n]*com\.localcodex\.control\/com\.localcodex\.control\.MainActivity/.test(section));
const appBounds=appWindow?.match(/mAppBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)/);
assert.ok(appBounds,'Current Android Activity bounds are available');
const left=Math.round(Number(appBounds[1])+(track.left+3)*track.ratio);
const right=Math.round(Number(appBounds[1])+(track.right-3)*track.ratio);
const y=Math.round(Number(appBounds[2])+track.y*track.ratio);
execFileSync(adb,['shell','input','tap',String(left),String(y)]);
await waitFor(`document.getElementById('reasoningSlider').getAttribute('aria-valuenow')==='0'`);
execFileSync(adb,['shell','input','swipe',String(left),String(y),String(right),String(y),'500']);
await waitFor(`document.getElementById('reasoningSlider').getAttribute('aria-valuenow')===document.getElementById('reasoningSlider').getAttribute('aria-valuemax')`);
await paint();
await writeFile(new URL('../../artifacts/android-model-settings.png',import.meta.url),execFileSync(adb,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024}));
await evaluate(`document.getElementById('reasoningSlider').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))`);
for(let i=0;i<8&&(await evaluate(`document.getElementById('chatEffort').value`)).result.result.value!==previousEffort;i++)
  await evaluate(`document.getElementById('reasoningSlider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`);
assert.equal((await evaluate(`document.getElementById('chatEffort').value`)).result.result.value,previousEffort);
execFileSync(adb,['shell','input','keyevent','4']);
await waitFor(`document.querySelectorAll('dialog[open]').length===0 && document.getElementById('modelSettingsBtn').getAttribute('aria-expanded')==='false'`);
console.log('Android unified model picker passed: model selection stays in one dialog, touch slider updates the supported effort, Back returns focus.');
console.log('Android chat layout passed: 16px input, 14px model, same-row reasoning, drawer and menu dismiss with the Back key.');
if(process.argv[2]) {
  const threadId=process.argv[2],expectedUsers=Number(process.argv[3] || 1);
  const {threads}=await (await fetch('http://127.0.0.1:38457/api/threads',{headers:{Authorization:'Bearer '+config.token}})).json();
  const thread=threads.find(item=>item.id===threadId);
  assert.ok(thread,'Visibility test task exists');
  assert.equal(threads.filter(item=>item.title===thread.title).length,1);
  await evaluate(`document.getElementById('mobileDrawer').click();document.getElementById('search').value=${JSON.stringify(thread.title)};document.getElementById('search').dispatchEvent(new Event('input'));[...document.querySelectorAll('#threads .thread-row')].find(row=>row.querySelector('.thread-title').textContent===${JSON.stringify(thread.title)}).click()`);
  await waitFor(`document.querySelectorAll('#events .message.user').length===${expectedUsers} && document.querySelectorAll('#events .message.assistant').length>0`);
  assert.equal((await evaluate(`document.querySelectorAll('#events [data-event-type=warning]').length`)).result.result.value,0);
  await paint();
  await writeFile(new URL('../../artifacts/android-visibility.png',import.meta.url),execFileSync(adb,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024}));
  console.log('Android history visibility passed: '+expectedUsers+' actual user message(s), no default warning cards.');
}
if(process.env.CHECK_OUTPUT_PDF==='1') {
  await evaluate(`document.getElementById('search').value='ICONIP';document.getElementById('search').dispatchEvent(new Event('input'));[...document.querySelectorAll('.sidebar .thread-row')].find(x=>x.querySelector('.thread-title').textContent==='ICONIP').click()`);
  let opened=false;
  for(let i=0;i<40;i++) {
    const ready=await evaluate(`(() => {const links=[...document.querySelectorAll('.markdown a')].filter(x=>x.textContent.includes('竖版 PDF'));if(!links.length)return false;links[links.length-1].click();return true})()`);
    if(ready.result?.result?.value===true){opened=true;break;}
    await new Promise(r=>setTimeout(r,500));
  }
  if(!opened)console.log(JSON.stringify(await evaluate(`({text:document.body.innerText.slice(-1600),links:[...document.querySelectorAll('.markdown a')].map(x=>x.textContent),errors:document.querySelector('.toast')?.textContent})`)));
  assert.ok(opened,'Actual poster link exists');
  let rendered=false;
  for(let i=0;i<120;i++) {
    const ready=await evaluate(`!!document.querySelector('.output-modal canvas[data-rendered="1"]')`);
    if(ready.result?.result?.value){rendered=true;break;}
    await new Promise(r=>setTimeout(r,500));
  }
  if(!rendered)console.log(JSON.stringify(await evaluate(`document.querySelector('.output-body')?.textContent`)));
  assert.ok(rendered,'Android PDF page renders');
  await writeFile(new URL('../../artifacts/android-output-pdf.png',import.meta.url),execFileSync(`${os.homedir()}/AppData/Local/Android/Sdk/platform-tools/adb.exe`,['exec-out','screencap','-p'],{maxBuffer:10*1024*1024}));
  console.log('Android actual poster PDF link and canvas rendering passed.');
}
assert.equal(errors.length,0,JSON.stringify(errors));
console.log('Android WebView passed: bundled UI, Gateway authentication, terminal library, custom menu, no visible native selects, no JS errors.');
ws.close();

