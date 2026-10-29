import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const history=[],commands=[],calls=[];let forks=0,closes=0,sequence=0,unknown=false;
const pageHtml=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/console.css"><main><input aria-label="主会话草稿" value="主会话原草稿"><nav id="tools"></nav><p id="failure"></p></main><script type="module">
import {createThreadTools} from '/console-thread-tools.js';
const state={threadId:'parent',harness:'codex',generation:1,token:'fixture',capabilities:['thread-side-chat','thread-fork','codex-background-terminals','codex-review','desktop-browser']};
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
const button=(label,fn,cls)=>{const n=el('button',cls,label);n.type='button';n.onclick=async()=>{n.disabled=true;try{await fn();}catch(e){document.querySelector('#failure').textContent=e.message;}finally{if(label!=='发送')n.disabled=false;}};return n;};
const iconNode=name=>el('span',null,({'arrow-up':'↑',stop:'■',chat:'◇'})[name]||'');
const api=async(url,options={})=>{const response=await fetch(url,{method:options.method||'GET',headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});if(!response.ok)throw Error('fixture request failed');return response.json();};
const tools=createThreadTools({api,getState:()=>state,openThread:async thread=>{document.body.dataset.opened=thread.id;},refreshThreads:async()=>{},markdownNode:text=>el('div','markdown',text),el,button,iconNode});
for(const [label,fn] of tools.menuItems())document.querySelector('#tools').append(button(label,fn));
</script>`;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(pageHtml);return;}
  if(/^\/[a-z-]+\.(js|css)$/.test(url.pathname)){
    try{res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(publicRoot,url.pathname.slice(1))));}catch{res.writeHead(404).end();}return;
  }
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):undefined;calls.push({path:url.pathname,body});
  let result={ok:true};
  if(url.pathname.endsWith('/fork')){forks++;result={thread:{id:body.ephemeral?'side':'branch'}};}
  else if(url.pathname.endsWith('/events'))result={events:history,status:'idle'};
  else if(url.pathname.endsWith('/submission'))result={submission:{state:unknown?'uncertain':'accepted'}};
  else if(url.pathname.endsWith('/side/close'))closes++;
  else if(url.pathname.endsWith('/background-terminals'))result={data:[{processId:'opaque/process-id',command:'fixture command',cwd:'F:/fixture',cpuPercent:1.2,rssKb:2048}],nextCursor:null};
  else if(url.pathname==='/api/browser/tabs'||url.pathname==='/api/browser/connection')result={available:false,tabs:[],error:'电脑浏览器尚未开放调试连接'};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
});
const wss=new WebSocketServer({server});
wss.on('connection',socket=>{
  socket.send(JSON.stringify({type:'connected'}));
  socket.on('message',raw=>{
    const command=JSON.parse(raw);commands.push(command);if(unknown)return;
    socket.send(JSON.stringify({type:'command.accepted',threadId:'side',requestId:command.requestId}));
    for(const event of [
      {type:'user.message',text:command.text,requestId:command.requestId},
      {type:'turn.started'},
      {type:'reasoning.summary',itemId:'reasoning',text:'fixture thinking'},
      {type:'tool.completed',itemId:'tool',title:'读取文件',text:'fixture output'},
      {type:'message.delta',itemId:'answer',text:'旁支回复'},
      {type:'turn.completed',status:'completed'},
    ]){Object.assign(event,{eventId:'event-'+(++sequence),threadId:'side',turnId:'turn-1'});history.push(event);socket.send(JSON.stringify(event));}
  });
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.getByRole('button',{name:'发起侧聊',exact:true}).click();
  const side=page.getByRole('dialog',{name:'侧聊',exact:true});await side.getByLabel('侧聊消息').fill('旁支问题');
  await side.getByRole('button',{name:'发送',exact:true}).click();await side.getByText('旁支回复',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('主会话草稿').inputValue(),'主会话原草稿');
  await page.getByLabel('主会话草稿').fill('主草稿仍可编辑');
  assert.equal(await side.getByLabel('侧聊消息').inputValue(),'');
  assert.equal(await side.getByText('fixture output',{exact:true}).count(),0);
  await side.locator('summary').first().click();
  await side.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'发起侧聊',exact:true}).click();await side.getByText('旁支回复',{exact:true}).waitFor();assert.equal(forks,1);
  for(const socket of wss.clients)socket.terminate();
  await page.waitForFunction(()=>document.querySelector('.side-status')?.textContent==='已连接');
  assert.equal(await side.getByText('旁支回复',{exact:true}).count(),1);
  unknown=true;await side.getByLabel('侧聊消息').fill('未确认文字');await side.getByRole('button',{name:'发送',exact:true}).click();
  await side.getByRole('button',{name:'核对提交状态',exact:true}).click();await side.getByText('消息提交状态尚未确认，文字已保留',{exact:true}).waitFor();
  assert.equal(await side.getByLabel('侧聊消息').inputValue(),'未确认文字');assert.equal(await side.getByRole('button',{name:'发送',exact:true}).isDisabled(),true);
  await side.getByRole('button',{name:'结束侧聊',exact:true}).click();assert.equal(closes,1);assert.equal(commands.length,2);
  assert.equal(await page.getByLabel('主会话草稿').inputValue(),'主草稿仍可编辑');
  await page.getByRole('button',{name:'创建会话分支',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.opened==='branch');
  await page.getByRole('button',{name:'后台终端',exact:true}).click();const terminals=page.getByRole('dialog',{name:'后台终端'});
  await terminals.getByText('fixture command',{exact:true}).waitFor();await terminals.getByRole('button',{name:'停止',exact:true}).click();
  assert(calls.some(call=>call.path.endsWith('/terminate')&&call.body.processId==='opaque/process-id'));await terminals.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'审阅',exact:true}).click();const review=page.getByRole('dialog',{name:'审阅'});await review.getByLabel('审阅范围').selectOption('custom');await review.getByLabel('审阅目标').fill('检查修改');await review.getByRole('button',{name:'开始审阅',exact:true}).click();
  assert(calls.some(call=>call.path.endsWith('/review')&&call.body.instructions==='检查修改'));
  await page.getByRole('button',{name:'电脑浏览器',exact:true}).click();await page.getByRole('dialog',{name:'电脑浏览器'}).getByText('电脑浏览器尚未开放调试连接',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(await page.locator('#failure').textContent(),'');
  console.log(JSON.stringify({ok:true,sideSend:true,nonmodal:true,reopen:true,reconnect:true,noDuplicateReply:true,unknownSubmissionRetained:true,endIndependent:true,fork:true,terminal:true,review:true,browserUnavailableState:true,pageErrors:errors}));
}finally{
  await browser?.close();for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));
}
