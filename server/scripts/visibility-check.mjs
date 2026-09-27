import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const threadId=process.argv[2];
const expectedUsers=Number(process.argv[3]);
assert.ok(threadId && Number.isInteger(expectedUsers),'Usage: visibility-check.mjs THREAD_ID EXPECTED_USER_MESSAGES');
const config=JSON.parse(await fs.readFile(os.homedir()+'/.codex-mobile-control/server.json','utf8'));
const base='http://127.0.0.1:38457';
const headers={Authorization:'Bearer '+config.token};
const {threads}=await (await fetch(base+'/api/threads',{headers})).json();
const thread=threads.find(item=>item.id===threadId);
assert.ok(thread,'Requested task exists');
assert.equal(threads.filter(item=>item.title===thread.title).length,1,'Task title uniquely identifies the sidebar entry');
const {events}=await (await fetch(base+'/api/threads/'+encodeURIComponent(threadId)+'/events',{headers})).json();
const apiUserMessages=events.filter(event=>event.type==='user.message').length;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/console');
  await page.locator('#welcomeConnect').click();
  await page.locator('#token').fill(config.token);await page.locator('#connectBtn').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='已连接');
  await page.locator('#railSearch').click();await page.locator('#search').fill(thread.title);
  await page.locator('#threads .thread-row').filter({has:page.getByText(thread.title,{exact:true})}).click();
  await page.waitForFunction(count=>document.querySelectorAll('#events .message.user').length===count,expectedUsers);
  assert.equal(await page.locator('#events [data-event-type=warning]').count(),0);
  await page.locator('#closeDrawer').click();
  await page.screenshot({path:fileURLToPath(new URL('../../artifacts/visibility-after.png',import.meta.url))});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({apiUserMessages,visibleUserMessages:expectedUsers,warningsInHistory:events.filter(event=>event.type==='warning').length,visibleWarnings:0,pageErrors:errors.length}));
} finally {await browser.close();}
