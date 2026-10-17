import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function audit(page,artifacts,{base,token}){
  const directory=path.join(artifacts,'remote-render');await fs.mkdir(directory,{recursive:true});
  const checks=[];
  const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
  const snapshot=(id,title,text,messages=[{role:'assistant',text}])=>({externalId:id,title,updatedAt:new Date(Date.now()-600000).toISOString(),status:'completed',contentKind:'messages',messages});
  const api=async(body)=>{const r=await fetch(base+'/api/cloud-snapshots/import',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,snapshots:body})});assert.equal(r.status,200);};
  const drawer=async()=>{if(!(await page.locator('#sidebar').evaluate(n=>n.classList.contains('open')))){const button=await page.locator('#mobileDrawer').isVisible()?'#mobileDrawer':'#openDrawer';await page.locator(button).click();}};
  const choose=async(title)=>{await drawer();await page.locator('#threads .thread-row').filter({hasText:title}).first().click();};
  const importUI=async(rows)=>{await drawer();await page.locator('#cloudSnapshotImportBtn').click();await page.locator('.snapshot-json').fill(JSON.stringify({schemaVersion:1,snapshots:rows}));await page.locator('.snapshot-import button.button:not(.secondary)').click();};
  await page.goto(base+'/console');
  await page.locator('#welcomeConnect').click();await page.locator('#token').fill(token);await page.locator('#connectBtn').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
  await check('Import opens its own snapshot and visibly forbids controls',async()=>{
    await api([snapshot('newest-unrelated','Unrelated fixture','do not open me')]);
    await importUI([snapshot('ui-a','UI fixture A','FIRST_CURRENT',Array.from({length:200},(_,i)=>({role:i===0?'user':'assistant',text:i===0?'FIRST_CURRENT':`Fixture message ${i}`})))]);
    await page.waitForFunction(()=>document.querySelector('#threadTitle').textContent==='UI fixture A'&&document.querySelector('#events').textContent.includes('FIRST_CURRENT'));
    assert.equal(await page.locator('#events .message').count(),200);
    assert.equal(await page.locator('.composer-wrap').isVisible(),false);
    assert.match(await page.locator('#snapshotNotice').innerText(),/只读快照[\s\S]*已过期/);
    await page.screenshot({path:path.join(directory,'readonly-snapshot.png')});
  });
  await check('First-load error is visible; repeated retry fetches once and recovers empty',async()=>{
    await api([snapshot('ui-b','UI fixture B','',[])]);await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已连接');
    let failed=true,requests=0;
    const pattern='**/api/threads/cloud-snapshot%3Aui-b/events*';
    await page.route(pattern,async route=>{requests++;if(failed)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'isolated history unavailable'})});else {await new Promise(r=>setTimeout(r,200));await route.continue();}});
    await choose('UI fixture B');await page.locator('#historyError').waitFor({state:'visible'});
    assert.equal(await page.locator('#events').getAttribute('aria-busy'),'false');assert.equal(await page.locator('#historyEmpty').isVisible(),false);
    failed=false;const before=requests;await page.locator('#historyRetry').dispatchEvent('click');await page.locator('#historyRetry').dispatchEvent('click');
    await page.locator('#historyEmpty').waitFor({state:'visible'});assert.equal(requests-before,1);assert.equal(await page.locator('#historyError').isVisible(),false);
    await page.unroute(pattern);await page.screenshot({path:path.join(directory,'empty-recovered.png')});
  });
  await check('A to B to A discards a late earlier A response',async()=>{
    let release;const waiting=new Promise(r=>release=r);let first=true,held=false;
    const pattern='**/api/threads/cloud-snapshot%3Aui-a/events*';
    await page.route(pattern,async route=>{if(first){first=false;const response=await route.fetch();const body=await response.json();body.events[0].text='OBSOLETE_OLD_A';held=true;await waiting;await route.fulfill({response,json:body});}else await route.continue();});
    await choose('UI fixture A');await page.waitForFunction(()=>document.querySelector('#threadTitle').textContent==='UI fixture A');
    for(let i=0;i<50&&!held;i++)await page.waitForTimeout(20);assert.ok(held);
    await choose('UI fixture B');await choose('UI fixture A');
    await page.waitForFunction(()=>document.querySelector('#events').textContent.includes('FIRST_CURRENT'));release();await page.waitForTimeout(250);
    assert.equal(await page.locator('#threadTitle').innerText(),'UI fixture A');assert.doesNotMatch(await page.locator('#events').innerText(),/OBSOLETE_OLD_A/);
    assert.equal(await page.locator('#events').getAttribute('aria-busy'),'false');await page.unroute(pattern);
  });
  await check('Canceling a submitted import prevents late navigation',async()=>{
    let release;const waiting=new Promise(r=>release=r);let held=false;
    const pattern='**/api/cloud-snapshots/import';
    await page.route(pattern,async route=>{const response=await route.fetch();held=true;await waiting;await route.fulfill({response});});
    await importUI([snapshot('ui-c','Canceled fixture C','CANCELED_IMPORT_BODY')]);
    for(let i=0;i<50&&!held;i++)await page.waitForTimeout(20);assert.ok(held);
    await page.locator('.snapshot-import button.secondary').click();release();await page.waitForTimeout(400);
    assert.equal(await page.locator('#threadTitle').innerText(),'UI fixture A');assert.equal(await page.locator('.snapshot-import').count(),0);await page.unroute(pattern);
  });
  await fs.writeFile(path.join(directory,'results.json'),JSON.stringify({checks,passed:true,scope:'Installed Chrome rendering against isolated HTTP gateway; no real model requests'},null,2));
}
