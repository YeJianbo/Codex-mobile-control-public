import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
const cfg=JSON.parse(await fs.readFile(`${os.homedir()}/.codex-mobile-control/server.json`,'utf8'));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:38457/console');
  await page.locator('#welcomeConnect').click();await page.locator('#token').fill(cfg.token);await page.locator('#connectBtn').click();
  await page.locator('#search').fill('ICONIP');
  await page.locator('.sidebar .thread-row').filter({has:page.getByText('ICONIP',{exact:true})}).first().click();
  await page.locator('.markdown a').filter({hasText:'竖版 PDF'}).last().click();
  try { await page.locator('.output-modal canvas[data-rendered="1"]').waitFor({timeout:30000}); }
  catch(error) { console.log(await page.locator('.output-body').innerText());console.log(errors);throw error; }
  await page.screenshot({path:'../artifacts/iconip-output-preview.png'});
  await page.locator('.output-modal').getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.markdown a').filter({hasText:'横版 PDF'}).last().click();
  await page.locator('.output-modal canvas[data-rendered="1"]').waitFor({timeout:30000});
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('Chrome: both actual ICONIP portrait and landscape PDF links rendered; no page errors.');
} finally {await browser.close();}

