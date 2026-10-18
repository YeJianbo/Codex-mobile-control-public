import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {createHash} from 'node:crypto';
import { chromium } from "playwright";
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {backendCliFixtures} from './backend-cli-fixtures.mjs';
import {localFilePath,resolveFileLink} from '../public/file-links.js';
import { createServer as createViteServer } from "vite";
import {
  mergeEvents,
  conversationBlocks,
  validatePreview,
} from "../public/console-core.js";

const root = path.resolve(import.meta.dirname, "..");
const failedChecks=[];
const home = await fs.mkdtemp(path.join(os.tmpdir(), "cmc-web-"));
const codexHome = path.join(home, "codex");
await fs.mkdir(codexHome);
const project = path.join(home, "Atlas Workspace");
const projectlessRoot=path.join(home,'projectless');
await fs.mkdir(project);
// Small valid PDF with visible text; verifies canvas rendering, not just an iframe URL.
const pdfObjects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
const pdfContent='BT /F1 24 Tf 40 200 Td (Output PDF works) Tj ET';
pdfObjects.push(`<< /Length ${pdfContent.length} >>\nstream\n${pdfContent}\nendstream`);
let pdfBytes='%PDF-1.4\n';const offsets=[0];
pdfObjects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdfBytes));pdfBytes+=`${i+1} 0 obj\n${obj}\nendobj\n`});
const xref=Buffer.byteLength(pdfBytes);
pdfBytes+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await fs.writeFile(path.join(project,'输出 文档.pdf'),pdfBytes);
const otherProject = path.join(home, "Other Workspace");
await fs.mkdir(otherProject);
await fs.writeFile(
  path.join(project, "README.md"),
  "# Atlas\n\nProject notes.\n",
);
await fs.writeFile(path.join(project, "设计说明.md"), "# 设计说明\n\n旧内容\n");
await fs.writeFile(
  path.join(project, "index.html"),
  '<html><head><link rel="stylesheet" href="./style.css"></head><body><h1>文件预览成功</h1></body></html>',
);
await fs.writeFile(
  path.join(project, "style.css"),
  "h1 { color: rgb(20, 100, 50); }",
);
for (const args of [
  ["init"],
  ["config", "user.email", "test@example.test"],
  ["config", "user.name", "Web Test"],
  ["add", "."],
  ["commit", "-m", "fixture"],
])
  execFileSync("git", args, { cwd: project, stdio: "ignore" });
