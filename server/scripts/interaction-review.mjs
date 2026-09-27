// Validate installed assets; preview the new usage handler without restarting an active Gateway.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {CodexAppServerClient} from '../src/codex/appServerClient.ts';
import {UsageReader} from '../src/services/usage.ts';
const root=path.resolve(import.meta.dirname,'..');
const config=JSON.parse(await fs.readFile(path.join(os.homedir(),'.codex-mobile-control/server.json'),'utf8'));
const codex=new CodexAppServerClient(),usage=new UsageReader(codex);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const width of process.argv.length>2?process.argv.slice(2).map(Number):[390,320,1440]){
    const context=await browser.newContext({viewport:{width,height:width>760?960:844},isMobile:width<760,hasTouch:width<760});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/usage*',async route=>route.fulfill({json:await usage.read(new URL(route.request().url()).searchParams.get('threadId')||undefined)}));
    await page.goto('http://127.0.0.1:38457/console');
    await page.locator('#welcomeConnect').click();await page.locator('#token').fill(config.token);await page.locator('#connectBtn').click();
    await page.locator('.sidebar .thread-row').first().waitFor({state:'attached'});
    if(!await page.locator('#sidebar').isVisible())await page.locator(width<760?'#mobileDrawer':'#openDrawer').click();
    await page.locator('.sidebar .thread-row').filter({hasText:'完全重写'}).first().click();
    await page.locator('#events .message').first().waitFor();
    await page.locator('#prompt').fill('下一步补充说明');
    if(await page.locator('#stopBtn').isVisible()){
      const a=await page.locator('#stopBtn').boundingBox(),b=await page.locator('#sendBtn').boundingBox();assert(a.x+a.width<=b.x+1);
    }
    const rect=await page.locator('#composer').boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);
    await page.screenshot({path:path.join(root,`../artifacts/interaction-after-${width}.png`)});
    await page.locator('#threadMenuBtn').click();await page.getByRole('menuitem',{name:'用量与配额'}).click();
    await page.locator('.usage-tokens').waitFor({timeout:25000});
    assert.equal(await page.locator('.usage-dialog').evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
    await page.screenshot({path:path.join(root,`../artifacts/usage-${width}.png`)});
    if(width===390){await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('#composer')).backgroundColor==='rgb(37, 39, 43)');await page.screenshot({path:path.join(root,'../artifacts/usage-dark.png')});}
    console.log(JSON.stringify({width,pageErrors:errors,quotaWindows:await page.getByRole('meter').count(),tokenFields:await page.locator('.usage-tokens strong').count()}));
    assert.deepEqual(errors,[]);await context.close();
  }
}finally{await browser.close();await codex.stop();}
