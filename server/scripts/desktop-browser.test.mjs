import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {DesktopBrowser} from '../src/services/desktopBrowser.ts';

test('browser bridge lists real targets, scales frames, and dispatches input to the selected session',{timeout:10000},async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-browser-'));
  const server=new WebSocketServer({host:'127.0.0.1',port:0}),calls=[];
  await once(server,'listening');
  server.on('connection',socket=>socket.on('message',raw=>{
    const request=JSON.parse(raw.toString());calls.push(request);
    const result={
      'Target.getTargets':{targetInfos:[{type:'page',targetId:'web-1',title:'网页',url:'https://example.com'},{type:'page',targetId:'app-shell',url:'codex://shell'}]},
      'Target.attachToTarget':{sessionId:'session-1'},
      'Page.getLayoutMetrics':{cssVisualViewport:{clientWidth:1920,clientHeight:1080,pageX:0,pageY:0}},
      'Page.captureScreenshot':{data:'fixture-image'},
      'Page.getNavigationHistory':{currentIndex:0,entries:[{id:7,url:'https://example.com',title:'网页'}]},
    }[request.method]??{};
    socket.send(JSON.stringify({id:request.id,result}));
  }));
  try{
    const browser=new DesktopBrowser(path.join(home,'connection.json'));
    await browser.configure(`ws://127.0.0.1:${server.address().port}/devtools/browser/fixture`);
    assert.deepEqual((await browser.tabs()).tabs,[{id:'web-1',title:'网页',url:'https://example.com'}]);
    const frame=await browser.screenshot('web-1');assert.equal(frame.width,1920);assert.equal(frame.data,'fixture-image');
    const capture=calls.find(row=>row.method==='Page.captureScreenshot');assert.equal(capture.sessionId,'session-1');assert.equal(capture.params.clip.scale,1200/1920);
    await browser.action('web-1',{type:'click',x:42,y:96});
    assert.deepEqual(calls.filter(row=>row.method==='Input.dispatchMouseEvent').map(row=>[row.params.type,row.params.x,row.params.y,row.sessionId]),[['mousePressed',42,96,'session-1'],['mouseReleased',42,96,'session-1']]);
    const before=calls.length;await assert.rejects(()=>browser.action('app-shell',{type:'click',x:0,y:0}),/不可控制/);
    assert.equal(calls.slice(before).some(row=>row.method.startsWith('Input.')),false);
    await assert.rejects(()=>browser.action('web-1',{type:'navigate',url:'file:///C:/private'}),/HTTP/);
    await assert.rejects(()=>browser.configure('http://169.254.169.254'),/本机/);
  }finally{
    for(const client of server.clients)client.terminate();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(home),os.tmpdir());await fs.rm(home,{recursive:true,force:true});
  }
});