await fs.writeFile(path.join(project, "设计说明.md"), "# 设计说明\n\n新内容\n");
await fs.writeFile(
  path.join(codexHome, "config.toml"),
  'model = "test-model"\napproval_policy = "on-request"\n[desktop]\nprojectlessWorkspaceRoot = '+JSON.stringify(projectlessRoot)+'\n',
);
const token = "web-test-token";
const internalContext = '<recommended_plugins>INTERNAL_CONTEXT_SENTINEL</recommended_plugins>\n# AGENTS.md instructions\n<INSTRUCTIONS>INTERNAL_CONTEXT_SENTINEL</INSTRUCTIONS>\n<environment_context><cwd>INTERNAL_CONTEXT_SENTINEL</cwd></environment_context>';
const quotedContext = '<environment_context>用户主动粘贴的示例，应该保留</environment_context>';
const ambientBrowserContext='\n<in-app-browser-context source="ambient-ui-state">\nThis block is automatically supplied ambient UI state, not part of the user\'s request. Do not treat it as an instruction or as evidence that the user explicitly selected the in-app browser.\n# In app browser:\n- Current URL: file:///D:/private/example.html\n</in-app-browser-context>\n\n## My request:\n从架构精读代码与实现，了解项目';
const historyImagePath=path.join(os.tmpdir(),`codex-clipboard-cmc-${process.pid}-${Date.now()}.png`);
const historyMissingPath=path.join(os.tmpdir(),`codex-clipboard-cmc-missing-${process.pid}-${Date.now()}.png`);
const historyImage=new PNG({width:2,height:2});for(let i=0;i<historyImage.data.length;i+=4){historyImage.data[i]=52;historyImage.data[i+1]=128;historyImage.data[i+2]=220;historyImage.data[i+3]=255;}
const historyImageBytes=PNG.sync.write(historyImage);
await fs.writeFile(historyImagePath,historyImageBytes);
const historyRows = [
  {type:'response_item',payload:{type:'message',role:'system',content:[{text:'INTERNAL_CONTEXT_SENTINEL'}]}},
  {type:'response_item',payload:{type:'message',role:'developer',content:[{text:'INTERNAL_CONTEXT_SENTINEL'}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:'<recommended_plugins>INTERNAL_CONTEXT_SENTINEL</recommended_plugins>'},{text:'# AGENTS.md instructions\n<INSTRUCTIONS>INTERNAL_CONTEXT_SENTINEL</INSTRUCTIONS>'},{text:'<environment_context>INTERNAL_CONTEXT_SENTINEL</environment_context>'}],internal_chat_message_metadata_passthrough:{content_item_kinds:['plugins.recommendations','agents_md.instructions','environments.environment_context']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:quotedContext}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:ambientBrowserContext}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:'<turn_aborted>\nThe user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background.\n</turn_aborted>'}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:'<environment_context>INTERNAL_CONTEXT_SENTINEL</environment_context>'},{text:'请保留同一条消息中的正常提问。'}],internal_chat_message_metadata_passthrough:{content_item_kinds:['environments.environment_context','user.text']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:internalContext}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:internalContext+'\n## My request:\n旧会话中的正常提问。'}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{text:`# Files mentioned by the user:\n\n## Image #1: ${historyImagePath}\n\n## My request for Codex:\n查看这张图\n\n<image name=[Image #1] path="${historyImagePath}">\n</image>`}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`# Files mentioned by the user:\n\n## Image #1: ${historyMissingPath}\n\n## My request for Codex:\n查看已清理的临时图片`},{type:'input_image',image_url:`data:image/png;base64,${historyImageBytes.toString('base64')}`}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_image',image_url:`data:image/png;base64,${historyImageBytes.toString('base64')}`}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.image']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'图文嵌入图片'},{type:'input_image',image_url:`data:image/png;base64,${historyImageBytes.toString('base64')}`},{type:'input_image',image_url:`data:image/png;base64,${historyImageBytes.toString('base64')}`}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text','user.image','user.image']}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'内部图片不外显'},{type:'input_image',image_url:`data:image/png;base64,${historyImageBytes.toString('base64')}`}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text','environments.environment_context']}}},
  {type:'response_item',payload:{type:'message',role:'assistant',channel:'analysis',content:[{text:'INTERNAL_REASONING_SENTINEL'}]}},
  {type:'response_item',payload:{type:'reasoning',text:'INTERNAL_REASONING_SENTINEL',summary:[{text:'可见的推理摘要。'}]}},
  {type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'正常回复。'}]}},
];
await fs.mkdir(path.join(codexHome,'sessions'));
await fs.writeFile(path.join(codexHome,'sessions','rollout-history-context-fixture.jsonl'),historyRows.map((row,index)=>JSON.stringify({timestamp:new Date(Date.UTC(2020,0,1,0,0,index)).toISOString(),...row})).join('\n'));
await fs.writeFile(path.join(codexHome,'sessions','rollout-history-context-legacy.jsonl'),[
  {type:'event_msg',payload:{type:'user_message',message:internalContext}},
  {type:'event_msg',payload:{type:'user_message',message:'旧格式正常提问。'}},
  {type:'event_msg',payload:{type:'agent_message',message:'旧格式正常回复。'}},
].map(row=>JSON.stringify(row)).join('\n'));
await fs.writeFile(path.join(codexHome,'sessions','rollout-long-history-fixture.jsonl'),Array.from({length:260},(_,index)=>JSON.stringify({
  timestamp:new Date(Date.UTC(2020,0,2,0,0,index)).toISOString(),
  type:'response_item',payload:{type:'message',role:'user',content:[{text:index===50
    ?`# Files mentioned by the user:\n\n## Image #1: ${historyImagePath}\n\n## My request for Codex:\n历史消息 ${index+1}\n\n<image name=[Image #1] path="${historyImagePath}">\n</image>`
    :`历史消息 ${index+1}`}]},
})).join('\n'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
await fs.writeFile(
  path.join(home, "server.json"),
  JSON.stringify({
    host: "127.0.0.1",
    port,
    token,
    projectRoots: [project, otherProject],
  }),
);
const initialPublicPassword='initial-public-password-for-tests';
await fs.writeFile(path.join(home,'public-access.json'),JSON.stringify({port:48763,publicUrl:'https://phone.example.test',proxySecret:'test-secret-'.repeat(5),passwordSha256:createHash('sha256').update(initialPublicPassword).digest('hex')}));
await fs.writeFile(path.join(home,'public-password.txt'),initialPublicPassword+'\n');
const mock = path.join(home, "mock-codex.mjs");
await fs.writeFile(
  mock,
  `
import readline from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
let goalDb;
function goals(){if(!goalDb){goalDb=new DatabaseSync(path.join(process.env.CODEX_HOME,'goals_1.sqlite'));goalDb.exec('CREATE TABLE IF NOT EXISTS thread_goals(thread_id TEXT PRIMARY KEY,goal_id TEXT,objective TEXT,status TEXT,token_budget INTEGER,tokens_used INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER,time_used_seconds INTEGER)');}return goalDb;}
if(process.argv.includes('--version')){console.log('codex-cli 1.0.0-test');process.exit(0);}
const timers=new Map();const writerOnce=new Set();let count=0;let turnCount=0;let waiting=null;let waitingKind='';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const result=(id,value)=>send({id,result:value});
const notice=(method,params)=>send({method,params});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line);const p=msg.params||{};
 if(msg.method==='model/list') return result(msg.id,{data:['test-model','web-test-model'].map(model=>({model,displayName:model,supportedReasoningEfforts:(model==='test-model'?['low','medium','high']:['medium']).map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'medium'})),nextCursor:null});
 if(!msg.method){if(waiting){
  const valid=waitingKind==='question' ? msg.result?.answers?.style?.answers?.[0]==='简洁'&&msg.result?.answers?.note?.answers?.[0]==='保留细节' : waitingKind==='grant' ? msg.result?.scope==='turn'&&msg.result?.permissions?.network?.enabled===true : waitingKind==='deny' ? msg.result?.scope==='turn'&&Object.keys(msg.result?.permissions||{bad:true}).length===0 : true;
  if(!valid)notice('error',{threadId:waiting,message:'Invalid permission response'});
  else notice('turn/completed',{threadId:waiting,turn:{status:'completed'}});
  waiting=null;waitingKind='';}return;}
 if(msg.method==='initialize')return result(msg.id,{userAgent:'fixture'});
 if(msg.method==='account/rateLimits/read')return result(msg.id,{rateLimits:{planType:'pro',limitId:'codex',primary:{usedPercent:23,windowDurationMins:10080,resetsAt:1900000000},secondary:null}});
 if(msg.method==='initialized')return;
 if(msg.method==='thread/start'){const id='web-thread-'+(++count);setTimeout(()=>result(msg.id,{thread:{id}}),450);return;}
 if(msg.method==='thread/resume')return result(msg.id,{thread:{id:p.threadId}});
 if(msg.method==='thread/read')return result(msg.id,{thread:{id:p.threadId,status:{type:timers.has(p.threadId)||goalDb?.prepare('SELECT status FROM thread_goals WHERE thread_id=?').get(p.threadId)?.status==='active'?'active':'idle'}}});
 if(msg.method==='thread/settings/update'&&goalDb?.prepare('SELECT objective FROM thread_goals WHERE thread_id=?').get(p.threadId)?.objective==='失败后重试目标设置'&&!writerOnce.has('goal-settings:'+p.threadId)){
  writerOnce.add('goal-settings:'+p.threadId);return send({id:msg.id,error:{code:-32600,message:'目标模型设置暂时失败'}});
 }
 if(msg.method==='thread/goal/set'){
  const db=goals(),old=db.prepare('SELECT * FROM thread_goals WHERE thread_id=?').get(p.threadId),now=Date.now();
  db.prepare('INSERT INTO thread_goals VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET objective=excluded.objective,status=excluded.status,updated_at_ms=excluded.updated_at_ms').run(p.threadId,old?.goal_id||'goal-'+p.threadId,p.objective??old?.objective??'',p.status??old?.status??'active',null,0,old?.created_at_ms||now,now,0);
  const row=db.prepare('SELECT * FROM thread_goals WHERE thread_id=?').get(p.threadId);
  if(p.status==='active')notice('turn/started',{threadId:p.threadId,turn:{id:'goal-turn-'+(++turnCount)}});
  return result(msg.id,{goal:{goalId:row.goal_id,objective:row.objective,status:row.status,tokensUsed:row.tokens_used}});
 }

 if(msg.method==='turn/interrupt'){
  if(!p.turnId)return send({id:msg.id,error:{message:'turnId required'}});
  clearInterval(timers.get(p.threadId));timers.delete(p.threadId);notice('turn/completed',{threadId:p.threadId,turn:{status:'interrupted'}});return result(msg.id,{});
 }
 if(msg.method==='turn/start'){
  const text=p.input.find(x=>x.type==='text')?.text || '';
  if(text.includes('失败后重试首条附件消息')&&!writerOnce.has(p.threadId)){writerOnce.add(p.threadId);return send({id:msg.id,error:{code:-32600,message:'首条消息暂时发送失败'}});}
  if(text==='WRITER_QUEUE'&&!writerOnce.has('writer:'+p.threadId)){writerOnce.add('writer:'+p.threadId);return send({id:msg.id,error:{code:-32600,message:'thread already has an active writer'}});}
  const turnId='turn-'+(++turnCount);result(msg.id,{turn:{id:turnId}});notice('turn/started',{threadId:p.threadId,turn:{id:turnId}});
  if(text==='WARNING_TEST')notice('configWarning',{threadId:p.threadId,title:'configWarning',message:'COMPATIBILITY_WARNING_FOR_TEST'});
  if(text==='ERROR_TEST') {
    notice('configWarning',{threadId:p.threadId,title:'configWarning',message:'ANOTHER_HIDDEN_WARNING'});
    notice('error',{threadId:p.threadId,message:'RETRYABLE_FAILURE_FOR_TEST'});
    notice('turn/completed',{threadId:p.threadId,turn:{status:'failed'}});return;
  }
  if(text==='EFFORT_TEST'&&p.effort!=='high')return notice('error',{threadId:p.threadId,message:'Selected effort was not forwarded'});
  if(text==='IMAGE_TEST') {
    if(!p.input.some(x=>x.type==='localImage'&&x.path))return notice('error',{threadId:p.threadId,message:'Image input missing'});
    notice('turn/plan/updated',{threadId:p.threadId,turnId,plan:[{step:'检查上传图片',status:'inProgress'},{step:'整理结果',status:'pending'}]});
    notice('item/reasoning/summaryTextDelta',{threadId:p.threadId,turnId,itemId:'summary',delta:'先核对图片内容，再整理可见信息。'});
    notice('item/reasoning/textDelta',{threadId:p.threadId,turnId,itemId:'hidden',delta:'INTERNAL_REASONING_NOT_FOR_DISPLAY'});
    notice('item/started',{threadId:p.threadId,turnId,item:{id:'image-tool',type:'commandExecution',command:'检查图片尺寸'}});
    notice('item/completed',{threadId:p.threadId,turnId,item:{id:'image-tool',type:'commandExecution',exitCode:0,status:'completed'}});
  }
  if(text==='IMAGE_COUNT_TEST'&&(p.input.filter(x=>x.type==='localImage').length!==9||p.input.some(x=>x.type==='image')))return notice('error',{threadId:p.threadId,message:'Nine local images were not forwarded'});
  notice('thread/status/changed',{threadId:p.threadId,status:{type:'active',activeFlags:[]}});
  if(text.startsWith('PERMISSION_')){waiting=p.threadId;waitingKind=text==='PERMISSION_GRANT'?'grant':'deny';return send({id:9100+turnCount,method:'item/permissions/requestApproval',params:{threadId:p.threadId,turnId,itemId:'permission-'+turnCount,permissions:{network:{enabled:true}},cwd:p.cwd,reason:'Test permission scope'}});}
  if(text==='QUESTION_TEST'){waiting=p.threadId;waitingKind='question';return send({id:9200+turnCount,method:'item/tool/requestUserInput',params:{threadId:p.threadId,turnId,itemId:'question',questions:[{id:'style',header:'风格',question:'选择回答风格',options:[{label:'简洁',description:'简短说明'},{label:'详细',description:'完整解释'}]},{id:'note',header:'补充',question:'补充要求',options:null}],isBlocking:true}});}
  if(text==='APPROVE'){waiting=p.threadId;return send({id:9000,method:'item/commandExecution/requestApproval',params:{threadId:p.threadId,turnId,command:'echo approved',cwd:p.cwd,reason:'Test approval'}});}
  const chunks=text==='SLOW'?Array(40).fill('工作中。'):['## 已检查项目\\n\\n','好','好','，流式消息完整。\\n\\n','- 文件可以继续编辑\\n- 终端实时连接\\n\\n','任务：'+text];
  let i=0;const timer=setInterval(()=>{if(i<chunks.length)notice('item/agentMessage/delta',{threadId:p.threadId,turnId,itemId:turnId+'-message',delta:chunks[i++]});else{clearInterval(timer);timers.delete(p.threadId);notice('turn/completed',{threadId:p.threadId,turn:{status:'completed'}});}},text==='SLOW'?200:35);timers.set(p.threadId,timer);return;
 }
 result(msg.id,{});
});
`,
);
let logs = "";
const backendFixtures=await backendCliFixtures(home);
const gateway = spawn(
  process.execPath,
  [path.join(root, 'dist/index.js')],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      CODEX_MOBILE_CONTROL_AGENTS:'codex,claude,antigravity',
      CODEX_MOBILE_CONTROL_AGY_BIN:backendFixtures.CODEX_MOBILE_CONTROL_AGY_BIN,
      CODEX_MOBILE_CONTROL_CLAUDE_BIN:backendFixtures.CODEX_MOBILE_CONTROL_CLAUDE_BIN,
      CODEX_HOME: codexHome,
      CODEX_MOBILE_CONTROL_HOME: home,
      CODEX_MOBILE_CONTROL_CODEX_BIN: process.execPath,
      CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX: JSON.stringify([mock]),
      CODEX_MOBILE_CONTROL_CODEX_LATEST_VERSION: "1.0.0",
      CODEX_MOBILE_CONTROL_WS_HEARTBEAT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
gateway.stdout.on("data", (b) => (logs += b));
gateway.stderr.on("data", (b) => (logs += b));
const previewServer = http.createServer((req, res) => {
  if (req.url === "/style.css") {
    res.setHeader("content-type", "text/css");
    res.end("h1 { color: rgb(20, 100, 50); }");
  } else if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(
      'document.getElementById("previewText").textContent = "Preview scripts loaded";',
    );
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      '<html><head><link rel="stylesheet" href="/style.css"></head><body><h1 id="previewText">Preview</h1><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
const viteRoot = path.join(home, "vite-preview");
await fs.mkdir(viteRoot);
await fs.writeFile(
  path.join(viteRoot, "index.html"),
  '<html><head><meta charset="utf-8"></head><body><h1 id="hmrTitle"></h1><input id="keepDraft" aria-label="热更新草稿"><button id="fetchButton">请求接口</button><p id="apiResult"></p><script type="module" src="/main.js"></script></body></html>',
);
const viteModule = (label) =>
  `export const label = ${JSON.stringify(label)};document.querySelector('#hmrTitle').textContent=label;document.querySelector('#fetchButton').onclick=async()=>{const r=await fetch('/api/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:'dynamic-request'})});document.querySelector('#apiResult').textContent=await r.text();};if(import.meta.hot)import.meta.hot.accept(next=>{if(next)document.querySelector('#hmrTitle').textContent=next.label;});`;
await fs.writeFile(path.join(viteRoot, "main.js"), viteModule("热更新之前"));
const vite = await createViteServer({
  cacheDir:path.join(home,"vite-cache"),
  configFile: false,
  root: viteRoot,
  cacheDir: path.join(viteRoot,'node_modules/.vite'),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "echo-test",
      configureServer(server) {
        server.middlewares.use("/api/echo", (req, res) => {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            res.setHeader("Content-Type", "text/plain");
            res.end(req.method + ":" + JSON.parse(body).value);
          });
        });
      },
    },
  ],
});
await vite.listen();
let browser;
let page;
let context;
let checks = 0;
const errors = [];
const artifacts = path.join(root, "..", "artifacts");
await fs.mkdir(artifacts, { recursive: true });
try {
  await eventually(async () =>
    assert.equal((await fetch(base + "/health")).status, 200),
  );
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  let executablePath;
  for (const candidate of candidates)
    if (
      await fs.access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      executablePath = candidate;
      break;
    }
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if(process.env.CMC_WEB_IMAGE_COUNT_ONLY==='1'){
    await (await import('./web-composer-transfer.mjs')).auditImageCount(page,artifacts,{base,token});
    checks++;
  }else if(process.env.CMC_WEB_TEXT_TYPES_ONLY==='1'){
    await (await import('./web-upload-preview.mjs')).auditTextTypes(page,artifacts,{base,token});
    checks++;
  }else if(process.env.CMC_WEB_TEXT_ENCODING_ONLY==='1'){
    await (await import('./web-upload-preview.mjs')).auditTextEncoding(page,artifacts,{base,token});
    checks++;
  }else if(process.env.CMC_WEB_UPLOAD_MIME_ONLY==='1'){
    await (await import('./web-upload-preview.mjs')).auditUploadMime(page,artifacts,{base,token,pdfBytes});
    checks++;
  }else if(process.env.CMC_WEB_COMPOSER_TRANSFER_ONLY==='1'){
    await (await import('./web-composer-transfer.mjs')).auditComposerTransfer(page,artifacts,{base,token});
    checks++;
  }else if(process.env.CMC_WEB_OUTPUT_LINKS_ONLY==='1'){
    await (await import('./web-output-links.mjs')).auditOutputLinks(page,artifacts,{base,token,pdfBytes,home});
    checks++;
  }else if(process.env.CMC_WEB_PREVIEW_CONNECTION_ONLY==='1'){
    await (await import('./web-upload-preview.mjs')).auditPreviewConnection(page,artifacts,{base,token,pdfBytes});
    checks++;
  }else if(process.env.CMC_WEB_UPLOAD_PREVIEW_ONLY==='1'){
    await (await import('./web-upload-preview.mjs')).auditUploadedPreview(page,artifacts,{base,token,pdfBytes});
    checks++;
  }else if(process.env.CMC_WEB_UPLOAD_ONLY==='1'){
    await (await import('./web-upload-recovery.mjs')).auditUploadRecovery(page,artifacts,{base,token});
    checks++;
  }else if(process.env.CMC_WEB_FUNCTIONS_ONLY==='1'){
    await (await import('./web-attachments.mjs')).auditAttachments(page,artifacts,{base,token});
    await (await import('./web-goal-command.mjs')).auditGoalCommand(page,artifacts,{base,token});
    checks+=3;
  }else if(process.env.CMC_WEB_BACKEND_ONLY==='1'){
    await (await import('./backend-entry-web.mjs')).auditBackendEntry(page,artifacts,{base,token,metrics:backendFixtures.metrics});
    checks++;
  }else if(['1','subagents'].includes(process.env.CMC_WEB_HARNESS_PARITY_ONLY)){
    if(process.env.CMC_WEB_HARNESS_PARITY_ONLY==='1'){
    await check('云端快照导入、重试与切换恢复',async()=>{
      const isolated=await browser.newContext({viewport:{width:390,height:844}});
      try{await (await import('./remote-render-audit.mjs')).audit(await isolated.newPage(),artifacts,{base,token});}finally{await isolated.close();}
    });
    await check('Harness 模型、续聊、停止与公网开关',async()=>{
      const isolated=await browser.newContext({viewport:{width:1440,height:960}});
      try{await (await import('./backend-entry-web.mjs')).auditBackendEntry(await isolated.newPage(),artifacts,{base,token,metrics:backendFixtures.metrics});}finally{await isolated.close();}
    });
    }
  }else{
  await check("事件去重保留重复增量", async () => {
    const repeated = [
      { type: "message.delta", threadId: "a", eventId: "1", text: "好" },
      { type: "message.delta", threadId: "a", eventId: "2", text: "好" },
    ];
    assert.equal(
      conversationBlocks(mergeEvents(repeated, repeated), "a")[0].text,
      "好好",
    );
    const withWarning=[repeated[0],{type:'warning',threadId:'a',title:'兼容性提示'},repeated[1]];
    assert.equal(conversationBlocks(withWarning,'a')[0].text,'好好');
    assert.equal(conversationBlocks(withWarning,'a',{showWarnings:true}).some(event=>event.type==='warning'),true);
    assert.throws(() => validatePreview("https://example.com"));
    const baseEvent={type:'user.message',threadId:'a'};
    const visible=conversationBlocks([
      {...baseEvent,eventId:'history:a:1',text:internalContext},
      {...baseEvent,eventId:'history:a:2',text:internalContext+'\n## My request:\n正常提问'},
      {...baseEvent,eventId:'history:a:3',text:quotedContext,userVisible:true},
      {...baseEvent,eventId:'history:a:4',text:ambientBrowserContext,userVisible:true},
    ],'a');
    assert.deepEqual(visible.map(event=>event.text),['正常提问',quotedContext,'从架构精读代码与实现，了解项目']);
  });
  await check("无凭据首页与错误登录", async () => {
    await page.goto(base + "/console");
    await page.locator("#welcomeConnect").click();
    await page.locator("#token").fill("invalid");
    await page.locator("#connectBtn").click();
    await page.locator("#connectionError").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#connectionError").innerText(),
      /无效|撤销/,
    );
    await fit(page, [".topbar", "#composer", ".composer-footer"]);
  });
  await check('历史接口过滤内部上下文并保留真实提问',async()=>{
    const result=await (await fetch(base+'/api/threads/history-context-fixture/events',{headers:{Authorization:'Bearer '+token}})).json();
    assert.deepEqual(result.events.filter(event=>event.type==='user.message').map(event=>event.text),[quotedContext,'从架构精读代码与实现，了解项目','请保留同一条消息中的正常提问。','旧会话中的正常提问。','查看这张图','查看已清理的临时图片','','图文嵌入图片','内部图片不外显']);
    const picture=result.events.find(event=>event.type==='user.message'&&event.text==='查看这张图');
    assert.equal(picture.attachments?.[0]?.name,'Image #1');
    assert.equal(picture.attachments.length,1,'文件标题和 image 标签指向同一张图时不重复显示');
    assert.ok(picture.attachments?.[0]?.url?.startsWith('/api/threads/history-context-fixture/history-image?'));
    const imageResponse=await fetch(base+picture.attachments[0].url,{headers:{Authorization:'Bearer '+token}});
    assert.equal(imageResponse.status,200);
    assert.equal(imageResponse.headers.get('content-type'),'image/png');
    assert.equal(PNG.sync.read(Buffer.from(await imageResponse.arrayBuffer())).width,2);
    const recovered=result.events.find(event=>event.type==='user.message'&&event.text==='查看已清理的临时图片');
    const recoveredResponse=await fetch(base+recovered.attachments[0].url,{headers:{Authorization:'Bearer '+token}});
    assert.equal(recoveredResponse.status,200,'临时文件丢失后应读取会话中附带的图片');
    assert.deepEqual(Buffer.from(await recoveredResponse.arrayBuffer()),historyImageBytes);
    const imageOnly=result.events.find(event=>event.type==='user.message'&&event.text===''&&event.attachments?.length===1);
    assert.ok(imageOnly?.attachments?.[0]?.url,'无文字图片也应出现在历史记录');
    const imageOnlyResponse=await fetch(base+imageOnly.attachments[0].url,{headers:{Authorization:'Bearer '+token}});
    assert.equal(imageOnlyResponse.status,200);
    assert.deepEqual(Buffer.from(await imageOnlyResponse.arrayBuffer()),historyImageBytes);
    const mixed=result.events.find(event=>event.type==='user.message'&&event.text==='图文嵌入图片');
    assert.equal(mixed.attachments?.length,2,'没有文件路径的多张嵌入图片也应保留');
    for(const attachment of mixed.attachments){
      const image=await fetch(base+attachment.url,{headers:{Authorization:'Bearer '+token}});
      assert.equal(image.status,200);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()),historyImageBytes);
    }
    assert.equal(result.events.find(event=>event.type==='user.message'&&event.text==='内部图片不外显')?.attachments,undefined);
    const older=await (await fetch(base+'/api/threads/long-history-fixture/events?count=260',{headers:{Authorization:'Bearer '+token}})).json();
    const olderImage=older.events.find(event=>event.type==='user.message'&&event.text==='历史消息 51');
    assert.ok(olderImage?.attachments?.[0]?.url,'分页后的旧图片应有下载地址');
    const olderResponse=await fetch(base+olderImage.attachments[0].url,{headers:{Authorization:'Bearer '+token}});
    assert.equal(olderResponse.status,200,'默认最近历史窗口之外的图片仍须能下载');
    assert.equal(PNG.sync.read(Buffer.from(await olderResponse.arrayBuffer())).width,2);
    assert.doesNotMatch(JSON.stringify(result),/INTERNAL_CONTEXT_SENTINEL|INTERNAL_REASONING_SENTINEL|ambient-ui-state|private\/example.html/);
    assert.equal(result.events.find(event=>event.type==='reasoning.summary').text,'可见的推理摘要。');
    assert.equal(result.events.find(event=>event.type==='message.delta').text,'正常回复。');
    const legacy=await (await fetch(base+'/api/threads/history-context-legacy/events',{headers:{Authorization:'Bearer '+token}})).json();
    assert.deepEqual(legacy.events.map(event=>event.text),['旧格式正常提问。','旧格式正常回复。']);
  });
  await check("连接和项目选择", async () => {
    await page.locator("#token").fill(token);
    await page.locator("#connectBtn").click();
    await page.waitForFunction(
      () => document.getElementById("status").textContent === "已连接",
    );
    await openSidebar(page);
    await page
      .locator("#projects .project-row")
      .filter({ hasText: "Atlas Workspace" })
      .click();
    assert.equal(
      await page.locator("#chatProject").inputValue(),
      await projectId(),
    );
  });

  await check('首页留白、侧栏开合与键盘焦点', async () => {
    assert.equal(await page.locator('#sidebar').isVisible(), true, 'Choosing a project keeps the desktop sidebar expanded');
    assert.equal(await page.locator('#drawerBackdrop').isVisible(), false);
    assert.ok(await page.evaluate(()=>document.getElementById('main').getBoundingClientRect().left>=document.getElementById('sidebar').getBoundingClientRect().right));
    await page.locator('#closeDrawer').click();
    await page.locator('#sidebar').waitFor({state:'hidden'});
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    assert.equal(await page.locator('.nav-rail').isVisible(), true);
    assert.equal(await page.locator('#welcome').isVisible(), true);
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return {title:box('#welcome').bottom,input:box('#composer').top,model:box('.model-settings').top,prompt:box('#prompt').top,rail:box('.nav-rail').width,height:innerHeight};
    });
    assert.equal(layout.rail, 68);
    assert.ok(layout.title < layout.input && layout.input < layout.height * .6);
    assert.ok(Math.abs(layout.model - layout.prompt) < 12, 'Desktop input and model controls share one row');
    await page.locator('#railSearch').click();
    assert.equal(await page.locator('#search').evaluate(node=>document.activeElement===node), true);
    await page.keyboard.press('Escape');
    await page.locator('#sidebar').waitFor({state:'hidden'});
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    assert.equal(await page.locator('#main').evaluate(node=>node.inert), false);
    await page.locator('#composerTools').click();
    assert.equal(await page.getByRole('menuitem',{name:'图片或视频',exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('menuitem',{name:'文件',exact:true}).isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#composerTools').getAttribute('aria-expanded'),'false');
  });
  await check('斜杠命令筛选、帮助与模式切换',async()=>{
    await page.locator('#prompt').fill('/he');
    await page.locator('#slashCommands button').click();
    await page.locator('dialog[open]').getByRole('button',{name:'关闭',exact:true}).click();
    assert.equal(await page.locator('#prompt').inputValue(),'');
    await page.locator('#prompt').fill('/plan');
    await page.locator('#slashCommands button').click();
    assert.equal(await page.locator('#composerModes').innerText(),'计划模式 ×');
    await page.locator('#composerModes button').click();
    assert.equal(await page.locator('#composerModes').isVisible(),false);
    await page.locator('#prompt').fill('/fast');
    await page.locator('#slashCommands button').click();
    assert.equal(await page.locator('#composerModes').innerText(),'快速模式 ×');
    await page.locator('#composerModes button').click();
    await page.locator('#prompt').fill('普通消息 /plan');
    assert.equal(await page.locator('#slashCommands').isVisible(),false);
    await page.locator('#prompt').fill('');
  });
  await check("新会话、Markdown与重复流式文字", async () => {
    await page.locator("#prompt").fill("UI_SMOKE");
    await page.locator("#sendBtn").click();
    await page.waitForFunction(
      () =>
        document
          .getElementById("events")
          .innerText.includes("任务：UI_SMOKE") &&
        document.getElementById("sendBtn").getAttribute("aria-label") === "发送消息",
    );
    assert.equal(await page.locator(".message.user").count(), 1);
    assert.equal(await page.locator('#welcome').isVisible(), false);
    assert.equal(await page.locator('#chatPage').evaluate(node=>node.classList.contains('is-empty')), false);
    assert.ok(await page.locator('#composer').evaluate(node=>node.getBoundingClientRect().bottom>innerHeight*.75));
    assert.match(
      await page.locator(".message.assistant").innerText(),
      /好好，流式消息完整/,
    );
    await page.screenshot({ path: path.join(artifacts, "web-chat.png") });
  });
  await page.waitForFunction(
    () => document.getElementById("threadTitle").textContent === "UI_SMOKE",
  );
  const firstThread = await page.locator("#threadTitle").innerText();
  await check('Codex 目标在运行中显示，暂停和完成后同步状态',async()=>{
    const response=await (await fetch(base+'/api/threads',{headers:{Authorization:'Bearer '+token}})).json();
    const thread=response.threads.find(item=>item.title==='UI_SMOKE');
    assert.ok(thread);
    const db=new DatabaseSync(path.join(codexHome,'goals_1.sqlite'));
    try{
      db.exec('CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY,goal_id TEXT,objective TEXT,status TEXT,token_budget INTEGER,tokens_used INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER,time_used_seconds INTEGER)');
      db.prepare('INSERT INTO thread_goals VALUES(?,?,?,?,?,?,?,?,?)').run(thread.id,'goal-1','检查图片并整理输出','active',null,120,Date.now(),Date.now(),15001);
      await openSidebar(page);await page.locator('#refreshThreads').click();
      await page.locator('#activeGoals .goal-row').filter({hasText:'UI_SMOKE'}).waitFor({state:'detached'});
      await page.locator('.composer-wrap #goalDock').waitFor();
      await page.locator('#goalChipStatus').getByText('已就绪',{exact:true}).waitFor();
      await page.locator('#threadGoal').getByText('目标：检查图片并整理输出',{exact:true}).waitFor();
      assert.equal(await page.locator('#closeGoal').isVisible(),true);
      await page.locator('#threadGoal').click();
      await page.locator('#goalDetails').getByText('检查图片并整理输出',{exact:true}).waitFor();
      assert.equal(await page.locator('#threadGoal').getAttribute('aria-expanded'),'true');
      assert.equal(await page.locator('#editGoal').isVisible(),true);
      assert.equal(await page.locator('#toggleGoal').innerText(),'暂停');
      const pauseStatuses=[];
      let goalRunning=true;
      const continueRequests=[];
      const listRoute=/\/api\/threads(?:\?.*)?$/;
      await page.route(listRoute,route=>route.fulfill({json:{threads:response.threads.map(t=>t.id===thread.id?{...t,status:goalRunning?'running':'interrupted',goal:{goalId:'goal-1',objective:'检查图片并整理输出',status:db.prepare('SELECT status FROM thread_goals WHERE thread_id=?').get(thread.id).status,tokensUsed:120,timeUsedSeconds:15001}}:t)}}));
      const historyRoute=`**/api/threads/${thread.id}/events**`;
      const historySnapshot=await (await fetch(base+`/api/threads/${thread.id}/events`,{headers:{Authorization:'Bearer '+token}})).json();
      await page.route(historyRoute,route=>route.fulfill({json:{...historySnapshot,status:goalRunning?'running':'interrupted'}}));
      await page.locator('#refreshThreads').click();
      await page.locator('#activeGoals .goal-row').filter({hasText:'UI_SMOKE'}).waitFor();
      await page.locator('#goalChipStatus').getByText('进行中',{exact:true}).waitFor();
      await page.route(`**/api/threads/${thread.id}/goal`,async route=>{
        const status=route.request().postDataJSON().status;pauseStatuses.push(status);
        db.prepare('UPDATE thread_goals SET status=? WHERE thread_id=?').run(status,thread.id);
        await route.fulfill({json:{goal:{objective:'检查图片并整理输出',status,tokensUsed:120,timeUsedSeconds:15001}}});
      });
      await page.locator('#refreshThreads').click();
      await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='停止任务');
      const initialTime=await page.locator('#goalRunTime').innerText();
      await page.waitForFunction(value=>document.querySelector('#goalRunTime').textContent!==value,initialTime);
      await page.locator('#toggleGoal').click();
      await page.waitForFunction(()=>document.querySelector('#toggleGoal').textContent==='继续');
      const pausedTime=await page.locator('#goalRunTime').innerText();
      assert.notEqual(pausedTime,initialTime,'pausing must retain elapsed time when the patch reply omits the goal ID');
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('#goalRunTime').innerText(),pausedTime);
      await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='停止任务');
      assert.equal(await page.locator('#toggleGoal').isEnabled(),false);
      goalRunning=false;
      await page.locator('#refreshThreads').click();
      await page.waitForFunction(()=>!document.querySelector('#toggleGoal').disabled);
      await page.route(`**/api/threads/${thread.id}/goal/continue`,async route=>{
        assert.equal(route.request().method(),'POST');continueRequests.push(route.request().postDataJSON());goalRunning=true;
        db.prepare('UPDATE thread_goals SET status=? WHERE thread_id=?').run('active',thread.id);
        await route.fulfill({status:202,json:{goal:{objective:'检查图片并整理输出',status:'active',tokensUsed:120,timeUsedSeconds:15001}}});
      });
      await page.locator('#toggleGoal').click();
      await page.waitForFunction(()=>document.querySelector('#toggleGoal').textContent==='暂停');
      await page.locator('#toggleGoal').click();
      await page.waitForFunction(()=>document.querySelector('#toggleGoal').textContent==='继续');
      assert.deepEqual(pauseStatuses,['paused','paused']);
      assert.equal(continueRequests.length,1);assert(continueRequests[0].requestId);assert(continueRequests[0].model);
      await page.unroute(`**/api/threads/${thread.id}/goal/continue`);
      await page.unroute(`**/api/threads/${thread.id}/goal`);
      await page.unroute(listRoute);await page.unroute(historyRoute);
      await page.locator('#refreshThreads').click();
      await page.waitForFunction(()=>document.querySelector('#activeGoalsHeading').hidden);
      await page.locator('#goalChipStatus').getByText('已暂停',{exact:true}).waitFor();
      assert.equal(await page.locator('#toggleGoal').innerText(),'继续');
      await page.route(`**/api/threads/${thread.id}/goal`,async route=>{
        db.prepare('UPDATE thread_goals SET status=? WHERE thread_id=?').run('complete',thread.id);
        await route.continue();
      });
      await page.locator('#closeGoal').click();
      await page.waitForFunction(()=>document.querySelector('#goalDock').hidden);
      await page.locator('#activeGoals .goal-row').filter({hasText:'UI_SMOKE'}).waitFor({state:'detached'});
      await page.unroute(`**/api/threads/${thread.id}/goal`);
    }finally{db.close()}
  });
  await check("后台会话不会抢焦点或混入消息", async () => {
    const other = await context.newPage();
    await login(other);
    await openSidebar(other);
    await other
      .locator("#projects .project-row")
      .filter({ hasText: "Other Workspace" })
      .click();
    await other.locator("#prompt").fill("BACKGROUND_ONLY");
    await other.locator("#sendBtn").click();
    await other.waitForFunction(() =>
      document
        .getElementById("events")
        .innerText.includes("任务：BACKGROUND_ONLY"),
    );
    assert.equal(await page.locator("#threadTitle").innerText(), firstThread);
    assert.doesNotMatch(
      await page.locator("#events").innerText(),
      /BACKGROUND_ONLY/,
    );
    await other.close();
  });
  await check("阅读历史时轮询和流式更新保持位置，回到底部恢复跟随", async () => {
    // Use a separate browser context for viewport/keyboard resizing, so Chromium
    // does not retain the resized tab's iframe hit-test surface on the main page.
    const readingContext=await browser.newContext({viewport:{width:1440,height:960}});
    const reader = await readingContext.newPage();
    await login(reader);
    await openSidebar(reader);
    await reader.locator('#projects .project-row').filter({hasText:'Other Workspace'}).click();
    await reader.locator('#prompt').fill(Array.from({length:60},(_,i)=>`历史段落 ${i}：用于检查阅读位置。`).join('\n\n'));
    await reader.locator('#sendBtn').click();
    await reader.waitForFunction(()=>document.querySelector('#events').innerText.includes('任务：') && document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
    const position = () => reader.locator('#conversationScroll').evaluate(n=>({top:n.scrollTop,gap:n.scrollHeight-n.clientHeight-n.scrollTop}));
    await reader.waitForFunction(()=>{const n=document.querySelector('#conversationScroll');return n.scrollHeight-n.clientHeight-n.scrollTop<100;},null,{timeout:1500});
    assert.ok((await position()).gap < 100);
    await reader.locator('#events').evaluate(n=>{
      n.style.minHeight=`${n.offsetHeight+240}px`;
      document.querySelector('#conversationScroll').dispatchEvent(new Event('scroll'));
    });
    await reader.waitForTimeout(100);
    assert.ok((await position()).gap<100,'Layout-driven scroll keeps automatic following');
    await reader.locator('#events').evaluate(n=>n.style.minHeight='');
    await reader.locator('#conversationScroll').hover();
    await reader.mouse.wheel(0,-20000);
    await reader.waitForTimeout(250);
    await reader.locator('#conversationScroll').evaluate(n=>n.scrollTop=250);
    const poll = reader.waitForResponse(r=>r.url().includes('/events') && r.request().method()==='GET');
    await poll;
    await reader.waitForTimeout(300);
    assert.ok(Math.abs((await position()).top-250)<3,'Background history refresh preserves scroll position');
    await reader.locator('#prompt').fill('SLOW');
    await reader.locator('#sendBtn').click();
    await reader.waitForFunction(()=>document.querySelector('#events').innerText.includes('工作中。工作中。'));
    assert.ok(Math.abs((await position()).top-250)<3,'Streaming preserves reading position');
    const userNode=await reader.locator('#events .message.user').first().elementHandle();
    await reader.setViewportSize({width:390,height:700});
    await reader.locator('#conversationScroll').evaluate(n=>n.scrollTop=320);
    await reader.waitForTimeout(700);
    assert.ok(Math.abs((await position()).top-320)<3,'Mobile streaming preserves reading position');
    assert.ok(await userNode.evaluate(n=>n.isConnected),'Unchanged message DOM survives streaming and viewport changes');
    await reader.setViewportSize({width:390,height:480});
    await reader.waitForTimeout(200);
    assert.ok(Math.abs((await position()).top-320)<3,'Keyboard-sized viewport does not pull history to bottom');
    await reader.locator('#conversationScroll').hover();
    await reader.mouse.wheel(0,20000);
    await reader.waitForFunction(()=>{const n=document.querySelector('#conversationScroll');return n.scrollHeight-n.clientHeight-n.scrollTop<8});
    await reader.waitForTimeout(600);
    assert.ok((await position()).gap<100,'Manual scroll to bottom resumes following streamed messages');
    await reader.mouse.wheel(0,-400);
    await reader.locator('#jumpLatest').waitFor({state:'visible'});
    await reader.locator('#jumpLatest').click();
    await reader.waitForTimeout(700);
    const jumpPosition=await position();
    assert.ok(jumpPosition.gap<100,`Jump to latest reaches the bottom (gap=${jumpPosition.gap}, top=${jumpPosition.top})`);
    await reader.waitForTimeout(600);
    assert.ok((await position()).gap<100,'Streaming follows when at the bottom');
    await reader.locator('#sendBtn').click();
    await readingContext.close();
    await page.bringToFront();
  });
  await check("停止真实协议中的当前 turn", async () => {
    await page.locator("#prompt").fill("SLOW");
    await page.locator("#sendBtn").click();
    await page.waitForFunction(
      () =>
        document.getElementById("sendBtn").getAttribute("aria-label") ===
        "停止任务",
    );
    await openSidebar(page);
    await page.locator('#refreshThreads').click();
    await page.locator('#activeGoals .thread-row.running').first().waitFor();
    await page.locator('#prompt').fill('下一步继续检查');
    await page.locator('#prompt').press('Enter');
    await page.locator('#followupQueue .queued-text').filter({hasText:'下一步继续检查'}).waitFor();
    assert.doesNotMatch(await page.locator('#followupQueue .queued-message').first().innerText(),/待发/);
    assert.equal(await page.locator('#sendBtn').getAttribute('aria-label'),'停止任务');
    assert.equal(await page.locator('#prompt').inputValue(),'');
    await page.getByRole('button',{name:'待发消息操作'}).click();
    await page.getByRole('menuitem',{name:'取消发送'}).click();
    await page.waitForFunction(()=>document.querySelector('#followupQueue').hidden);
    await page.locator("#sendBtn").click();
    await page.waitForFunction(
      () =>
        document.getElementById("sendBtn").getAttribute("aria-label") ===
        "发送消息",
    );
    await page.locator('#refreshThreads').click();
    await page.waitForFunction(()=>!document.querySelector('#threads .thread-row.active.running'),null,{timeout:5000});
  });
  await check('待发消息连同图片文件撤回输入框后可修改并重新发送',async()=>{
    await page.locator('#prompt').fill('SLOW');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='停止任务');
    const picture=PNG.sync.write(new PNG({width:2,height:2}));
    await page.locator('#imageInput').setInputFiles({name:'队列图片.png',mimeType:'image/png',buffer:picture});
    await page.locator('#imageDrafts img').waitFor();
    await page.waitForFunction(()=>document.querySelector('#uploadFeedback').hidden);
    await page.locator('#fileInput').setInputFiles({name:'队列文件.txt',mimeType:'text/plain',buffer:Buffer.from('queued file')});
    await page.locator('#fileDrafts .file-attachment').waitFor();
    await page.locator('#prompt').fill('待修改的队列内容');
    await page.locator('#sendBtn').click();
    await page.locator('#followupQueue .queued-text').filter({hasText:'待修改的队列内容'}).waitFor();
    await page.getByRole('button',{name:'待发消息操作'}).click();
    await page.getByRole('menuitem',{name:'编辑消息'}).click();
    await page.waitForFunction(()=>document.querySelector('#followupQueue').hidden);
    assert.equal(await page.locator('#prompt').inputValue(),'待修改的队列内容');
    await page.locator('#imageDrafts img').waitFor();
    await page.locator('#fileDrafts .file-attachment').waitFor();
    await page.locator('#fileDrafts .image-remove').click();
    await page.locator('#prompt').fill('队列编辑后自动执行');
    await page.locator('#sendBtn').click();
    await page.locator('#events .message.user').filter({hasText:'队列编辑后自动执行'}).waitFor({timeout:20000});
    await page.waitForFunction(()=>document.querySelector('#followupQueue').hidden);
    assert.equal(await page.locator('#events .message.user').filter({hasText:'队列编辑后自动执行'}).count(),1);
    assert.equal(await page.locator('#events .message.user').filter({hasText:'队列编辑后自动执行'}).locator('img').count(),1);
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
  });
  await check('桌面写入冲突自动排队并在释放后发送',async()=>{
    await page.locator('#prompt').fill('WRITER_QUEUE');
    await page.locator('#sendBtn').click();
    await page.locator('#followupQueue .queued-text').filter({hasText:'WRITER_QUEUE'}).waitFor();
    assert.equal(await page.locator('#prompt').inputValue(),'');
    await page.locator('.message.assistant').filter({hasText:'任务：WRITER_QUEUE'}).waitFor({timeout:25000});
    await page.waitForFunction(()=>document.querySelector('#followupQueue').hidden);
    assert.equal(await page.locator('#events .message.user').filter({hasText:'WRITER_QUEUE'}).count(),1);
  });
  await check('中文输入法确认不会提交消息',async()=>{
    await page.locator('#prompt').fill('还在输入中文');
    await page.locator('#prompt').evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
    assert.equal(await page.locator('#prompt').inputValue(),'还在输入中文');
    assert.equal(await page.locator('#sendBtn').getAttribute('aria-label'),'发送消息');
    await page.locator('#prompt').fill('');
  });
  await check("审批允许与状态更新", async () => {
    await page.locator("#prompt").fill("APPROVE");
    await page.locator("#sendBtn").click();
    await page.getByRole("button", { name: "允许", exact: true }).click();
    await page.getByRole("heading", { name: "已允许", exact: true }).waitFor();
  });
  await check("权限审批按本次任务授权或拒绝", async () => {
    for (const [prompt, action, label] of [
      ["PERMISSION_GRANT", "允许", "已允许"],
      ["PERMISSION_DENY", "拒绝", "已拒绝"],
    ]) {
      await page.waitForFunction(
        () =>
          document.getElementById("sendBtn").getAttribute("aria-label") === "发送消息",
      );
      await page.locator("#prompt").fill(prompt);
      await page.locator("#sendBtn").click();
      await page
        .locator(".approval-block")
        .last()
        .getByRole("button", { name: action, exact: true })
        .click();
      await page
        .locator(".approval-block")
        .last()
        .getByRole("heading", { name: label, exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.getElementById("sendBtn").getAttribute("aria-label") === "发送消息",
      );
      assert.doesNotMatch(
        await page.locator("#toast").textContent(),
        /Invalid permission/,
      );
    }
  });
  await check('Codex 提问支持选项与自由回答，确认后继续',async()=>{
    await page.locator('#prompt').fill('QUESTION_TEST');await page.locator('#sendBtn').click();
    const card=page.locator('.question-block').last();await card.getByRole('heading',{name:'需要你的回答'}).waitFor();
    assert.equal(await card.getByRole('button',{name:'提交回答'}).isDisabled(),true);
    await card.getByRole('button',{name:'简洁 — 简短说明'}).click();
    await card.getByRole('textbox',{name:'补充要求'}).fill('保留细节');
    await card.getByRole('button',{name:'提交回答'}).click();
    await card.getByRole('heading',{name:'已回答'}).waitFor();
    const reply=page.locator('#events .message.user').filter({hasText:'保留细节'});
    await reply.locator('.reply-question').filter({hasText:'选择回答风格'}).waitFor();
    assert.deepEqual(await reply.locator('.reply-question').allTextContents(),['选择回答风格','补充要求']);
    assert.deepEqual(await reply.locator('.user-bubble-text').allTextContents(),['简洁','保留细节']);
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
  });
  await check('Codex 自定义权限可选择且记忆',async()=>{
    await page.locator('#modelSettingsBtn').click();
    const custom=page.getByRole('button',{name:'自定义 (config.toml)',exact:true});await custom.click();
    await page.locator('.model-settings-close').click();await page.locator('#modelSettingsBtn').click();
    assert.equal(await custom.getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'完全访问',exact:true}).click();await page.locator('.model-settings-close').click();
  });
  await check("文件编辑、取消丢弃与保存", async () => {
    await navigate(page, 'files');
    await chooseProject(page, "filesProject", await projectId());
    await page
      .locator("#files .file-row")
      .filter({ hasText: "README.md" })
      .click();
    await page.locator("#editor").fill("# Atlas\n\nSaved from browser.\n");
    await page
      .locator("#files .file-row")
      .filter({ hasText: "设计说明.md" })
      .click();
    await page.locator("#confirmCancel").click();
    assert.match(
      await page.locator("#editor").inputValue(),
      /Saved from browser/,
    );
    await page.locator("#saveFileBtn").click();
    await eventually(async () =>
      assert.match(
        await fs.readFile(path.join(project, "README.md"), "utf8"),
        /Saved from browser/,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "web-files.png") });
  });
  await check("HTML 文件预览和相对资源", async () => {
    await page
      .locator("#files .file-row")
      .filter({ hasText: "index.html" })
      .click();
    const frame = page.frameLocator("#filePreview iframe");
    await frame.getByRole("heading", { name: "文件预览成功" }).waitFor();
    await eventually(async()=>assert.equal(
      await frame.locator("h1").evaluate((el) => getComputedStyle(el).color),
      "rgb(20, 100, 50)",
    ));
  });
  await check("Git diff、中文路径与暂存", async () => {
    await page.locator("#diffModeBtn").click();
    await page
      .locator("#files .file-row")
      .filter({ hasText: "设计说明.md" })
      .click();
    await page.getByRole("button", { name: "暂存文件", exact: true }).click();
    await eventually(() =>
      assert.match(
        execFileSync("git", ["diff", "--cached", "--name-only"], {
          cwd: project,
          encoding: "utf8",
        }),
        /设计|\\350/,
      ),
    );
    await page
      .locator("#diffView .diff-code")
      .first()
      .waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("diffView").textContent.includes("新内容"),
    );
    await page.screenshot({ path: path.join(artifacts, "web-diff.png") });
  });
  await check("PTY 终端输入、输出及停止", async () => {
    await navigate(page, 'terminal');
    await chooseProject(page, "terminalProject", await projectId());
    await page.locator("#newTerminalBtn").click();
    await page.waitForFunction(
      () => document.getElementById("terminalEmpty").hidden,
    );
    await page
      .locator("#commandInput")
      .fill("Write-Output ('WEB_' + 'TERMINAL_OK')");
    await page.locator("#commandForm button").click();
    await eventually(async () => {
      const data = await json("/api/terminal/commands");
      assert(data.commands.some((c) => c.output.includes("WEB_TERMINAL_OK")));
    });
    await page
      .locator(".xterm-accessibility-tree")
      .getByText("WEB_TERMINAL_OK", { exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(artifacts, "web-terminal.png") });
    await page.locator("#stopTerminalBtn").click();
    await page.waitForFunction(
      () => document.getElementById("stopTerminalBtn").disabled,
    );
  });
  await check("预览代理加载 HTML、CSS 与脚本", async () => {
    await navigate(page, 'preview');
    await page
      .locator("#previewUrl")
      .fill(`http://127.0.0.1:${previewServer.address().port}`);
    await page.locator("#previewForm button").click();
    const frame = page.frameLocator("#preview");
    await frame
      .getByRole("heading", { name: "Preview scripts loaded" })
      .waitFor();
    assert.equal(
      await frame.locator("h1").evaluate((el) => getComputedStyle(el).color),
      "rgb(20, 100, 50)",
    );
    await page.screenshot({ path: path.join(artifacts, "web-preview.png") });
  });
  await check("真实 Vite 动态 POST 和 HMR 保留页面状态", async () => {
    await page
      .locator("#previewUrl")
      .fill(`http://127.0.0.1:${vite.httpServer.address().port}`);
    await page.locator("#previewForm button").click();
    const frame = page.frameLocator("#preview");
    await frame.getByRole("heading", { name: "热更新之前" }).waitFor();
    await frame.locator("#keepDraft").fill("更新时保留这段输入");
    await frame.locator("#fetchButton").click();
    await frame.getByText("POST:dynamic-request", { exact: true }).waitFor();
    await fs.writeFile(
      path.join(viteRoot, "main.js"),
      viteModule("热更新之后"),
    );
    await frame.getByRole("heading", { name: "热更新之后" }).waitFor();
    assert.equal(
      await frame.locator("#keepDraft").inputValue(),
      "更新时保留这段输入",
    );
    await page.screenshot({
      path: path.join(artifacts, "web-preview-hmr.png"),
    });
  });
  await check("设置保存到隔离配置", async () => {
    await navigate(page, 'settings');
    await page.locator('summary').filter({hasText:'助手公网访问'}).click();
    await page.locator('#harnessPublicAccess input').first().waitFor();
    assert.equal(await page.locator('#harnessPublicAccess input').count(),7);
    const publicSwitch=page.locator('#harnessPublicAccess input[data-harness-public=claude]');
    const publicSaved=page.waitForResponse(response=>response.url().endsWith('/api/settings/harness-access')&&response.request().method()==='PUT');
    await publicSwitch.uncheck();assert.equal((await publicSaved).status(),200);
    assert.equal((await json('/api/settings/harness-access')).agents.find(row=>row.agent==='claude').enabled,false);
    await publicSwitch.check();
    await chooseProject(page, "settingModel", "web-test-model");
    await page.locator("#saveSettingsBtn").click();
    await eventually(async () =>
      assert.match(
        await fs.readFile(path.join(codexHome, "config.toml"), "utf8"),
        /web-test-model/,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "web-settings.png") });
  });
  await check('网关设置提供管理入口，公网密码接口不返回密码',async()=>{
    await navigate(page,'settings');
    await page.locator('[data-management-page=access]').waitFor();
    assert.equal((await fs.readFile(path.join(home,'public-password.txt'),'utf8')).trim(),initialPublicPassword);
    const response=await fetch(base+'/api/settings/public-access/password',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({password:'246810'})});
    assert.equal(response.status,200,JSON.stringify(await response.json()));
    await eventually(async()=>assert.equal((await fs.readFile(path.join(home,'public-password.txt'),'utf8')).trim(),'246810'));
    const config=JSON.parse(await fs.readFile(path.join(home,'public-access.json'),'utf8'));
    assert.equal(config.passwordSha256,createHash('sha256').update('246810').digest('hex'));
    const result=await (await fetch(base+'/api/settings/public-access',{headers:{Authorization:`Bearer ${token}`}})).json();
    assert.equal(result.publicAccess.publicUrl,'https://phone.example.test');
    assert.equal(JSON.stringify(result).includes('passwordSha256'),false);
    assert.equal(JSON.stringify(result).includes('246810'),false);
  });
  await check('模型只能选择电脑返回的可见列表',async()=>{
    assert.deepEqual(await page.locator('#chatModel option').evaluateAll(options=>options.map(o=>o.value)),['test-model','web-test-model']);
    assert.equal(await page.locator('input#chatModel,input#settingModel').count(),0);
    const response=await fetch(base+'/api/settings/user',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:'not-in-desktop'})});
    assert.equal(response.ok,false);
  });
  await check('视频和普通文件可上传、发送、回显及分段下载',async()=>{
    await navigate(page,'chat');
    const video=Buffer.alloc(6*1024*1024,0x41);
    await page.locator('#fileInput').setInputFiles({name:'片段.mp4',mimeType:'video/mp4',buffer:video});
    await page.locator('#fileDrafts .file-attachment').waitFor();
    await page.locator('#prompt').fill('检查视频附件');await page.locator('#sendBtn').click();
    await page.locator('.message.user video').last().waitFor();
    const source=await page.locator('.message.user video').last().getAttribute('src');
    const part=await page.request.get(base+source,{headers:{Range:'bytes=10-19'}});
    assert.equal(part.status(),206);assert.equal((await part.body()).length,10);
    assert.equal(part.headers()['content-range'],`bytes 10-19/${video.length}`);
    assert.equal((await page.request.get(base+source.split('?')[0])).status(),401);
  });
  await check('图片上传、对话展示、任务计划和公开推理摘要',async()=>{
    await navigate(page, 'chat');
    const png=new PNG({width:20,height:20});for(let i=0;i<png.data.length;i+=4){png.data[i]=30;png.data[i+1]=120;png.data[i+2]=230;png.data[i+3]=255;}
    const bytes=PNG.sync.write(png);
    await fs.writeFile(path.join(project,'sample.png'),bytes);
    await page.locator('#imageInput').setInputFiles({name:'测试图片.png',mimeType:'image/png',buffer:bytes});
    await page.locator('#imageDrafts img').waitFor();
    await page.evaluate(base64=>{
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const data=new DataTransfer();data.items.add(new File([bytes],'粘贴.png',{type:'image/png'}));
      document.getElementById('prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    },bytes.toString('base64'));
    await page.waitForFunction(()=>document.querySelectorAll('#imageDrafts img').length===2);
    await page.locator('#prompt').fill('IMAGE_TEST');await page.locator('#sendBtn').click();
    await page.locator('.message.user img').last().waitFor();
    // The composer can briefly still be idle before turn/started arrives. Wait
    // for this turn's final response before opening its completed process group.
    await page.locator('.message.assistant').filter({hasText:'任务：IMAGE_TEST'}).last().waitFor();
    await page.waitForFunction(()=>document.getElementById('sendBtn').getAttribute('aria-label')==='发送消息');
    const completed=page.locator('#events details.completed-process').last();
    assert.equal(await completed.getAttribute('open'),null);
    assert.equal(await completed.locator('details.tool-group').count(),0,'collapsed process does not render nested operation details');
    await completed.locator(':scope > summary').click();
    const activity=completed.locator('details.tool-group').last();
    assert.equal(await activity.getAttribute('open'),null);
    await activity.locator(':scope > summary').click();
    await completed.getByText('先核对图片内容，再整理可见信息。',{exact:true}).waitFor();
    await activity.getByText('更新计划',{exact:true}).click();
    await completed.getByText(/进行中 检查上传图片/).waitFor();
    assert.equal(await page.getByText('INTERNAL_REASONING_NOT_FOR_DISPLAY',{exact:true}).count(),0);
    await page.waitForFunction(()=>document.getElementById('status').textContent==='已连接'&&document.getElementById('sendBtn').getAttribute('aria-label')==='发送消息');
    const imageSrc=await page.locator('.message.user img').last().getAttribute('src');
    assert.equal((await page.request.get(base+imageSrc)).status(),200);
    assert.equal((await page.request.get(base+imageSrc.split('?')[0])).status(),401);
    const threadTitle=await page.locator('#threadTitle').innerText();
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='已连接');
    await openSidebar(page);
    await page.locator('#threads .thread-row').filter({has:page.getByText(threadTitle,{exact:true})}).first().click();
    await page.locator('.message.user img').last().waitFor();
    await page.screenshot({path:path.join(artifacts,'web-image-progress.png')});
    await page.locator('#prompt').fill('![输出图片](sample.png)');await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.inline-output-image')].some(img=>img.complete&&img.naturalWidth===20));
  });
  await check('聊天输出文件可点开、PDF渲染和下载',async()=>{
    assert.equal(localFilePath('file:///E:/Code/a%20b.pdf:12'),'E:/Code/a b.pdf');
    assert.equal(localFilePath('README.md:2'),'README.md');
    assert.equal(localFilePath('javascript:alert(1)'),null);
    assert.throws(()=>resolveFileLink('C:/outside.pdf',[{id:'p',path:'C:/project'}],'p'));
    await navigate(page, 'chat');
    const linkPath=path.join(project,'输出 文档.pdf').replaceAll('\\','/');
    await page.locator('#prompt').fill(`[输出 PDF](<${linkPath}>) · [说明文件](README.md:2)`);
    await page.locator('#sendBtn').click();
    const link=page.locator('.markdown a').filter({hasText:'输出 PDF'}).last();
    await link.click();
    await page.locator('.output-modal canvas[data-rendered="1"]').waitFor();
    await page.screenshot({path:path.join(artifacts,'web-output-pdf.png')});
    const downloadEvent=page.waitForEvent('download');
    await page.locator('.output-modal').getByRole('link',{name:'下载',exact:true}).click();
    const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),'输出 文档.pdf');
    const saved=await download.path();
    assert.equal((await fs.readFile(saved,'utf8')).startsWith('%PDF-1.4'),true);
    await page.locator('.output-modal').getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('.markdown a').filter({hasText:'说明文件'}).last().click();
    await page.locator('.output-modal .markdown').getByRole('heading',{name:'Atlas'}).waitFor();
    await page.locator('.output-modal').getByRole('button',{name:'关闭',exact:true}).click();
  });
  await check('电脑一次性登录进入管理后台，配对二维码可扫描',async()=>{
    const pairing=await (await fetch(base+'/api/pair/start',{headers:{Authorization:`Bearer ${token}`}})).json();
    const desktopContext=await browser.newContext();
    const desktop=await desktopContext.newPage();
    await desktop.goto(base+'/console#desktopPair='+pairing.code);
    await desktop.waitForURL(base+'/manage/#access');
    assert.equal(await desktop.evaluate(()=>Boolean(localStorage.getItem('cmc.token'))),true);
    assert.equal(pairing.code.length,6);
    const qr=await desktopContext.newPage();
    await qr.setContent('<main>'+pairing.qrSvg+'</main>');
    const pixels=PNG.sync.read(await qr.locator('svg').screenshot());
    const decoded=jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height);
    assert.ok(decoded,'Displayed pairing QR must be scannable');
    const pairingUrl=new URL(decoded.data);
    assert.equal(pairingUrl.searchParams.get('code'),pairing.code);
    assert.equal(decoded.data,pairing.setupUrl);
    await qr.screenshot({path:path.join(artifacts,'desktop-pairing.png')});
    await desktopContext.close();
  });
  await check("手机窄屏导航、弹窗和主要工作区", async () => {
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    mobile.on("pageerror", (e) => errors.push(e.message));
    await login(mobile);
    await fit(mobile, [".topbar", "#composer", ".composer-footer"]);
    await mobile.screenshot({ path: path.join(artifacts, "web-mobile.png") });
    await openSidebar(mobile);
    await mobile
      .locator("#projects .project-row")
      .filter({ hasText: "Atlas Workspace" })
      .click();
    await navigate(mobile, 'files');
    await chooseProject(mobile, "filesProject", await projectId());
    await mobile
      .locator("#files .file-row")
      .filter({ hasText: "README.md" })
      .click();
    await mobile.locator("#editor").waitFor({ state: "visible" });
    await fit(mobile, [".editor-toolbar", "#editor", ".topbar"]);
    await mobile.screenshot({
      path: path.join(artifacts, "web-mobile-file.png"),
    });
    await mobile.locator("#backToFiles").click();
    await navigate(mobile, 'settings');
    await mobile.screenshot({
      path: path.join(artifacts, "web-mobile-settings.png"),
    });
    await mobile.setViewportSize({ width: 360, height: 640 });
    await navigate(mobile, 'chat');
    await fit(mobile, ["#composer", ".topbar", "#welcome"]);
    await mobile.screenshot({ path: path.join(artifacts, "web-small.png") });
    await mobileContext.close();
  });
  await check("离线恢复与草稿保留", async () => {
    await navigate(page, 'chat');
    await page.locator("#prompt").fill("保留我的草稿");
    await context.setOffline(true);
    await page.waitForFunction(
      () => document.getElementById("status").textContent !== "已连接",
      { timeout: 10000 },
    );
    assert.equal(await page.locator("#prompt").inputValue(), "保留我的草稿");
    await context.setOffline(false);
    await page.waitForFunction(
      () => document.getElementById("status").textContent === "已连接",
      { timeout: 25000 },
    );
    assert.equal(await page.locator("#prompt").inputValue(), "保留我的草稿");
  });
  await check('公式渲染、代码隔离、置顶和项目顺序',async()=>{
    await navigate(page, 'chat');
    await page.locator('#prompt').fill('公式 $E=mc^2$\n\n$$\\frac{a}{b} = \\sum_{i=1}^n i$$\n\n```text\n$do_not_render$\n```');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>document.querySelectorAll('.message.assistant .katex').length>=2);
    assert.equal(await page.locator('.markdown pre .katex').count(),0);
    await page.screenshot({path:path.join(artifacts,'web-math.png')});
    const rows=await (await fetch(base+'/api/threads',{headers:{Authorization:`Bearer ${token}`}})).json();
    await fs.writeFile(path.join(codexHome,'.codex-global-state.json'),JSON.stringify({
      'pinned-thread-ids':[rows.threads[0].id],
      'project-order':['other','atlas'],
      'local-projects':{atlas:{id:'atlas',name:'Atlas Workspace',rootPaths:[project]},other:{id:'other',name:'Other Workspace',rootPaths:[otherProject]}},
    }));
    await page.reload();
    await openSidebar(page);
    await page.locator('#pinnedThreads .thread-row').waitFor();
    await page.waitForFunction(()=>document.querySelector('#projects .project-row')?.textContent.includes('Other Workspace'));
    assert.match(await page.locator('#projects .project-row').first().innerText(),/Other Workspace/);
    const height=await page.locator('.sidebar-scroll').evaluate(node=>node.getBoundingClientRect().height);
    assert.ok(height>400,`Sidebar list should have room: ${height}`);
    await page.screenshot({path:path.join(artifacts,'web-sidebar.png')});
  });
  await check('自绘侧栏折叠、记忆及搜索展开',async()=>{
    await page.locator('[data-collapse=projects]').click();
    assert.equal(await page.locator('#projects').isVisible(),false);
    await page.locator('[data-collapse=pinnedThreads]').click();
    await page.locator('[data-collapse=threads]').click();
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='已连接');
    assert.equal(await page.locator('#sidebar').isVisible(),true,'Desktop expansion persists across reloads');
    assert.equal(await page.locator('#projects').isVisible(),false);
    assert.equal(await page.locator('#pinnedThreads').isVisible(),false);
    assert.equal(await page.locator('#threads').isVisible(),false);
    await page.locator('#sidebarSearchToggle').click();
    await page.locator('#search').fill('Other Workspace');
    assert.equal(await page.locator('#projects').isVisible(),true);
    await page.locator('#search').fill('');
    assert.equal(await page.locator('#projects').isVisible(),false);
    for(const id of ['projects','pinnedThreads','threads'])await page.locator(`[data-collapse=${id}]`).click();
    assert.equal(await page.locator('.sidebar-scroll').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
    assert.equal(await page.locator('#projects').evaluate(el=>getComputedStyle(el).overflowY),'visible');
    await page.screenshot({path:path.join(artifacts,'web-sidebar-folding.png')});
  });
  await check('思考等级按模型映射、发送和记忆',async()=>{
    await page.locator('#pinnedThreads .thread-row').first().click();
    await chooseProject(page,'chatModel','test-model');
    await chooseProject(page,'chatEffort','high');
    await page.locator('#prompt').fill('EFFORT_TEST');await page.locator('#sendBtn').click();
    await page.locator('.message.assistant').filter({hasText:'EFFORT_TEST'}).last().waitFor();
    await chooseProject(page,'chatModel','web-test-model');
    assert.deepEqual(await page.locator('#chatEffort option').evaluateAll(options=>options.map(o=>o.value)),['medium']);
    await chooseProject(page,'chatModel','test-model');
    assert.equal(await page.locator('#chatEffort').inputValue(),'high');
    await page.screenshot({path:path.join(artifacts,'web-thinking-level.png')});
  });
  await check('阅读字号和菜单键盘交互',async()=>{
    const sizes=await page.evaluate(()=>['#prompt','.message.assistant .markdown','.model-setting-name','.model-setting-effort','.composer-footer'].map(selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)));
    assert.ok(sizes[0]>=16&&sizes[1]>=16&&sizes[2]>=14&&sizes[3]>=14&&sizes[4]>=13,`Unreadable sizes: ${sizes}`);
    await page.locator('#modelSettingsBtn').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#chatEffort').inputValue(),'medium');
    await page.locator('#modelSettingsBtn').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.choice-dialog[open]').count(),0);
    assert.equal(await page.locator('#modelSettingsBtn').evaluate(node=>document.activeElement===node),true);
  });
  await check('同一弹层选择模型与拖动思考强度',async()=>{
    assert.equal(await page.locator('.model-settings button').count(),1);
    await page.locator('#modelSettingsBtn').click();
    assert.equal(await page.locator('#chooseChatModel').isVisible(),true);
    assert.equal(await page.getByRole('slider',{name:'思考强度'}).isVisible(),true);
    await page.locator('.model-settings-dialog').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
    const track=await page.locator('.reasoning-track').boundingBox();
    await page.mouse.move(track.x+track.width,track.y+track.height/2);
    await page.mouse.down();
    await page.mouse.move(track.x,track.y+track.height/2,{steps:5});
    await page.mouse.up();
    assert.equal(await page.locator('#chatEffort').inputValue(),'low');
    await page.mouse.click(track.x+track.width,track.y+track.height/2);
    assert.equal(await page.locator('#chatEffort').inputValue(),'high');
    assert.equal(await page.locator('.model-settings-dialog[open]').count(),1);
    await page.screenshot({path:path.join(artifacts,'web-model-settings.png')});
    await page.keyboard.press('Escape');
  });
  await check('模型和思考强度在窄屏保持同组同一行',async()=>{
    for(const width of [360,390]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const bounds=await page.evaluate(()=>{
        const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};
        return {model:rect('.model-setting-name'),effort:rect('.model-setting-effort'),group:rect('.model-settings'),send:rect('#sendBtn'),view:innerWidth};
      });
      assert.ok(Math.abs(bounds.model.top-bounds.effort.top)<2);
      assert.ok(bounds.group.left>=0&&bounds.group.right<=bounds.send.left&&bounds.send.right<=bounds.view,JSON.stringify(bounds));
    }
  });
  await check('运行提示默认隐藏，可在会话菜单中查看',async()=>{
    await page.locator('#prompt').fill('WARNING_TEST');await page.locator('#sendBtn').click();
    await page.locator('.message.assistant').filter({hasText:'任务：WARNING_TEST'}).waitFor();
    assert.equal(await page.locator('#events [data-event-type=warning]').count(),0);
    await page.locator('#threadMenuBtn').click();
    await page.getByRole('menuitem',{name:'显示运行提示',exact:true}).click();
    const warning=page.locator('#events [data-event-type=warning]').last();
    await warning.locator('summary').click();
    await warning.locator('pre').waitFor({state:'visible'});
    assert.equal(await warning.locator('pre').isVisible(),true);
    assert.equal(await warning.locator('pre').innerText(),'COMPATIBILITY_WARNING_FOR_TEST');
    assert.equal(await page.evaluate(()=>localStorage.getItem('cmc.showWarnings')),'true');
    await page.locator('#threadMenuBtn').click();
    await page.getByRole('menuitem',{name:'隐藏运行提示',exact:true}).click();
    assert.equal(await page.locator('#events [data-event-type=warning]').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('cmc.showWarnings')),'false');
  });
  await check('隐藏 warning 时仍展开错误详情',async()=>{
    await page.locator('#prompt').fill('ERROR_TEST');await page.locator('#sendBtn').click();
    await page.locator('#events [data-event-type=error] pre').filter({hasText:'RETRYABLE_FAILURE_FOR_TEST'}).waitFor();
    assert.equal(await page.locator('#events [data-event-type=warning]').count(),0);
    const threads=await (await fetch(base+'/api/threads',{headers:{Authorization:'Bearer '+token}})).json();
    const title=await page.locator('#threadTitle').innerText();
    const thread=threads.threads.find(item=>item.title===title);
    const result=await (await fetch(base+'/api/threads/'+thread.id+'/events',{headers:{Authorization:'Bearer '+token}})).json();
    assert.ok(result.events.some(event=>event.type==='error'&&event.message==='RETRYABLE_FAILURE_FOR_TEST'));
  });
  await check('桌面任务自动恢复原目录，兼容 Windows 前缀并拒绝伪造路径', async () => {
    const directory=path.join(home,'Desktop-only Workspace');await fs.mkdir(directory);
    const threadId='desktop-resume-fixture',timestamp=new Date().toISOString();
    await fs.writeFile(path.join(codexHome,'session_index.jsonl'),JSON.stringify({id:threadId,thread_name:'桌面历史恢复',updated_at:timestamp})+'\n');
    await fs.writeFile(path.join(codexHome,'sessions','rollout-'+threadId+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:threadId,cwd:process.platform==='win32'?'\\\\?\\'+directory:directory,timestamp}})+'\n');
    const resume=projectPath=>fetch(base+'/api/threads/'+threadId+'/resume',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({projectPath})});
    assert.equal((await resume(home)).ok,false,'Unrelated unregistered directory stays blocked');
    const restored=await resume(directory);assert.equal(restored.status,200,await restored.text());
    assert.ok((await json('/api/projects')).projects.some(p=>p.path===directory));
  });
  await check('手机免选项目发送、即时反馈、侧栏新任务和触控动效', async () => {
    const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const mobile=await mobileContext.newPage();
    await login(mobile);
    await mobile.locator('#prompt').fill('NO_PROJECT_TEST');
    assert.equal(await mobile.locator('#chatProject').inputValue(),'');
    await mobile.waitForFunction(()=>!document.querySelector('#sendBtn').disabled);
    await mobile.locator('#sendBtn').click();
    assert.equal(await mobile.locator('#prompt').inputValue(),'');
    const outgoing=mobile.locator('.message.user').filter({hasText:'NO_PROJECT_TEST'});
    await outgoing.waitFor();
    await outgoing.evaluate(node=>{window.pendingBubble=node;});
    assert.equal(await mobile.locator('.running-indicator').count(),0);
    assert.equal(await mobile.locator('.submit-spinner').count(),1);
    await mobile.locator('.message.assistant').filter({hasText:'任务：NO_PROJECT_TEST'}).waitFor();
    assert.equal(await outgoing.evaluate(node=>node===window.pendingBubble),true,'acknowledgement preserves the outgoing bubble DOM');
    const created=(await json('/api/threads')).threads.find(t=>t.title==='NO_PROJECT_TEST');
    assert(created);const relative=path.relative(projectlessRoot,created.projectPath);
    assert(!path.isAbsolute(relative)&&!relative.startsWith('..'+path.sep)&&relative!=='..');
    assert.equal(path.basename(created.projectPath),'no-project-test');
    for(const folder of ['outputs','work'])assert((await fs.stat(path.join(created.projectPath,folder))).isDirectory());
    await mobile.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
    await mobile.locator('#prompt').fill('FOLLOW_UP_TEST');await mobile.locator('#sendBtn').click();
    await mobile.locator('.message.assistant').filter({hasText:'任务：FOLLOW_UP_TEST'}).waitFor();
    await mobile.locator('#prompt').fill('保留在旧任务中的草稿');
    await mobile.locator('#mobileDrawer').click();
    await mobile.locator('#newThreadBtn').click();
    assert.equal(await mobile.locator('#welcome').isVisible(),true);
    assert.ok(await mobile.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('cmc.drafts'))).includes('保留在旧任务中的草稿')));
    await mobile.locator('#modelSettingsBtn').click();
    await mobile.locator('#chooseChatModel').click();
    await mobile.locator('.choice-option').filter({hasText:/^test-model$/}).click();
    const slider=mobile.locator('#reasoningSlider');
    assert.ok(Number(await slider.getAttribute('aria-valuemax'))>0);
    const style=await slider.evaluate(n=>({tap:getComputedStyle(n).webkitTapHighlightColor,select:getComputedStyle(n.parentElement).userSelect,touch:getComputedStyle(n).touchAction}));
    assert.equal(style.tap,'rgba(0, 0, 0, 0)');assert.equal(style.select,'none');assert.equal(style.touch,'none');
    await mobile.locator('.model-settings-dialog').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
    const track=await mobile.locator('.reasoning-track').boundingBox();
    await mobile.touchscreen.tap(track.x,track.y+track.height/2);
    assert.equal(await slider.getAttribute('aria-valuenow'),'0');
    await mobile.touchscreen.tap(track.x+track.width,track.y+track.height/2);
    assert.equal(await slider.getAttribute('aria-valuenow'),await slider.getAttribute('aria-valuemax'));
    await mobile.screenshot({path:path.join(artifacts,'web-mobile-motion.png')});
    await mobile.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await mobile.locator('.model-settings-dialog').evaluate(n=>getComputedStyle(n).animationName),'none');
    await mobileContext.close();
  });
  await check("主题切换记忆与跟随系统", async () => {
    await navigate(page,'settings');
    await page.locator('[data-theme-choice="dark"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(0, 0, 0)');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await navigate(page,'settings');
    await page.screenshot({path:path.join(artifacts,'web-dark-settings.png')});
    await page.locator('[data-theme-choice="system"]').click();
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await page.locator('[data-theme-choice="light"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  });
  await check('桌面历史图片在网页中直接显示',async()=>{
    await fs.appendFile(path.join(codexHome,'session_index.jsonl'),JSON.stringify({id:'history-context-fixture',thread_name:'历史图片预览',updated_at:new Date().toISOString()})+'\n');
    const context=await browser.newContext({viewport:{width:390,height:844}}),preview=await context.newPage();
    try {
      await preview.goto(base+'/console');
      await preview.locator('#welcomeConnect').click();
      await preview.locator('#token').fill(token);await preview.locator('#connectBtn').click();
      await preview.waitForFunction(()=>document.getElementById('status').textContent==='已连接');
      await openSidebar(preview);
      await preview.locator('#threads .thread-row').filter({hasText:'历史图片预览'}).first().click();
      const image=preview.locator('.message.user').filter({hasText:'查看这张图'}).locator('img').first();
      await image.waitFor();
      await image.evaluate(img=>new Promise((resolve,reject)=>{if(img.complete)return img.naturalWidth?resolve():reject(Error('图片加载失败'));img.onload=resolve;img.onerror=()=>reject(Error('图片加载失败'))}));
      assert.equal(await image.evaluate(img=>img.naturalWidth),2);
      assert.equal(await image.locator('xpath=ancestor::*[contains(@class,"user-bubble")]').count(),1);
      assert((await image.boundingBox()).width<=100,'历史图片应显示为缩略图');
      assert((await image.locator('xpath=ancestor::*[contains(@class,"user-bubble")]').innerText()).includes('查看这张图'));
      const restored=preview.locator('.message.user').filter({hasText:'查看已清理的临时图片'}).locator('img').first();
      await restored.evaluate(img=>new Promise((resolve,reject)=>{if(img.complete)return img.naturalWidth?resolve():reject(Error('恢复图片加载失败'));img.onload=resolve;img.onerror=()=>reject(Error('恢复图片加载失败'))}));
      assert.equal(await restored.evaluate(img=>img.naturalWidth),2);
      assert.equal(await preview.locator('.message.user').last().innerText().then(text=>text.includes('<image')),false);
    } finally {await context.close()}
  });
  await check('长会话分段加载与侧栏长按操作',async()=>{
    await fs.appendFile(path.join(codexHome,'session_index.jsonl'),JSON.stringify({id:'long-history-fixture',thread_name:'长会话历史',updated_at:new Date().toISOString()})+'\n');
    const context=await browser.newContext({viewport:{width:390,height:844}}),historyPage=await context.newPage();
    try{
      await historyPage.goto(base+'/console');
      await historyPage.locator('#welcomeConnect').click();
      await historyPage.locator('#token').fill(token);await historyPage.locator('#connectBtn').click();
      await historyPage.waitForFunction(()=>document.getElementById('status').textContent==='已连接');
      await openSidebar(historyPage);
      const row=historyPage.locator('#threads .thread-row').filter({hasText:'长会话历史'}).first();
      await row.waitFor();
      await row.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,button:0});
      await historyPage.getByRole('menuitem',{name:'重命名'}).waitFor();
      await row.dispatchEvent('pointerup',{pointerType:'touch'});
      await historyPage.keyboard.press('Escape');
      await row.click();
      const initial=await (await fetch(base+'/api/threads/long-history-fixture/events?count=180',{headers:{Authorization:'Bearer '+token}})).json();
      assert.equal(initial.hasMore,true,`初始历史窗口 ${initial.events?.length} 条`);
      await historyPage.locator('#loadOlder').waitFor();
      assert.equal(await historyPage.locator('#events .message.user').count(),180);
      await historyPage.locator('#loadOlder').scrollIntoViewIfNeeded();
      const anchor=historyPage.locator('#events .message.user').filter({hasText:/^历史消息 81$/});
      const anchorTop=(await anchor.boundingBox()).y;
      await historyPage.locator('#loadOlder').click();
      await historyPage.locator('#events .message.user').filter({hasText:/^历史消息 1$/}).waitFor();
      assert.equal(await historyPage.locator('#events .message.user').count(),260);
      assert.equal(await historyPage.locator('#loadOlder').isVisible(),false);
      assert.ok(Math.abs((await anchor.boundingBox()).y-anchorTop)<4,'加载旧记录保持原消息位置');
    }finally{await context.close()}
  });
  await check('消息动作放入长按菜单，权限和运行时排队停止',async()=>{
    await navigate(page,'chat');
    await openSidebar(page);await page.locator('#newThreadBtn').click();
    await page.locator('#prompt').fill('第一行\n第二行');
    await page.locator('#sendBtn').click();
    const bubble=page.locator('.user-bubble').filter({hasText:'第一行'});
    await bubble.waitFor();
    assert.equal(await bubble.evaluate(node=>getComputedStyle(node).whiteSpace),'pre-wrap');
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
    const actions=page.locator('.message.user').filter({hasText:'第一行'});
    assert.equal(await actions.getByRole('button',{name:'再次编辑'}).count(),0);
    assert.equal(await actions.getByRole('button',{name:'复制消息'}).count(),0);
    const longMessage='这是一段需要保留复制入口的长消息。'.repeat(11);
    await page.locator('#prompt').fill(longMessage);
    await page.locator('#sendBtn').click();
    const longActions=page.locator('.message.user').filter({hasText:longMessage});
    assert.equal(await longActions.getByRole('button',{name:'复制消息'}).count(),0);
    await longActions.locator('.user-bubble-text').click({button:'right'});
    await page.getByRole('menuitem',{name:'复制',exact:true}).click();
    await page.locator('.toast').getByText('已复制',{exact:true}).waitFor();
    assert.equal(await page.locator('#prompt').inputValue(),'');
    await page.locator('#modelSettingsBtn').click();
    await page.getByRole('button',{name:'询问',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'询问',exact:true}).getAttribute('aria-pressed'),'true');
    await page.locator('.model-settings-close').click();
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='发送消息');
    await page.locator('#prompt').fill('SLOW');await page.locator('#sendBtn').click();
    await page.waitForFunction(()=>document.querySelector('#sendBtn').getAttribute('aria-label')==='停止任务');
    await page.locator('#prompt').fill('下一步');
    assert.equal(await page.locator('#sendBtn').getAttribute('aria-label'),'加入队列');
    assert.equal(await page.locator('#stopBtn').isVisible(),true);
    assert.equal(await page.locator('#chatState').isVisible(),false);
    assert.equal(await page.locator('.running-indicator').count(),0);
    await page.locator('#stopBtn').click();
  });
  await check('账号额度从侧栏进入独立管理后台',async()=>{
    await openSidebar(page);
    const popup=context.waitForEvent('page');await page.locator('#usageBtn').click();
    const management=await popup;await management.waitForURL(base+'/manage/#usage');await management.close();
  });
  await check('压缩后的上下文与会话累计消耗分开显示，刷新不重算累计值',async()=>{
    let pending=false;
    await page.route('**/api/usage?**',route=>route.fulfill({json:{quota:{windows:[],stale:false},quotaTrend:[],tokens:{total:1716876430,input:1712825353,cached:1684242176,output:4051077,reasoning:1580606,last:null,context:pending?null:30920,contextWindow:380000,contextPercent:pending?null:8.1368,contextState:pending?'awaiting_usage':'compacted'}}}));
    if(await page.locator('#sidebar').evaluate(node=>node.classList.contains('open')))await page.locator('#closeDrawer').click();
    await page.locator('#threadMenuBtn').click();await page.getByRole('menuitem',{name:'本会话用量',exact:true}).click();
    await page.locator('.usage-dialog').getByText('当前上下文',{exact:true}).waitFor();
    await page.locator('.session-usage-context strong').first().getByText('30.9K',{exact:true}).waitFor();
    assert.match(await page.locator('.session-usage-summary').innerText(),/17.17 亿/);
    pending=true;await page.locator('.usage-dialog').getByRole('button',{name:'更新用量',exact:true}).click();
    await page.locator('.session-usage-context strong').first().getByText('更新中',{exact:true}).waitFor();
    assert.match(await page.locator('.session-usage-summary').innerText(),/17.17 亿/);
    await page.locator('.session-usage-more summary').click();
    assert.equal(await page.locator('.session-usage-extra strong').first().innerText(),'—','unknown last-turn usage stays unknown');
    await page.locator('.usage-dialog').getByRole('button',{name:'关闭',exact:true}).click();await page.unroute('**/api/usage?**');
  });
  await check('云端快照的导入、错误重试、切换竞态和取消在真实浏览器恢复',async()=>{
    const remoteContext=await browser.newContext({viewport:{width:390,height:844}});
    try{await (await import('./remote-render-audit.mjs')).audit(await remoteContext.newPage(),artifacts,{base,token});}
    finally{await remoteContext.close();}
  });
  await check('已安装后端入口、实际模型、续接、停止与公网边界的真实浏览器回归',async()=>{
    const backendContext=await browser.newContext({viewport:{width:1440,height:960}});
    try{await (await import('./backend-entry-web.mjs')).auditBackendEntry(await backendContext.newPage(),artifacts,{base,token,metrics:backendFixtures.metrics});}
    finally{await backendContext.close();}
  });
  }
  if(process.env.CMC_WEB_IMAGE_COUNT_ONLY!=='1'&&process.env.CMC_WEB_FUNCTIONS_ONLY!=='1'&&process.env.CMC_WEB_UPLOAD_ONLY!=='1'&&process.env.CMC_WEB_UPLOAD_PREVIEW_ONLY!=='1'&&process.env.CMC_WEB_PREVIEW_CONNECTION_ONLY!=='1'&&process.env.CMC_WEB_OUTPUT_LINKS_ONLY!=='1'&&process.env.CMC_WEB_COMPOSER_TRANSFER_ONLY!=='1'&&process.env.CMC_WEB_UPLOAD_MIME_ONLY!=='1'&&process.env.CMC_WEB_TEXT_ENCODING_ONLY!=='1'&&process.env.CMC_WEB_TEXT_TYPES_ONLY!=='1'){
  await check('侧栏隐藏子代理，保留会话内查看与移动端搜索',async()=>{
    const agentsContext=await browser.newContext({viewport:{width:1440,height:960}});
    try{await (await import('./subagent-sidebar-web.mjs')).auditSubagentSidebar(await agentsContext.newPage(),artifacts,{base,token});}
    finally{await agentsContext.close();}
  });
  await check("页面没有未捕获错误", async () => assert.deepEqual(errors, []));
  await check('云端任务和消息来源在浏览器显示且不误标快照',async()=>{
    const cloudContext=await browser.newContext({viewport:{width:1440,height:960}});
    try{await (await import('./cloud-threads-web.mjs')).auditCloudThreads(await cloudContext.newPage(),artifacts,{base,token});}
    finally{await cloudContext.close();}
  });
  }
  if(process.env.CMC_WEB_IMAGE_COUNT_ONLY==='1')await check("多图检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_TEXT_TYPES_ONLY==='1')await check("文本类型检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_TEXT_ENCODING_ONLY==='1')await check("文本编码检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_UPLOAD_MIME_ONLY==='1')await check("附件类型检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_FUNCTIONS_ONLY==='1')await check("功能检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_UPLOAD_ONLY==='1')await check("上传检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_UPLOAD_PREVIEW_ONLY==='1')await check("附件预览页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_PREVIEW_CONNECTION_ONLY==='1')await check("预览连接检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_OUTPUT_LINKS_ONLY==='1')await check("输出文件检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  if(process.env.CMC_WEB_COMPOSER_TRANSFER_ONLY==='1')await check("输入转移检查页面没有未捕获错误",async()=>assert.deepEqual(errors,[]));
  console.log(`Web smoke: ${checks} passed, ${failedChecks.length} failed`);
  await fs.writeFile(
    path.join(artifacts, process.env.CMC_WEB_IMAGE_COUNT_ONLY==='1'?"web-image-count-290-results.json":process.env.CMC_WEB_TEXT_TYPES_ONLY==='1'?"web-text-types-288-results.json":process.env.CMC_WEB_TEXT_ENCODING_ONLY==='1'?"web-text-encoding-286-results.json":process.env.CMC_WEB_UPLOAD_MIME_ONLY==='1'?"web-upload-mime-284-results.json":process.env.CMC_WEB_COMPOSER_TRANSFER_ONLY==='1'?"web-composer-transfer-281-results.json":process.env.CMC_WEB_OUTPUT_LINKS_ONLY==='1'?"web-output-links-280-results.json":process.env.CMC_WEB_PREVIEW_CONNECTION_ONLY==='1'?"web-preview-connection-279-results.json":process.env.CMC_WEB_UPLOAD_PREVIEW_ONLY==='1'?"web-upload-preview-278-results.json":process.env.CMC_WEB_UPLOAD_ONLY==='1'?"web-upload-277-results.json":process.env.CMC_WEB_FUNCTIONS_ONLY==='1'?"web-functions-198-results.json":"web-test-results.json"),
    JSON.stringify(
      { checks, passed: failedChecks.length===0, failedChecks, errors, date: new Date().toISOString() },
      null,
      2,
    ),
  );
  if(failedChecks.length)throw new AggregateError(failedChecks.map(row=>Error(row.name+': '+row.error)),'Web checks failed');
} catch (error) {
  console.error(error);
  console.error('Browser errors:',JSON.stringify(errors));
  if (page)
    await page
      .screenshot({ path: path.join(artifacts, "web-failure.png") })
      .catch(() => {});
  await fs.writeFile(path.join(artifacts, "web-test-gateway.log"), logs);
  process.exitCode = 1;
} finally {
  console.log("Cleanup: browser");
  await browser?.close();
  console.log("Cleanup: fixture servers");
  await fs.unlink(historyImagePath).catch(()=>{});
  previewServer.close();
  await vite.close();
  console.log("Cleanup: own gateway",gateway.pid);
  if (gateway.pid) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(gateway.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } catch {}
    } else gateway.kill();
  }
  gateway.stdout.destroy(); gateway.stderr.destroy();
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));
  assert(path.basename(home).startsWith('cmc-web-'));
  await fs.rm(home,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  console.log("Cleanup: fixture directory removed");
  console.log("Cleanup: complete");
  process.exit(process.exitCode || 0);
}
async function check(name, fn) {
  try{await fn();}
  catch(error){
    if(process.env.CMC_WEB_COLLECT_FAILURES!=='1')throw error;
    failedChecks.push({name,error:String(error)});
    console.error(`not ok - ${name}: ${error}`);
    await page?.screenshot({path:path.join(artifacts,`web-failure-${failedChecks.length}.png`)}).catch(()=>{});
    return;
  }
  checks++;
  console.log(`ok - ${name}`);
}
async function eventually(fn, timeout = 15000) {
  const start = Date.now();
  let error;
  while (Date.now() - start < timeout) {
    try {
      return await fn();
    } catch (e) {
      error = e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw error;
}
async function freePort() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function json(url) {
  return (
    await fetch(base + url, { headers: { Authorization: `Bearer ${token}` } })
  ).json();
}
async function projectId() {
  return (await json("/api/projects")).projects.find(
    (p) => p.name === "Atlas Workspace",
  ).id;
}
async function login(target) {
  await target.goto(base + "/console");
  if (await target.evaluate(() => Boolean(localStorage.getItem("cmc.token")))) {
    await target.waitForFunction(
      () => document.getElementById("status").textContent === "已连接",
    );
    return;
  }
  await target.locator("#welcomeConnect").click();
  await target.locator("#token").fill(token);
  await target.locator("#connectBtn").click();
  await target.waitForFunction(
    () => document.getElementById("status").textContent === "已连接",
  );
}
async function fit(target, selectors) {
  const result = await target.evaluate(
    (selectors) => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      regions: selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          selector,
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }),
      width: innerWidth,
      height: innerHeight,
    }),
    selectors,
  );
  assert.equal(result.overflow, false);
  for (const rect of result.regions) {
    assert(
      rect.width > 0 && rect.height > 0,
      `${rect.selector} must be visible`,
    );
    assert(
      rect.x >= -1 &&
        rect.y >= -1 &&
        rect.right <= result.width + 1 &&
        rect.bottom <= result.height + 1,
      `${rect.selector} is clipped: ${JSON.stringify(rect)}`,
    );
  }
}

