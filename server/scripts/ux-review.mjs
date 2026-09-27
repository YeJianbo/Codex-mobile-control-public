import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';

const suffix=process.argv[2] || 'after';
const config=JSON.parse(await fs.readFile(os.homedir()+'/.codex-mobile-control/server.json','utf8'));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const shot=part=>page.screenshot({path:'../artifacts/ux-'+suffix+'-'+name+(part?'-'+part:'')+'.png'});
    await page.goto('http://127.0.0.1:38457/console');
    await page.locator('#welcomeConnect').click();
    await page.locator('#token').fill(config.token);
    await page.locator('#connectBtn').click();
    await page.waitForFunction(()=>document.querySelectorAll('#chatModel option').length>1);
    await page.locator('.sidebar .thread-row').first().waitFor({state:'attached'});
    await page.locator('#chatProject + .custom-select').click();
    await page.locator('.choice-option').filter({hasText:'Codex-mobile-control'}).click();
    const metrics=await page.evaluate(()=>Object.fromEntries(['#prompt','.model-setting-name','.model-setting-effort','.composer-footer'].map(selector=>{
      const node=document.querySelector(selector),css=getComputedStyle(node),rect=node.getBoundingClientRect();
      return [selector,{font:css.fontSize,color:css.color,width:Math.round(rect.width),height:Math.round(rect.height)}];
    })));
    console.log(name,JSON.stringify(metrics));
    assert.equal(await page.locator('.model-settings button').count(),1);
    const originalModel=await page.locator('#chatModel').evaluate(select=>select.selectedOptions[0].textContent);
    const originalEffort=await page.locator('#chatEffort').inputValue();
    await shot('');
    await page.locator('#modelSettingsBtn').click();
    await shot('picker');
    const picker=page.locator('.model-settings-dialog');
    assert.equal(await picker.locator('#chooseChatModel').isVisible(),true);
    assert.equal(await picker.getByRole('slider',{name:'思考强度'}).isVisible(),true);
    const slider=picker.getByRole('slider',{name:'思考强度'});
    await slider.press('Home');
    await slider.press('End');
    assert.equal(await slider.getAttribute('aria-valuenow'),await slider.getAttribute('aria-valuemax'));
    await page.locator('#chooseChatModel').click();
    await shot('models');
    const search=picker.getByRole('searchbox',{name:'搜索模型',exact:true});
    await search.fill('no-such-model-ux-check');
    assert.equal(await picker.locator('.choice-empty').isVisible(),true);
    await search.fill('ecnu-max');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#chatModel').inputValue(),/ecnu-max/);
    assert.equal(await picker.locator('#reasoningSlider').isVisible(),true);
    assert.equal(await page.locator('dialog[open]').count(),1);
    await page.locator('#chooseChatModel').click();
    assert.ok(await picker.evaluate(dialog=>{
      const list=dialog.querySelector('.model-options').getBoundingClientRect();
      const selected=dialog.querySelector('[aria-pressed=true]').getBoundingClientRect();
      return selected.top>=list.top-1&&selected.bottom<=list.bottom+1;
    }));
    await search.fill(originalModel);
    await picker.locator('.choice-option').getByText(originalModel,{exact:true}).click();
    await slider.focus();await slider.press('Home');
    const max=Number(await slider.getAttribute('aria-valuemax'));
    for(let i=0;i<max&&await page.locator('#chatEffort').inputValue()!==originalEffort;i++) await slider.press('ArrowRight');
    assert.equal(await page.locator('#chatEffort').inputValue(),originalEffort);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(),0);
    assert.equal(await page.locator('#modelSettingsBtn').evaluate(node=>document.activeElement===node),true);
    console.log(name+': single model/effort picker, discrete slider, model search and keyboard controls passed.');

    await page.locator(name==='mobile'?'#mobileDrawer':'#openDrawer').click();
    assert.ok(await page.locator('.sidebar-scroll').evaluate(node=>node.getBoundingClientRect().height)>400);
    const sidebar=await page.locator('#sidebar').evaluate(node=>({width:node.getBoundingClientRect().width,font:getComputedStyle(node.querySelector('.sidebar-tools button')).fontSize}));
    assert.equal(sidebar.width,280);assert.equal(sidebar.font,'14px');
    console.log(name+': compact sidebar is 280px wide with 14px labels.');
    if(name==='desktop') {
      assert.equal(await page.locator('#drawerBackdrop').isVisible(),false);
      assert.ok(await page.evaluate(()=>document.querySelector('#main').getBoundingClientRect().left>=document.querySelector('#sidebar').getBoundingClientRect().right));
      await page.locator('.sidebar-tools [data-page=files]').click();
      assert.equal(await page.locator('#sidebar').isVisible(),true);
      await page.locator('#backToChat').click();
    }
    await shot('sidebar');
    await page.locator('#closeDrawer').click();
    await page.locator('#composerTools').click();
    await shot('tools');
    await page.keyboard.press('Escape');
    await page.locator('#prompt').fill('检查当前项目的页面布局。\n保留已有功能，并逐项验证。');
    assert.equal(await page.locator('#composer').evaluate(node=>node.classList.contains('expanded')),true);
    await shot('draft');
    await page.locator('#prompt').fill('');
    if(name==='mobile') {
      for(const viewport of [{width:320,height:640},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        assert.ok(await page.locator('#composer').evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight;}));
        assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('.model-setting-name').getBoundingClientRect().top-document.querySelector('.model-setting-effort').getBoundingClientRect().top)<2));
      }
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
} finally {await browser.close();}
