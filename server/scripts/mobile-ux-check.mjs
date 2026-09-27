import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';

// Exercise the installed Gateway without sending a model task or changing settings.
const config=JSON.parse(await fs.readFile(os.homedir()+'/.codex-mobile-control/server.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:38457/console');
  await page.locator('#welcomeConnect').click();
  await page.locator('#token').fill(config.token);await page.locator('#connectBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('#chatModel option').length>1);
  await page.locator('#prompt').fill('仅验证输入状态，不提交');
  assert.equal(await page.locator('#sendBtn').isDisabled(),false);
  assert.equal(await page.locator('#chatProject').inputValue(),'');
  await page.locator('#prompt').fill('');
  await page.locator('#mobileTitle').click();
  assert.equal(await page.locator('#welcome').isVisible(),true);
  await page.locator('#modelSettingsBtn').click();
  const dialog=page.locator('.model-settings-dialog'),slider=page.locator('#reasoningSlider');
  assert.equal(await dialog.evaluate(n=>getComputedStyle(n).animationName),'surface-enter');
  await dialog.evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  assert.equal(await slider.evaluate(n=>getComputedStyle(n).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
  if(Number(await slider.getAttribute('aria-valuemax'))>0) {
    const track=await page.locator('.reasoning-track').boundingBox();
    await page.touchscreen.tap(track.x,track.y+track.height/2);
    assert.equal(await slider.getAttribute('aria-valuenow'),'0');
    await page.touchscreen.tap(track.x+track.width,track.y+track.height/2);
    assert.equal(await slider.getAttribute('aria-valuenow'),await slider.getAttribute('aria-valuemax'));
    await page.locator('.reasoning-thumb').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  }
  await page.screenshot({path:'../artifacts/mobile-ux-live.png'});
  await page.keyboard.press('Escape');
  await page.locator('#mobileDrawer').click();
  assert.equal(await page.locator('#sidebar').evaluate(n=>getComputedStyle(n).animationName),'drawer-enter');
  await page.locator('#closeDrawer').click();
  await page.setViewportSize({width:320,height:640});
  await page.locator('#modelSettingsBtn').click();
  await dialog.evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  assert.ok(await dialog.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}));
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await dialog.evaluate(n=>getComputedStyle(n).animationName),'none');
  assert.deepEqual(errors,[]);
  console.log('Live Chrome mobile UX passed: optional project, brand entry, touch slider, motion, 320px sheet, reduced motion, no page errors.');
} finally {await browser.close();}