async function chooseProject(page, id, value) {
  const label = await page.locator(`#${id} option`).evaluateAll((options, value) => options.find(option => option.value === value)?.textContent, value);
  if (id === 'chatModel' || id === 'chatEffort') {
    await page.locator('#modelSettingsBtn').click();
    if (id === 'chatModel') {
      await page.locator('#chooseChatModel').click();
      await page.getByRole('searchbox',{name:'搜索模型',exact:true}).fill(label);
      await page.locator('.model-options .choice-option').getByText(label,{exact:true}).click();
      const adjustable=await page.locator('#chatEffort option').evaluateAll(options=>options.filter(o=>o.value&&!o.disabled).length>1);
      assert.equal(await page.locator('#reasoningSlider').isVisible(),adjustable);
    } else {
      const slider=page.getByRole('slider',{name:'思考强度'});
      await slider.focus();await slider.press('Home');
      const maximum=Number(await slider.getAttribute('aria-valuemax'));
      for(let i=0;i<maximum && await page.locator('#chatEffort').inputValue()!==value;i++) await slider.press('ArrowRight');
    }
    assert.equal(await page.locator(`#${id}`).inputValue(),value);
    await page.locator('.model-settings-close').click();
    return;
  }
  await page.locator(`#${id} + .custom-select`).click();
  await page.locator('.choice-dialog .choice-option').getByText(label, {exact:true}).click();
}





async function openSidebar(target) {
  if (await target.locator('#sidebar').evaluate(node=>node.classList.contains('open'))) return;
  const trigger = target.locator('#openDrawer');
  await (await trigger.isVisible() ? trigger : target.locator('#mobileDrawer')).click();
  await target.locator('#sidebar').evaluate(node=>Promise.allSettled([...node.getAnimations(),...document.querySelector('#main').getAnimations()].map(a=>a.finished)));
}
async function navigate(target, view) {
  if (view === 'chat') {
    const back = target.locator('#backToChat');
    if (await back.isVisible()) await back.click();
    return;
  }
  if (view === 'settings') {
    const settings = target.locator('.rail-settings');
    if (await settings.isVisible()) return settings.click();
    await openSidebar(target);
    return target.locator('.sidebar-footer [data-page=settings]').click();
  }
  const rail = target.locator(`.nav-rail [data-page=${view}]`);
  if (await rail.isVisible()) return rail.click();
  if (await target.locator('#workTabs').isVisible()) return target.locator(`#workTabs [data-page=${view}]`).click();
  if(view==='files'){
    await target.locator('#sidebar').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
    if(await target.locator('#sidebar').evaluate(node=>node.classList.contains('open')))await target.locator('#closeDrawer').click();
    await navigate(target,'chat');
    await target.locator('#threadMenuBtn').click();
    return target.getByRole('menuitem',{name:'工作区文件',exact:true}).click();
  }
  await openSidebar(target);
  return target.locator(`.sidebar-tools [data-page=${view}]`).click();
}




