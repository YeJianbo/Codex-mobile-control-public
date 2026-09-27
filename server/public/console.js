import { marked } from "./marked.js";
import './compat.js';
import {mathExtension,renderMath} from './math.js';
marked.use({extensions:[mathExtension]});
import DOMPurify from "./purify.js";
import {localFilePath,resolveFileLink,renderPdf} from './file-links.js';
import {
  requestId,
  comparablePath,
  parentPath,
  statusLabel,
  formatSize,
  previewKind,
  validatePreview,
  mergeEvents,
  conversationBlocks,
  groupToolActivity,
  activityEntries,
  cleanActivityLabel,
  compactError,
  errorMessage,
} from "./console-core.js";

const $ = (id) => document.getElementById(id);
const icons = {
  info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  compose: 'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1L22 8l-5-5-7 11Z',
  panel: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 3v18',
  copy:'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  chart:'M4 4v16h16M8 16v-4M12 16V8M16 16V5',
  download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  save:'M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7',
  image:'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M15 7h.01',
  code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8z",
  folder:
    "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18",
  terminal: "m5 7 5 5-5 5m8 0h6",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
  monitor: "M4 3h16a1 1 0 0 1 1 1v12H3V4a1 1 0 0 1 1-1ZM12 16v5M8 21h8",
  "chevron-right": "m9 5 7 7-7 7",
  "chevron-down": "m6 9 6 6 6-6",
  "arrow-up-right": "M7 17 17 7M7 7h10v10",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  "arrow-left": "M20 12H4m6-6-6 6 6 6",
  "arrow-up": "M12 20V4m-6 6 6-6 6 6",
  "arrow-down": "M12 4v16m-6-6 6 6 6-6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 8l-3 5-5 3 3-5 5-3Z",
  scan: "M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4M8 8h8v8H8V8Z",
  qr: "M3 3h6v6H3V3Zm12 0h6v6h-6V3ZM3 15h6v6H3v-6Zm12 0h2v2h-2v-2Zm6 0v3h-3v3h3M12 3v3m0 6h3m-3 6v3M3 12h3",
  menu: "M4 6h16M4 12h16M4 18h16",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  list: "M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01",
  file: "M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6",
  stop: "M6 6h12v12H6V6Z",
  shield: "m12 3 9 4v5c0 6-9 10-9 10S3 18 3 12V7l9-4Zm-4 9 3 3 5-6",
  lock: "M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4",
  devices: "M4 3h12v14H4V3Zm12 6h5v13h-8v-5M7 13h2",
  "wifi-off":
    "m2 2 20 20M8 16a6 6 0 0 1 8 0m-4 4h.01M4 12a12 12 0 0 1 4-2m5 0a12 12 0 0 1 7 2M1 7a19 19 0 0 1 2-1m5-2a20 20 0 0 1 15 3",
};
function icon(name) {
  if(name==='stop')return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] ?? icons.file}"/></svg>`;
}
function mountIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
mountIcons();
for(const [id,name] of Object.entries({saveFileBtn:'save',saveSettingsBtn:'save',newTerminalBtn:'plus',stopTerminalBtn:'stop',refreshPair:'refresh',reconnectBtn:'refresh'})) {
  const node=$(id);if(!node)continue;
  const label=node.textContent.trim()||node.getAttribute('aria-label');node.title=label;node.setAttribute('aria-label',label);node.innerHTML=icon(name);node.classList.add('glyph-action');
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function iconNode(name) {
  const node = el("span");
  node.innerHTML = icon(name);
  return node;
}
function button(label, fn, cls = "text-button") {
  const node = el("button", cls, label);
  const symbol={'复制':'copy','下载':'download','关闭':'close','刷新':'refresh','保存':'save','移除':'close'}[label];
  if(symbol){node.innerHTML=icon(symbol);node.classList.add('glyph-action');node.title=label;node.setAttribute('aria-label',label);}
  node.type = "button";
  node.onclick = () => run(fn, node);
  return node;
}
function safeRead(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function safeWrite(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled in private browsing. */
  }
}
const collapsedSections=(()=>{try{return JSON.parse(safeRead('cmc.sidebarCollapsed')||'{}')}catch{return {}}})();
function updateSidebarScrollbar(){
  const scroller=document.querySelector('.sidebar-scroll'),rail=$('sidebarScrollbar'),thumb=$('sidebarThumb');
  const height=scroller.clientHeight,max=scroller.scrollHeight-height;
  rail.hidden=max<=1;rail.style.top=scroller.offsetTop+'px';rail.style.height=height+'px';
  const size=Math.min(height,Math.max(28,height*height/Math.max(scroller.scrollHeight,1)));
  thumb.style.height=size+'px';thumb.style.transform=`translateY(${max>0?scroller.scrollTop/max*(height-size):0}px)`;
}
function applySidebarSections(){
  const searching=Boolean($('search').value.trim());
  document.querySelectorAll('[data-collapse]').forEach(button=>{
    const target=$(button.dataset.collapse),open=searching||!collapsedSections[target.id];
    target.hidden=!open;button.setAttribute('aria-expanded',String(open));
    button.querySelector('.section-count').textContent=target.querySelectorAll('.thread-row,.project-row').length||'';
  });
  requestAnimationFrame(updateSidebarScrollbar);
}
document.querySelectorAll('[data-collapse]').forEach(button=>{button.onclick=()=>{
  const id=button.dataset.collapse;collapsedSections[id]=!collapsedSections[id];safeWrite('cmc.sidebarCollapsed',JSON.stringify(collapsedSections));applySidebarSections();
}});
const sidebarScroller=document.querySelector('.sidebar-scroll');
sidebarScroller.addEventListener('scroll',updateSidebarScrollbar,{passive:true});
new ResizeObserver(updateSidebarScrollbar).observe(sidebarScroller);
let thumbDrag=null;
$('sidebarThumb').onpointerdown=event=>{event.preventDefault();thumbDrag={y:event.clientY,top:sidebarScroller.scrollTop};event.currentTarget.setPointerCapture(event.pointerId)};
$('sidebarThumb').onpointermove=event=>{if(!thumbDrag)return;const travel=sidebarScroller.clientHeight-$('sidebarThumb').offsetHeight;sidebarScroller.scrollTop=thumbDrag.top+(event.clientY-thumbDrag.y)*(sidebarScroller.scrollHeight-sidebarScroller.clientHeight)/Math.max(travel,1)};
$('sidebarThumb').onpointerup=$('sidebarThumb').onpointercancel=()=>{thumbDrag=null};
$('sidebarScrollbar').onpointerdown=event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();sidebarScroller.scrollTop=(event.clientY-rect.top)/rect.height*sidebarScroller.scrollHeight-sidebarScroller.clientHeight/2};
function readDrafts() {
  try {
    return JSON.parse(safeRead("cmc.drafts") || "{}");
  } catch {
    return {};
  }
}
const state = {
  harness:['codex','claude','antigravity','grok'].includes(safeRead('cmc.harness'))?safeRead('cmc.harness'):'codex',
  imageDrafts: (()=>{try{return JSON.parse(safeRead('cmc.imageDrafts')||'{}')}catch{return {}}})(),
  fileDrafts: (()=>{try{return JSON.parse(safeRead('cmc.fileDrafts')||'{}')}catch{return {}}})(),
  uploading:0,
  models: [],
  showWarnings: safeRead('cmc.showWarnings') === 'true',
  sidebarProjects:[],
  token: safeRead("cmc.token"),
  page: "chat",
  connected: false,
  connecting: false,
  manualDisconnect: false,
  ws: null,
  generation: 0,
  reconnectAttempt: 0,
  reconnectTimer: null,
  projects: [],
  threads: [],
  approvals: [],
  chatProject: "",
  fileProject: "",
  terminalProject: "",
  threadId: "",
  writerLocked: new Set(),
  events: new Map(),
  hydrating: new Map(),
  historyCount: new Map(),
  historyMore: new Map(),
  historyLoading: new Set(),
  selection: 0,
  pending: null,
  drafts: readDrafts(),
  settings: {},
  settingsLoaded: false,
  settingsDirty: false,
  rawDirty: false,
  files: [],
  filePath: "",
  fileMode: "files",
  fileRequest: 0,
  listRequest: 0,
  opened: null,
  diffFiles: [],
  diffSelected: null,
  terminalCommands: [],
  activeTerminal: "",
  terminal: null,
  terminalFit: null,
  terminalOutput: "",
  terminalRequest: 0,
};
const pageNames = {
  chat: "工作区",
  files: "文件与改动",
  terminal: "终端",
  preview: "浏览器预览",
  settings: "设置",
};
let toastTimer,
  renderQueued = false,
  refreshTimer,
  terminalTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = `toast${error ? " error" : ""}`;
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 6500 : 3500,
  );
}
async function run(fn, control) {
  if (control?.disabled) return;
  if (control) control.disabled = true;
  try {
    return await fn();
  } catch (error) {
    if (!error.stale) toast(errorMessage(error), true);
  } finally {
    if (control) control.disabled = false;
    updateControls();
  }
}
async function api(
  path,
  { method = "GET", body, token = state.token, timeout = 20000, ...rest } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      ...rest,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "访问凭据无效或已撤销，请重新连接。"
          : data.error || `请求失败（HTTP ${response.status}）`,
      );
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function onlineRequired() {
  if (!state.connected) {
    openDialog("connectionDialog");
    return false;
  }
  return true;
}
function openDialog(id) {
  hideMenu();
  closeDrawer();
  const node = $(id);
  if (!node.open) node.showModal();
}
function closeDialog(id) {
  $(id).close();
}
function showInline(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}
function confirmAction(title, detail) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = detail;
  openDialog("confirmDialog");
  return new Promise((resolve) => {
    const finish = (accepted) => {
      $("confirmDialog").removeEventListener("cancel", cancel);
      closeDialog("confirmDialog");
      resolve(accepted);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    $("confirmAccept").onclick = () => finish(true);
    $("confirmCancel").onclick = () => finish(false);
    $("confirmDialog").addEventListener("cancel", cancel);
  });
}
function updateConnection() {
  const label = state.connecting
    ? "连接中"
    : state.connected
      ? "已连接"
      : state.reconnectTimer
        ? "重连中"
        : "未连接";
  $("status").textContent = label;
  $("statusBtn").setAttribute('aria-label', `电脑连接 · ${label}`);
  $("statusBtn").dataset.tooltip = `电脑连接 · ${label}`;
  for (const id of ["statusDot", "sidebarStatusDot"])
    $(id).className =
      `status-dot ${state.connected ? "online" : state.connecting || state.reconnectTimer ? "connecting" : ""}`;
  $("computerName").textContent = state.connected ? "我的电脑" : "连接你的电脑";
  $("computerAddress").textContent = location.host;
  $("connectionBanner").hidden =
    state.connected ||
    (!state.token && !state.connecting) ||
    state.manualDisconnect;
  $("connectionBannerText").textContent = state.connecting
    ? "正在连接电脑…"
    : "连接已断开，草稿已保留。";
  $("welcomeConnect").hidden = state.connected;
  updateControls();
}
function activeThread() {
  return state.threads.find((thread) => thread.id === state.threadId);
}
function isRunning() {
  return activeThread()?.status === "running";
}
function draftKey(threadId = state.threadId, project = state.chatProject) {
  return threadId ? `thread:${threadId}` : `${state.harness==='codex'?'':state.harness+':'}project:${project || "none"}`;
}
function storeDraft() {
  if (state.pending?.key === draftKey() && !$("prompt").value) return;
  state.drafts[draftKey()] = $("prompt").value;
  safeWrite("cmc.drafts", JSON.stringify(state.drafts));
}
function restoreDraft() {
  $("prompt").value = state.drafts[draftKey()] || "";
  resizeComposer();
  updateControls();
  renderImageDrafts();
  renderFileDrafts();
}
function attachmentUrl(image) { return `/api/uploads/images/${encodeURIComponent(image.id)}?token=${encodeURIComponent(state.token)}`; }
function fileUrl(file){return `/api/uploads/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(state.token)}`;}
function fileCards(files,removable=false){
  const list=el('div','file-attachments');
  for(const file of files||[]){
    const card=el('div','file-attachment');
    if(file.mime?.startsWith('video/')){
      const video=el('video');video.controls=true;video.preload='metadata';video.src=fileUrl(file);card.append(video);
    }
    const link=el('a','file-attachment-link',file.name);link.href=fileUrl(file);link.target='_blank';link.rel='noopener';link.download=file.name;
    card.append(link,el('small',null,`${Math.max(1,Math.round(file.size/1024))} KB`));
    if(removable)card.append(button('移除',()=>{const key=draftKey();state.fileDrafts[key]=(state.fileDrafts[key]||[]).filter(item=>item.id!==file.id);saveFileDrafts();renderFileDrafts();updateControls();},'image-remove'));
    list.append(card);
  }
  return list;
}
function saveFileDrafts(){safeWrite('cmc.fileDrafts',JSON.stringify(state.fileDrafts));}
function renderFileDrafts(){const files=state.fileDrafts[draftKey()]||[];const host=$('fileDrafts');host.hidden=!files.length;host.replaceChildren(...fileCards(files,true).childNodes);resizeComposer();}
function imageGallery(images,removable=false) {
  const gallery=el('div','image-gallery');
  for(const image of images||[]) {
    const tile=el('div','image-tile'),preview=el('img');preview.src=attachmentUrl(image);preview.alt=image.name;preview.loading='lazy';
    const view=button('',()=>{
      const modal=el('dialog','output-modal'),close=button('关闭',()=>modal.close(),'button secondary'),body=el('div','output-body'),full=el('img');
      full.src=attachmentUrl(image);full.alt=image.name;body.append(full);modal.append(close,body);document.body.append(modal);modal.onclose=()=>modal.remove();modal.showModal();
    },'image-open');view.setAttribute('aria-label',`查看图片 ${image.name}`);view.append(preview);tile.append(view);
    if(removable)tile.append(button('移除',()=>{state.imageDrafts[draftKey()]=(state.imageDrafts[draftKey()]||[]).filter(i=>i.id!==image.id);saveImageDrafts();renderImageDrafts();updateControls();},'image-remove'));
    gallery.append(tile);
  }
  return gallery;
}
function saveImageDrafts(){safeWrite('cmc.imageDrafts',JSON.stringify(state.imageDrafts));}
function renderImageDrafts(){const images=state.imageDrafts[draftKey()]||[];$('imageDrafts').hidden=!images.length;$('imageDrafts').replaceChildren(...imageGallery(images,true).childNodes);resizeComposer();}
async function uploadImages(files) {
  if(!files.length)return;
  if(!onlineRequired())return;
  const key=draftKey();state.uploading++;updateControls();$('uploadStatus').hidden=false;$('uploadStatus').textContent='正在上传图片…';
  try {for(const file of files) {
    if((state.imageDrafts[key]||[]).length>=8)throw new Error('每条消息最多 8 张图片');
    if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type)||file.size>5*1024*1024)throw new Error('请选择不超过 5 MB 的 PNG、JPEG、GIF 或 WebP 图片');
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file)});
    const image=await api('/api/uploads/images',{method:'POST',body:{dataUrl,name:file.name}});
    state.imageDrafts[key]=[...(state.imageDrafts[key]||[]),image];saveImageDrafts();renderImageDrafts();
  }} finally {state.uploading--;$('uploadStatus').hidden=!state.uploading;updateControls();}
}
$('imageInput').onchange=()=>{const files=[...$('imageInput').files];$('imageInput').value='';run(async()=>{const inline=files.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.type)&&file.size<=5*1024*1024);await uploadImages(inline);await uploadFiles(files.filter(file=>!inline.includes(file)));})};
async function uploadFiles(files){
  if(!files.length)return;
  if(!onlineRequired())return;
  const key=draftKey();state.uploading++;updateControls();$('uploadStatus').hidden=false;$('uploadStatus').textContent='正在上传文件…';
  try{for(const file of files){
    if((state.fileDrafts[key]||[]).length>=8)throw new Error('每条消息最多 8 个文件');
    if(!file.size||file.size>100*1024*1024)throw new Error('文件大小需在 100 MB 以内');
    const response=await fetch('/api/uploads/files',{method:'POST',headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-File-Type':file.type||'application/octet-stream'},body:file});
    const result=await response.json();if(!response.ok)throw new Error(result.message||result.error||'文件上传失败');
    state.fileDrafts[key]=[...(state.fileDrafts[key]||[]),result];saveFileDrafts();renderFileDrafts();
  }}finally{state.uploading--;$('uploadStatus').hidden=!state.uploading;updateControls();}
}
$('fileInput').onchange=()=>{const files=[...$('fileInput').files];$('fileInput').value='';run(()=>uploadFiles(files))};
$('prompt').addEventListener('paste',event=>{const images=[...event.clipboardData.files].filter(f=>f.type.startsWith('image/'));if(images.length){event.preventDefault();run(()=>uploadImages(images))}});
$('composer').addEventListener('dragover',event=>{event.preventDefault()});
$('composer').addEventListener('drop',event=>{event.preventDefault();const files=[...event.dataTransfer.files];run(async()=>{await uploadImages(files.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.type)&&file.size<=5*1024*1024));await uploadFiles(files.filter(file=>!/^image\/(png|jpeg|gif|webp)$/.test(file.type)||file.size>5*1024*1024))})});
function resizeComposer() {
  const text = $("prompt").value;
  // Expand long drafts into two rows without moving the model controls apart.
  $("composer").classList.toggle("expanded", text.includes('\n') || text.length > 80 || !$('imageDrafts').hidden || !$('fileDrafts').hidden);
  $("prompt").style.height = "auto";
  $("prompt").style.height = `${Math.max(26, Math.min(160, $("prompt").scrollHeight))}px`;
}
function updateControls() {
  const running = isRunning();
  const hasDraft=Boolean($('prompt').value.trim() || (state.imageDrafts[draftKey()]||[]).length || (state.fileDrafts[draftKey()]||[]).length);
  const stop=running&&!hasDraft;
  const pending =
    state.pending &&
    (state.pending.threadId === state.threadId || !state.threadId);
  $("sendBtn").innerHTML = pending || queueSubmitting ? '<span class="submit-spinner" aria-hidden="true"></span>' : icon(stop ? "stop" : running ? "list" : "arrow-up");
  $('stopBtn').hidden=!running || !hasDraft;
  $('stopBtn').disabled=!state.connected;
  $('composer').classList.toggle('has-stop',running&&hasDraft);
  $("sendBtn").classList.toggle("running", running);
  $("sendBtn").setAttribute("aria-label", stop ? "停止任务" : running ? "加入队列" : "发送消息");
  $("sendBtn").title = $("sendBtn").getAttribute('aria-label');
  $("sendBtn").disabled =
    !state.connected || Boolean(pending) || queueSubmitting || (hasDraft && Boolean(state.uploading)) ||
    (!running && !$('chatModel').value) ||
    (!running &&
      (Boolean(pending) ||
        state.uploading || (!$("prompt").value.trim() && !(state.imageDrafts[draftKey()]||[]).length && !(state.fileDrafts[draftKey()]||[]).length)));
  $("chatState").textContent = "";
  $("chatState").hidden = !$("chatState").textContent;
  $("welcomeProjectArea").hidden = !state.connected || Boolean(state.threadId);
  $("saveFileBtn").disabled =
    !state.connected || !state.opened || !state.opened.editable || !fileDirty();
  $("dirtyIndicator").hidden = !fileDirty();
  $("saveSettingsBtn").disabled = !state.connected || !state.settingsLoaded;
  $("saveRawBtn").disabled = !state.connected || !state.settingsLoaded;
  $("newTerminalBtn").disabled = !state.connected || !state.terminalProject;
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  $("stopTerminalBtn").disabled =
    !state.connected || record?.status !== "running";
  $("commandInput").disabled = !state.connected || !state.terminalProject;
  $("commandForm").querySelector("button").disabled =
    !state.connected || !state.terminalProject;
  $("terminalShortcuts")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.disabled =
          !state.connected ||
          !isInteractive(record) ||
          record.status !== "running"),
    );
}
async function connect(token = state.token) {
  const generation = ++state.generation;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.manualDisconnect = false;
  state.ws?.close();
  state.connected = false;
  state.connecting = true;
  state.token = token.trim();
  updateConnection();
  try {
    if (!state.token) throw new Error("请输入访问 Token 或使用配对码。");
    const health = await api("/health", { token: "" });
    if (
      !health.ok ||
      health.protocolVersion < 1 ||
      health.minAndroidProtocolVersion > 1
    )
      throw new Error("当前 Gateway 协议不兼容，请更新 Gateway。");
    const { projects } = await api("/api/projects");
    if (generation !== state.generation) return;
    state.projects = projects || [];
    renderProjects();
    await connectSocket(generation);
    if (generation !== state.generation) return;
    safeWrite("cmc.token", state.token);
    $("token").value = state.token;
    state.reconnectAttempt = 0;
    state.connecting = false;
    updateConnection();
    closeDialog("connectionDialog");
    await Promise.allSettled([
      refreshProjects(),
      refreshThreads(),
      loadSettings(),
      refreshTerminals(),
      refreshApprovals(),
      refreshDevices(),
    ]);
    if (state.threadId) await loadThread(state.threadId);
  } catch (error) {
    if (generation !== state.generation) return;
    state.connecting = false;
    state.connected = false;
    updateConnection();
    throw error;
  }
}
function connectSocket(generation) {
  return new Promise((resolve, reject) => {
    const wsUrl = new URL("/ws", location.href);
    wsUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("token", state.token);
    wsUrl.searchParams.set("device", "Web 控制台");
    const ws = new WebSocket(wsUrl);
    state.ws = ws;
    let ready = false;
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("实时连接超时，请重新连接。"));
    }, 10000);
    ws.onmessage = (message) => {
      if (generation !== state.generation) return;
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === "connected") {
        ready = true;
        clearTimeout(deadline);
        state.connected = true;
        updateConnection();
        resolve();
        return;
      }
      receiveEvent(event);
    };
    ws.onclose = (event) => {
      clearTimeout(deadline);
      if (generation !== state.generation) return;
      state.connected = false;
      state.connecting = false;
      if (!ready)
        reject(
          new Error(
            event.code === 1008
              ? "实时连接被拒绝，请检查访问凭据。"
              : "实时连接未能建立。",
          ),
        );
      if (event.code === 1008) {
        state.manualDisconnect = true;
        toast("访问凭据已失效，请重新连接。", true);
      }
      if (state.pending) {
        restorePendingDraft();
        renderConversation();
      }
      if (!state.manualDisconnect) scheduleReconnect();
      updateConnection();
    };
    ws.onerror = () => {
      /* onclose provides one consistent recovery path. */
    };
  });
}
function scheduleReconnect() {
  if (
    state.reconnectTimer ||
    state.manualDisconnect ||
    !state.token ||
    !navigator.onLine
  )
    return;
  const delay = Math.min(1000 * 2 ** state.reconnectAttempt++, 15000);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try {
      await connect();
    } catch (error) {
      if (error.status === 401) {
        state.manualDisconnect = true;
        toast(error.message, true);
      } else scheduleReconnect();
      updateConnection();
    }
  }, delay);
  updateConnection();
}
function disconnect() {
  state.manualDisconnect = true;
  state.generation++;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.ws?.close();
  state.connected = false;
  state.connecting = false;
  restorePendingDraft();
  state.token = "";
  safeWrite("cmc.token", "");
  updateConnection();
  renderConversation();
}
function sendCommand(command) {
  if (!state.connected || state.ws?.readyState !== WebSocket.OPEN)
    throw new Error("实时连接尚未就绪。");
  state.ws.send(JSON.stringify(command));
}
function receiveEvent(event) {
  if (event.replayed) return;
  const id = event.threadId;
  if(event.type==='message.queued'){
    const pending=state.pending;
    if(pending?.requestId===event.requestId){
      delete state.drafts[pending.key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));
      state.imageDrafts[pending.key]=(state.imageDrafts[pending.key]||[]).filter(i=>!(pending.images||[]).some(p=>p.id===i.id));saveImageDrafts();renderImageDrafts();
      state.fileDrafts[pending.key]=(state.fileDrafts[pending.key]||[]).filter(i=>!(pending.files||[]).some(p=>p.id===i.id));saveFileDrafts();renderFileDrafts();
      state.pending=null;updateControls();
    }
    if(id)run(()=>refreshQueue(id));
    toast(event.message||'消息已加入待发队列');
    return;
  }
  if (event.type === "error") {
    if (id) {
      state.events.set(id, mergeEvents(state.events.get(id) || [], [event]).slice(-10000));
      state.hydrating.get(id)?.push(event);
    }
    const matches =
      !event.requestId || event.requestId === state.pending?.requestId;
    if (matches && (!id || id === state.threadId)) {
      if (state.pending) restorePendingDraft();
      const thread = activeThread();
      if (thread) thread.status = "error";
      toast(event.message || "任务执行失败", true);
      renderConversation();
      updateControls();
    }
    return;
  }
  if (event.type === "thread.started") {
    const old = state.threads.find((t) => t.id === id);
    const next = {
      ...old,
      ...event.thread,
      id,
      title: event.thread?.title || old?.title || "新会话",
      projectPath: event.thread?.projectPath || old?.projectPath || "",
    };
    state.threads = [next, ...state.threads.filter((t) => t.id !== id)];
    if (state.pending?.requestId === event.requestId && event.requestId) {
      state.pending.threadId = id;
      if (state.selection === state.pending.selection) {
        state.threadId = id;
        safeWrite('cmc.threadModel.'+id,$('chatModel').value);
        fillModelChoices();
        state.chatProject = state.pending.project || state.projects.find(p=>comparablePath(p.path)===comparablePath(next.projectPath))?.id || '';
      }
    }
    renderThreads();
    queueRender();
  }
  if (event.type === "projects.changed" || event.type === "project.changed")
    run(refreshProjects);
  if (event.type === "codex.status") run(refreshCodex);
  if (id) {
    state.events.set(
      id,
      mergeEvents(state.events.get(id) || [], [event]).slice(-10000),
    );
    state.hydrating.get(id)?.push(event);
  }
  if (event.type === "user.message") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = "running";
    const pending = state.pending;
    if (
      pending &&
      event.text === pending.text &&
      (pending.threadId === id || !pending.threadId)
    ) {
      if (state.drafts[pending.key] === pending.text) {
        delete state.drafts[pending.key];
        safeWrite("cmc.drafts", JSON.stringify(state.drafts));
      }
      if (state.threadId === id && $("prompt").value.trim() === pending.text) {
        $("prompt").value = "";
        resizeComposer();
      }
      state.pending = null;
      state.imageDrafts[pending.key]=(state.imageDrafts[pending.key]||[]).filter(i=>!(pending.images||[]).some(p=>p.id===i.id));saveImageDrafts();renderImageDrafts();
      state.fileDrafts[pending.key]=(state.fileDrafts[pending.key]||[]).filter(i=>!(pending.files||[]).some(p=>p.id===i.id));saveFileDrafts();renderFileDrafts();
    }
  }
  if (event.type === "message.delta") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = "running";
  }
  if (event.type === "turn.completed") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = event.status;
    queueThreadRefresh();
  }
  if (event.type.startsWith("approval.")) run(refreshApprovals);
  if (event.type === "terminal.output" && id?.startsWith("terminal:")) {
    if (!terminalTimer)
      terminalTimer = setTimeout(() => {
        terminalTimer = null;
        run(refreshTerminals);
      }, 160);
  }
  if (event.type === "thread.started" || event.type === "user.message")
    queueThreadRefresh();
  if (id === state.threadId) queueRender();
  updateControls();
}
function queueRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderConversation();
    });
  }
}
function queueThreadRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => run(refreshThreads), 350);
}
async function refreshProjects() {
  const { projects } = await api("/api/projects");
  state.projects = projects || [];
  if (state.threadId && !state.chatProject) state.chatProject = state.projects.find(p=>comparablePath(p.path)===comparablePath(activeThread()?.projectPath))?.id || '';
  const sidebar=await api('/api/sidebar');
  state.sidebarProjects=sidebar.projects || state.projects;
  renderProjects();
}
function renderProjects() {
  const query = $("search").value.toLowerCase();
  const visible = (state.sidebarProjects.length?state.sidebarProjects:state.projects).filter((p) =>
    `${p.name} ${p.path}`.toLowerCase().includes(query),
  );
  $("projects").replaceChildren(
    ...visible.map((project) => {
      const row = button(
        "",
        () => {if(project.trusted)return selectProject(project);openProjectDialog();$('projectPath').value=project.path;},
        `project-row${state.chatProject === project.id ? " active" : ""}`,
      );
      row.title = project.path;
      if(!project.trusted)row.title+=' · 点击接入项目';
      row.append(
        el("span", "project-letter", project.name.slice(0, 1).toUpperCase()),
        el("span", "label", project.name),
      );
      return row;
    }),
  );
  if (!visible.length)
    $("projects").append(
      el(
        "div",
        "sidebar-empty",
        state.connected
          ? query
            ? "没有匹配的项目"
            : "添加一个项目，开始工作。"
          : "连接后同步工作项目",
      ),
    );
  for (const [id, key] of [
    ["chatProject", "chatProject"],
    ["filesProject", "fileProject"],
    ["terminalProject", "terminalProject"],
  ]) {
    const select = $(id);
    select.replaceChildren(
      new Option(id === 'chatProject' ? "项目（可选）" : "选择项目", ""),
      ...state.projects.map((p) => new Option(p.name, p.id)),
    );
    if (!state.projects.some((p) => p.id === state[key])) state[key] = "";
    select.value = state[key];
    select.disabled = !state.connected && !state.connecting;
  }
  renderThreads();
  renderRoots();
  updateControls();
}
async function refreshThreads() {
  const { threads } = await api("/api/threads");
  const before=state.threads.find(t=>t.id===state.threadId);
  const beforeKey=JSON.stringify([before?.status,before?.title,before?.goal]);
  state.threads = threads || [];
  if(state.threadId&&!state.threads.some(t=>t.id===state.threadId)&&!state.pending){
    storeDraft();state.threadId='';state.selection++;restoreDraft();renderConversation({followLatest:true});
  }
  renderThreads();
  updateControls();
  if (state.threadId) {
    updateContext();
    const after=state.threads.find(t=>t.id===state.threadId);
    if(beforeKey!==JSON.stringify([after?.status,after?.title,after?.goal]))queueRender();
  }
}
function renderThreads() {
  const query = $("search").value.toLowerCase();
  const visible = state.threads.filter((t) =>
    harnessForThread(t.id)===state.harness&&`${t.title} ${t.projectPath} ${t.goal?.objective||''}`.toLowerCase().includes(query),
  );
  const threadNode=(thread) => {
      const row = button(
        "",
        () => openThread(thread),
        `thread-row ${thread.status || ""}${state.threadId === thread.id ? " active" : ""}`,
      );
      row.title = `${thread.title}\n${thread.projectPath || ""}`;
      row.append(
        el("span", "thread-indicator"),
        el("span", "thread-title", thread.title || "未命名会话"),
      );
      row.oncontextmenu=event=>{event.preventDefault();if(!pressed)showThreadMenu(row,thread);};
      let pressTimer,pressed=false;
      row.addEventListener('pointerdown',event=>{pressed=false;if(event.pointerType==='mouse')return;pressTimer=setTimeout(()=>{pressed=true;showThreadMenu(row,thread);},500);});
      for(const name of ['pointerup','pointercancel','pointerleave'])row.addEventListener(name,()=>clearTimeout(pressTimer));
      row.addEventListener('click',event=>{if(pressed){event.stopImmediatePropagation();event.preventDefault();pressed=false;}},true);
      return row;
    };
  const pinned=visible.filter(t=>t.pinnedIndex).sort((a,b)=>a.pinnedIndex-b.pinnedIndex);
  $('pinnedThreads').replaceChildren(...pinned.map(threadNode));
  $('pinnedHeading').hidden=!pinned.length;
  const activeGoals=visible.filter(t=>t.status==='running'||t.goal?.status==='active');
  $('activeGoalsHeading').hidden=!activeGoals.length;
  $('activeGoals').replaceChildren(...activeGoals.map(thread=>{
    const row=threadNode(thread);row.classList.add('goal-row');
    row.querySelector('.thread-title').textContent=thread.goal?.status==='active'?thread.goal.objective:thread.title;
    row.title=thread.goal?.status==='active'?`${thread.goal.objective}\n${thread.title}`:thread.title;
    return row;
  }));
  $("threads").replaceChildren(...visible.filter(t=>!t.pinnedIndex).slice(0,100).map(threadNode));
  applySidebarSections();
  if (!visible.filter(t=>!t.pinnedIndex).length)
    $("threads").append(
      el(
        "div",
        "sidebar-empty",
        state.connected
          ? query
            ? "没有匹配的会话"
            : "你的会话会出现在这里"
          : "连接后同步最近会话",
      ),
    );
}
const harnessNames={codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build'};
function harnessForThread(id=''){return /^(claude|antigravity|grok)-/.exec(id)?.[1]||'codex';}
function harnessForModel(model=''){return model.includes('::')?model.split('::')[0]:'codex';}
function updateHarnessLabel(){
  $('prompt').placeholder='向 '+harnessNames[state.harness]+' 描述任务';
  $('prompt').setAttribute('aria-label','发送给 '+harnessNames[state.harness]+' 的消息');
  for(const host of document.querySelectorAll('.brand-symbol,.welcome-mark,#openDrawer')){
    host.removeAttribute('data-icon');
    const mark=el('span','harness-mark harness-brand-mark');mark.dataset.harness=state.harness;mark.setAttribute('aria-hidden','true');host.replaceChildren(mark);
  }
  $('harnessBtn').replaceChildren(document.createTextNode(harnessNames[state.harness]),iconNode('chevron-down'));
}
async function switchHarness(harness){
  if(harness===state.harness)return;
  if(state.pending){toast('消息正在提交，请稍后切换');return;}
  storeDraft();safeWrite('cmc.workspace.'+state.harness,JSON.stringify({threadId:state.threadId,project:state.chatProject}));
  safeWrite('cmc.permission.'+state.harness,safeRead('cmc.permission')||'full');
  state.harness=harness;state.threadId='';state.selection++;safeWrite('cmc.harness',harness);
  safeWrite('cmc.permission',safeRead('cmc.permission.'+harness)||'full');
  let saved={};try{saved=JSON.parse(safeRead('cmc.workspace.'+harness)||'{}')}catch{}
  state.chatProject=saved.project||'';$('chatModel').value='';fillModelChoices();restoreDraft();updateHarnessLabel();
  renderProjects();renderThreads();showPage('chat');renderConversation({followLatest:true});closeDrawer();
  const thread=state.threads.find(t=>t.id===saved.threadId&&harnessForThread(t.id)===harness);
  if(thread)await openThread(thread);
}
$('harnessBtn').onclick=()=>{
  const dialog=el('dialog','choice-dialog harness-dialog');
  const header=el('div','choice-header');header.append(el('h3',null,'选择助手'),button('关闭',()=>dialog.close(),'text-button'));dialog.append(header);
  for(const [key,label] of Object.entries(harnessNames)){
    const available=state.models.some(m=>harnessForModel(m.model)===key);
    const row=button('',()=>{dialog.close();run(()=>switchHarness(key));},'harness-option');row.disabled=!available;row.setAttribute('aria-pressed',String(key===state.harness));
    const mark=el('span','harness-mark');mark.dataset.harness=key;mark.setAttribute('aria-hidden','true');
    row.append(mark,el('span','harness-name',label),el('span','harness-state',key===state.harness?'当前':available?'':'未检测到'));dialog.append(row);
  }
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
};
updateHarnessLabel();
async function selectProject(project) {
  if (!(await allowFileLeave())) return;
  storeDraft();
  state.selection++;
  state.threadId = "";
  state.chatProject = project.id;
  state.fileProject = project.id;
  state.terminalProject = project.id;
  resetFile();
  renderProjects();
  restoreDraft();
  showPage("chat");
  closeDrawer();
  renderConversation();
}
async function newThread() {
  if (!onlineRequired()) return;
  storeDraft();
  state.selection++;
  state.threadId = "";
  fillModelChoices();
  restoreDraft();
  showPage("chat");
  renderThreads();
  renderConversation();
  closeDrawer();
  $("prompt").focus();
}
async function openThread(thread) {
  storeDraft();
  state.selection++;
  state.threadId = thread.id;
  state.harness=harnessForThread(thread.id);safeWrite('cmc.harness',state.harness);updateHarnessLabel();
  fillModelChoices();
  const remembered=safeRead("cmc.threadModel."+thread.id);
  const options=[...$("chatModel").options].filter(o=>!o.disabled);
  $("chatModel").value=options.find(o=>o.value===remembered)?.value||options.find(o=>o.value===$("chatModel").value)?.value||options[0]?.value||"";
  fillChatEfforts();
  state.chatProject =
    state.projects.find(
      (p) => comparablePath(p.path) === comparablePath(thread.projectPath),
    )?.id || "";
  restoreDraft();
  renderProjects();
  showPage("chat");
  closeDrawer();
  renderConversation({ followLatest: true });
  await loadThread(thread.id);
}
async function loadThread(id,{older=false}={}) {
  if(!older&&state.historyLoading.has(id))return;
  const pendingEvents = [];
  state.hydrating.set(id, pendingEvents);
  try {
    const count=older?Math.min(20000,(state.historyCount.get(id)||180)+180):180;
    const { events, status, hasMore } = await api(
      `/api/threads/${encodeURIComponent(id)}/events?count=${count}`,
    );
    if (state.hydrating.get(id) !== pendingEvents) return;
    if(older||!state.historyCount.has(id)){
      state.historyCount.set(id,count);
      state.historyMore.set(id,Boolean(hasMore)&&count<20000);
    }else if(count===180&&state.historyCount.get(id)===180)state.historyMore.set(id,Boolean(hasMore));
    const history = events || [];
    const existing=state.events.get(id)||[];
    const firstKnown=existing.findIndex(event=>event.eventId&&event.eventId===history[0]?.eventId);
    const earlier=firstKnown>0?existing.slice(0,firstKnown):[];
    const merged=mergeEvents([...earlier,...history], pendingEvents);
    state.events.set(id,merged);
    const priorStatus=state.threads.find(thread=>thread.id===id)?.status;
    if(status && !pendingEvents.some(event=>event.type==='user.message'||event.type==='turn.completed') && !state.pending) {
      const thread=state.threads.find(thread=>thread.id===id);if(thread)thread.status=status;
    }
    const unchanged=!older&&existing.length===merged.length&&JSON.stringify(existing.at(-1))===JSON.stringify(merged.at(-1))&&priorStatus===status;
    if (state.threadId === id&&!unchanged) {
      renderConversation();
    }
    if(state.threadId===id)await refreshQueue(id);
  } finally {
    if (state.hydrating.get(id) === pendingEvents) state.hydrating.delete(id);
  }
}
async function loadOlderMessages(){
  const id=state.threadId;
  if(!id||!state.historyMore.get(id)||state.historyLoading.has(id))return;
  state.historyLoading.add(id);
  const control=$('loadOlder');control.disabled=true;
  followConversation=false;rememberReadingAnchor();
  try{await loadThread(id,{older:true});}
  finally{state.historyLoading.delete(id);control.disabled=false;control.hidden=!state.historyMore.get(state.threadId);}
}
async function sendPrompt() {
  if (isRunning()) {
    await enqueueMessage();
    return;
  }
  const text = $("prompt").value.trim();
  const images=state.imageDrafts[draftKey()]||[],files=state.fileDrafts[draftKey()]||[];
  if ((!text && !images.length&&!files.length) || !onlineRequired() || state.pending || state.uploading) return;
  const project = state.projects.find((p) => p.id === state.chatProject);
  storeDraft();
  const pending = {
    requestId: requestId(),
    text,
    images,
    files,
    key: draftKey(),
    project: state.chatProject,
    threadId: state.threadId,
    selection: state.selection,
  };
  state.pending = pending;
  try {
    sendCommand(
      state.threadId
        ? {
            type: "turn.start",
            images,
            files,
            threadId: state.threadId,
            projectPath: activeThread()?.projectPath,
            model: $("chatModel").value.trim(),
            effort: $('chatEffort').value || undefined,
            permission: safeRead('cmc.permission') || 'full',
            text,
            requestId: pending.requestId,
          }
        : {
            type: "thread.start",
            images,
            files,
            projectPath: project?.path,
            model: $("chatModel").value.trim(),
            effort: $('chatEffort').value || undefined,
            permission: safeRead('cmc.permission') || 'full',
            initialText: text,
            requestId: pending.requestId,
          },
    );
    $("prompt").value = "";
    resizeComposer();
    renderConversation();
    updateControls();
  } catch (error) {
    restorePendingDraft();
    updateControls();
    throw error;
  }
}
async function refreshQueue(id=state.threadId) {
  const host=$('followupQueue');
  if(!id){host.hidden=true;host.replaceChildren();host.dataset.signature='';return;}
  const result=await api(`/api/threads/${encodeURIComponent(id)}/queue`);
  if(state.threadId!==id)return;
  const wasLocked=state.writerLocked.has(id),isLocked=result.messages.some(message=>message.error?.includes('桌面版仍持有'));
  if(isLocked)state.writerLocked.add(id);else state.writerLocked.delete(id);
  if(wasLocked!==isLocked)queueRender();
  const signature=JSON.stringify(result.messages);
  if(host.dataset.signature===id+signature)return;
  host.dataset.signature=id+signature;host.hidden=!result.messages.length;
  host.replaceChildren(...result.messages.map(message=>{
    const row=el('div','queued-message');
    const content=el('div','queued-content');
    content.append(el('span','queued-text',message.text || `${message.images?.length||0} 张图片 · ${message.files?.length||0} 个文件`));
    const status=message.status==='sending'?'发送中':message.error||message.status==='failed'?'待处理':'';
    if(status)content.append(el('small',null,status));
    row.append(iconNode('list'),content);
    const menu=button('',()=>showMenu(menu,[
      ['编辑消息',()=>restoreQueuedMessage(id,message)],
      ...(message.canSteer?[['改为引导',()=>queueAction(id,message.id,'steer')]]:[]),
      ...(message.status==='failed'?[['重试发送',()=>queueAction(id,message.id,'retry')]]:[]),
      ...(message.error?[['复制错误详情',()=>copy(message.error)]]:[]),
      ['取消发送',()=>queueAction(id,message.id,'delete')],
    ]),'icon-button');menu.append(iconNode('more'));menu.setAttribute('aria-label','待发消息操作');menu.disabled=message.status==='sending';row.append(menu);
    if(message.error)row.title=message.error;return row;
  }));
}
async function queueAction(threadId,id,action,body) {
  const base=`/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(id)}`;
  await api(['steer','retry'].includes(action)?base+'/'+action:base,{method:action==='delete'?'DELETE':action==='edit'?'PATCH':'POST',body});
  await refreshQueue(threadId);
}
async function restoreQueuedMessage(threadId,message){
  if(state.threadId!==threadId)return;
  if(state.uploading){toast('文件上传完成后再编辑待发消息');return;}
  const key=draftKey();
  const images=[...(message.images||[]),...(state.imageDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index);
  const files=[...(message.files||[]),...(state.fileDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index);
  if(images.length>8||files.length>8){toast('输入框附件已满，请先移除部分附件再编辑待发消息');return;}
  await queueAction(threadId,message.id,'delete');
  if(state.threadId!==threadId)return;
  $('prompt').value=[message.text,$('prompt').value].filter(Boolean).join('\n\n');
  storeDraft();state.imageDrafts[key]=images;saveImageDrafts();renderImageDrafts();
  state.fileDrafts[key]=files;saveFileDrafts();renderFileDrafts();
  resizeComposer();updateControls();$('prompt').focus({preventScroll:true});
}
let queueSubmitting=false;
async function enqueueMessage() {
  if(queueSubmitting||!state.threadId||!onlineRequired())return;
  const text=$('prompt').value.trim(),key=draftKey(),images=state.imageDrafts[key]||[],files=state.fileDrafts[key]||[],id=state.threadId;
  if(!text&&!images.length&&!files.length)return;
  queueSubmitting=true;
  updateControls();
  try{
    await api(`/api/threads/${encodeURIComponent(id)}/queue`,{method:'POST',body:{id:requestId(),text,images,files,model:$('chatModel').value,effort:$('chatEffort').value||undefined,permission:safeRead('cmc.permission')||'full'}});
    if(state.threadId===id&&$('prompt').value.trim()===text){$('prompt').value='';storeDraft();resizeComposer();}
    state.imageDrafts[key]=(state.imageDrafts[key]||[]).filter(i=>!images.some(x=>x.id===i.id));saveImageDrafts();renderImageDrafts();await refreshQueue(id);
    state.fileDrafts[key]=(state.fileDrafts[key]||[]).filter(i=>!files.some(x=>x.id===i.id));saveFileDrafts();renderFileDrafts();
  }finally{queueSubmitting=false;updateControls();}
}
function restorePendingDraft() {
  const pending = state.pending;
  if (pending && state.selection === pending.selection && !$("prompt").value) {
    $("prompt").value = pending.text;
    resizeComposer();
  }
  state.pending = null;
}
function updateContext() {
  $("pageLabel").textContent = pageNames[state.page];
  $("contextLabel").textContent =
    state.page === "chat"
      ? activeThread()?.title || "新会话"
      : state.projects.find(
          (p) =>
            p.id ===
            (state.page === "files"
              ? state.fileProject
              : state.terminalProject),
        )?.name || "我的电脑";
}
const outputImageGrants=new Map();
function markdownNode(text,projectId=state.chatProject,basePath='') {
  const node = el("div", "markdown");
  const renderer=new marked.Renderer();
  renderer.image=function(token) {
    if(localFilePath(token.href)===null)return marked.Renderer.prototype.image.call(this,token);
    return `<span data-output-image="${encodeURIComponent(token.href)}"></span>`;
  };
  renderer.link=function(token) {
    const local=localFilePath(token.href);
    if(local===null) return marked.Renderer.prototype.link.call(this,token);
    const safe=encodeURIComponent(token.href);
    return `<a href="#output-file" data-output-file="${safe}">${this.parser.parseInline(token.tokens)}</a>`;
  };
  node.innerHTML = DOMPurify.sanitize(
    marked.parse(text || "", { breaks: true,renderer }),
    {
      FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
      FORBID_ATTR: ["style"],
    },
  );
  node.querySelectorAll("a").forEach((a) => {
    if(a.dataset.outputFile) {
      a.onclick=event=>{event.preventDefault();run(()=>openOutputFile(decodeURIComponent(a.dataset.outputFile),projectId,basePath));};
      return;
    }
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  renderMath(node);
  node.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code');if(code)pre.append(button('复制',()=>copy(code.textContent),'code-copy glyph-action'))});
  node.querySelectorAll('[data-output-image]').forEach(holder=>{
    const href=decodeURIComponent(holder.dataset.outputImage);
    try {
      const file=resolveFileLink(href,state.projects,projectId,basePath),key=JSON.stringify(file);
      let grant=outputImageGrants.get(key);
      if(!grant||grant.expires<Date.now()){grant={expires:Date.now()+50*60*1000,promise:api('/api/preview/file',{method:'POST',body:file})};outputImageGrants.set(key,grant);}
      grant.promise.then(value=>{const image=el('img','inline-output-image');image.src=value.url;image.alt=file.path;image.onclick=()=>run(()=>openOutputFile(href,projectId,basePath));holder.replaceChildren(image)}).catch(error=>{outputImageGrants.delete(key);holder.textContent='图片无法加载：'+errorMessage(error)});
    } catch(error){holder.textContent=errorMessage(error)}
  });
  return node;
}
async function openOutputFile(href,projectId,basePath='') {
  const file=resolveFileLink(href,state.projects,projectId,basePath);
  if(!file) return;
  const modal=el('dialog','output-modal');
  const heading=el('div','output-heading'),title=el('h2',null,file.path.split('/').pop());
  const close=button('关闭',()=>modal.close(),'button secondary');
  const body=el('div','output-body','正在打开文件…');
  heading.append(title,close);modal.append(heading,body);document.body.append(modal);
  modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();
  try {
    const grant=await api('/api/preview/file',{method:'POST',body:file});
    if(!modal.isConnected)return;
    const download=el('a','button secondary','下载');download.href=grant.url+'?download=1';download.download=title.textContent;
    download.innerHTML=icon('download');download.title='下载';download.setAttribute('aria-label','下载');
    heading.insertBefore(download,close);
    if(/\.pdf$/i.test(file.path)) await renderPdf(body,grant.url);
    else if(previewKind(file.path)==='image') {const img=el('img');img.alt=file.path;img.src=grant.url;body.replaceChildren(img);}
    else if(previewKind(file.path)==='web') {const frame=el('iframe');frame.sandbox='allow-scripts';frame.title=file.path;frame.src=grant.url;body.replaceChildren(frame);}
    else if(previewKind(file.path)==='text') {
      const result=await api(`/api/projects/${file.projectId}/file?path=${encodeURIComponent(file.path)}`);
      body.replaceChildren(/\.(md|markdown)$/i.test(file.path)?markdownNode(result.content,file.projectId,parentPath(file.path)):el('pre','output-text',result.content));
    } else body.textContent='此文件可下载到设备后打开。';
  } catch(error) {body.textContent='无法打开文件：'+errorMessage(error);}
}
let conversationCache = new Map();
let conversationThread = null;
let followConversation = true;
let readingAnchor = null;
function rememberReadingAnchor() {
  const scroll = $('conversationScroll'), top = scroll.getBoundingClientRect().top;
  const node = [...$('events').children].find(node => node.getBoundingClientRect().bottom > top);
  readingAnchor = node ? {key:node.dataset.messageKey,offset:node.getBoundingClientRect().top-top} : null;
}
function restoreReadingAnchor() {
  const scroll=$('conversationScroll');
  if(followConversation){scroll.scrollTop=scroll.scrollHeight;return;}
  const node=readingAnchor && [...$('events').children].find(node=>node.dataset.messageKey===readingAnchor.key);
  if(node) scroll.scrollTop+=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top-readingAnchor.offset;
}
const conversationResize = new ResizeObserver(()=>restoreReadingAnchor());
conversationResize.observe($('events'));
conversationResize.observe($('conversationScroll'));
function renderConversation({ followLatest = false } = {}) {
  const container = $("conversationScroll");
  const previousTop = container.scrollTop;
  if($('followupQueue').dataset.thread!==state.threadId){$('followupQueue').hidden=true;$('followupQueue').dataset.thread=state.threadId;}
  const expanded=new Map([...container.querySelectorAll('details[data-activity-key]')].map(node=>[node.dataset.activityKey,node.open]));
  if (conversationThread !== state.threadId) { conversationThread=state.threadId; conversationCache.clear(); followConversation=true; readingAnchor=null; }
  if (followLatest) followConversation=true;
  const nearBottom = followConversation;
  if(!nearBottom) rememberReadingAnchor();
  const events = state.events.get(state.threadId) || [];
  let lastUser=-1;events.forEach((event,i)=>{if(event.type==='user.message')lastUser=i});
  const taskEvents=events.slice(lastUser+1),completed=new Set(taskEvents.filter(e=>e.type==='tool.completed').map(e=>e.itemId));
  const active=taskEvents.filter(e=>e.type==='tool.started'&&!completed.has(e.itemId)).slice(-1)[0];
  $('taskProgress').hidden=!isRunning();
  $('taskProgress').textContent=isRunning()?active?.title&&active.title!=='exec'?active.title:'':'';
  $('taskProgress').setAttribute('aria-label',isRunning()?'正在执行任务':'');
  $('loadOlder').hidden=!state.threadId||!state.historyMore.get(state.threadId);
  const blocks = groupToolActivity(conversationBlocks(events, state.threadId, {showWarnings: state.showWarnings}),{running:isRunning()});
  const pending =
    state.pending &&
    (state.pending.threadId === state.threadId || !state.threadId)
      ? state.pending
      : null;
  const hasConversation =
    blocks.length > 0 || Boolean(state.threadId) || pending;
  $("welcome").hidden = Boolean(hasConversation);
  $("chatPage").classList.toggle("is-empty", !hasConversation);
  $("chatHeader").hidden = !state.threadId;
  $("threadTitle").textContent = activeThread()?.title || "新会话";
  $("threadMeta").textContent = [
    state.projects.find((p) => p.id === state.chatProject)?.name ||
      activeThread()?.projectPath,
    state.writerLocked.has(state.threadId)?'桌面占用':statusLabel(activeThread()?.status),
  ]
    .filter(Boolean)
    .join(" · ");
  const goal=activeThread()?.goal;
  const goalDock=$('goalDock');
  if(goalDock.dataset.threadId!==state.threadId){$('goalDetails').hidden=true;$('threadGoal').setAttribute('aria-expanded','false');goalDock.dataset.threadId=state.threadId||'';}
  goalDock.hidden=!goal;
  if(goal){
    const status=goal.status==='active'?'进行中':goal.status==='paused'?'已暂停':goal.status==='blocked'?'受阻':goal.status==='usage_limited'?'用量限制':'预算限制';
    $('goalChipText').textContent=`目标：${goal.objective}`;
    $('goalChipStatus').textContent=status;
    $('goalStatus').textContent=status;
    $('goalObjective').textContent=goal.objective;
    $('goalBudget').hidden=goal.tokenBudget==null;
    $('goalBudget').textContent=goal.tokenBudget==null?'':`已用 ${goal.tokensUsed} / ${goal.tokenBudget} tokens`;
    $('toggleGoal').textContent=goal.status==='paused'?'继续':'暂停';
    $('toggleGoal').hidden=!['active','paused'].includes(goal.status);
    $('editGoal').hidden=state.harness!=='codex';
  }
  const createBlock = (event) => {
    if(event.type==='activity.group'){
      const node=el('details','activity-block tool-group');
      node.dataset.activityKey=event.eventId || `${event.turnId}:${event.itemId}`;
      node.open=expanded.get(node.dataset.activityKey) || false;
      const entries=activityEntries(event.activities);
      const count=entries.filter(e=>e.type!=='reasoning.summary').length;
      node.append(el('summary',null,`处理过程${count?` · ${count} 项`:''}`));
      for(const activity of entries){
        const detail=el('div','tool-entry');
        detail.dataset.eventType=activity.type;
        detail.append(el('span','tool-entry-title',activity.title));
        const text=activity.type==='reasoning.summary' && cleanActivityLabel(activity.text)===activity.title
          ? activity.text.split('\n').slice(1).join('\n').trim() : activity.text;
        if(text)detail.append(activity.type==='reasoning.summary'?markdownNode(text):el('pre',null,text));
        node.append(detail);
      }
      return node;
    }
    if (event.type === "user.message") {
      const node = el("article", "message user");
      const bubble = el("div", "user-bubble");
      if(event.images?.length)bubble.append(imageGallery(event.images));
      if(event.files?.length)bubble.append(fileCards(event.files));
      if(event.attachments?.length) {
        const gallery=el('div','image-gallery');
        for(const file of event.attachments) {
          if(file.url?.startsWith('/api/threads/')) {
            const img=el('img','inline-output-image');img.alt=file.name;img.loading='lazy';img.src=file.url+'&token='+encodeURIComponent(state.token);
            img.onclick=()=>{const modal=el('dialog','output-modal'),body=el('div','output-body'),full=el('img');full.alt=file.name;full.src=img.src;body.append(full);modal.append(el('div','output-heading',file.name),body,button('关闭',()=>modal.close(),'button secondary'));document.body.append(modal);modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();};
            gallery.append(img);
          }
          else if(/\.(png|jpe?g|gif|webp)$/i.test(file.path)) gallery.append(markdownNode(`![${file.name.replace(/[\[\]]/g,'')}](<${file.path.replace(/\\/g,'/') }>)`));
          else bubble.append(button(file.name,()=>openOutputFile(file.path)));
        }
        if(gallery.childNodes.length)bubble.append(gallery);
      }
      if(event.text)bubble.append(el("div", "user-bubble-text", event.text));
      node.append(bubble);
      if(event.text?.trim().length>160)node.append(messageActions(event.text,true));
      return node;
    }
    if (event.type === "message.delta") {
      const node = el("article", "message assistant");
      node.append(markdownNode(event.text));
      if(event.text.trim().length>160)node.append(messageActions(event.text));
      return node;
    }
    if (event.type === "approval.requested" && event.approvalType === "question") return questionCard(event);
    if (event.type === "approval.requested") {
      const node = el("div", "activity-block approval-block");
      const approval = state.approvals.find((a) => a.id === event.approvalId);
      const resolved = approval && approval.status !== "pending";
      node.append(
        el(
          "h3",
          null,
          resolved
            ? approval.status === "accepted"
              ? "已允许"
              : approval.status === "expired" ? "请求已失效" : "已拒绝"
            : event.approvalType === "desktop" ? "电脑端权限请求" : "需要你的确认",
        ),
        el("div", null, event.title),
      );
      if (event.detail) node.append(el("pre", null, event.detail));
      if (!resolved && event.approvalId) {
        const row = el("div", "button-row");
        row.append(
          button(
            "允许",
            () => resolveApproval(event.approvalId, "accept"),
            "button compact",
          ),
          button(
            "拒绝",
            () => resolveApproval(event.approvalId, "decline"),
            "button secondary compact",
          ),
        );
        node.append(row);
      }
      return node;
    }
    const node = el("details", "activity-block");
    node.dataset.eventType = event.type;
    node.dataset.activityKey=event.eventId || `${event.type}:${event.turnId||''}:${event.itemId||''}`;
    if(event.type==='plan.updated'||event.type==='error')node.open=true;
    if(expanded.has(node.dataset.activityKey))node.open=expanded.get(node.dataset.activityKey);
    const title =
      (event.type === 'warning' && ['warning','configWarning','guardianWarning'].includes(event.title) ? '运行提示' : event.title) ||
      {
        "file.changed": "文件已更新",
        "diff.updated": "代码改动",
        "tool.started": "正在执行",
        "tool.completed": "执行完成",
        "tool.output": "执行输出",
        'reasoning.summary':'推理摘要',
        'plan.updated':'任务计划',
        warning: "提示",
        error: "任务失败",
      }[event.type] ||
      event.type;
    node.append(el("summary", null, title));
    const detail =
      event.text || event.diff || event.detail || event.message || event.files?.join("\n");
    if (detail) node.append(['reasoning.summary','plan.updated'].includes(event.type)?markdownNode(detail):el("pre", null, detail));
    if (event.type === "file.changed" || event.type === "diff.updated")
      node.append(
        button("查看改动", async () => {
          state.fileProject = state.chatProject;
          showPage("files");
          await switchFileMode("diff");
        }),
      );
    return node;
  };
  const nextCache=new Map();
  const nodes=blocks.map((event,index)=>{
    const key=`${state.threadId}:${event.type}:${event.eventId || event.itemId || index}`;
    const signature=JSON.stringify(event)+(event.type==='approval.requested'?JSON.stringify(state.approvals.find(a=>a.id===event.approvalId)):state.chatProject);
    const previous=conversationCache.get(key);
    const node=previous?.signature===signature?previous.node:createBlock(event);
    node.dataset.messageKey=key;nextCache.set(key,{signature,node});return node;
  });
  conversationCache=nextCache;
  if (
    pending &&
    !blocks.some((e) => e.type === "user.message" && e.text === pending.text)
  ) {
    const node = el("article", "message user");
    const bubble=el("div","user-bubble");
    if (pending.images?.length) bubble.append(imageGallery(pending.images));
    if (pending.files?.length) bubble.append(fileCards(pending.files));
    if (pending.text) bubble.append(el("div","user-bubble-text",pending.text));
    node.append(bubble,el("div", "message-caption", pending.threadId ? "正在提交…" : "正在创建任务…"));
    nodes.push(node);
  }
  if (pending)nodes.push(el("div", "running-indicator", "正在启动任务…"));
  const host=$('events');
  // Keep unchanged messages and loaded images mounted throughout streaming.
  nodes.forEach((node,index)=>{if(host.children[index]!==node)host.insertBefore(node,host.children[index] || null);});
  while(host.children.length>nodes.length)host.lastElementChild.remove();
  container.scrollTop = followLatest || nearBottom ? container.scrollHeight : previousTop;
  restoreReadingAnchor();
  $("jumpLatest").hidden = followLatest || nearBottom || !hasConversation;
  updateContext();
  updateControls();
}
async function showUsage(){
  if(!onlineRequired())return;
  const dialog=el('dialog','modal usage-dialog'),heading=el('div','usage-heading'),body=el('div','usage-body');
  let days=1;
  const title=el('h2',null,'用量与配额');title.id='usageTitle';dialog.setAttribute('aria-labelledby','usageTitle');
  const close=button('',()=>dialog.close(),'icon-button');close.append(iconNode('close'));close.setAttribute('aria-label','关闭');heading.append(title,close);
  const refresh=button('刷新',()=>load(),'button secondary compact');
  const periods=el('div','usage-periods');
  for(const [value,label] of [[1,'今天'],[7,'近 7 天'],[30,'近 30 天']]){
    const option=button(label,()=>{days=value;periods.querySelectorAll('button').forEach(node=>node.classList.toggle('selected',node===option));void load();},'usage-period');
    option.classList.toggle('selected',value===days);periods.append(option);
  }
  dialog.append(heading,periods,body,refresh);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  const id=state.threadId;
  const format=value=>typeof value==='number'?new Intl.NumberFormat('zh-CN').format(value):'—';
  async function load(){
    refresh.disabled=true;body.setAttribute('aria-busy','true');body.replaceChildren(el('p','muted','正在读取用量…'));
    try{
       const data=await api('/api/usage?agent='+state.harness+'&days='+days+(id?'&threadId='+encodeURIComponent(id):''),{timeout:15000});
      if(!dialog.isConnected)return;
      body.replaceChildren(el('h3',null,'账号额度'+(data.quota.plan?' · '+data.quota.plan.toUpperCase():'')));
      if(!data.quota.windows.length)body.append(el('p','muted','暂无账号额度数据'));
      for(const window of data.quota.windows){
        const card=el('div','usage-window'),duration=window.durationMins;
        const label=duration===null?'额度':duration>=1440?`${Math.round(duration/1440)} 天额度`:`${duration/60} 小时额度`;
        const row=el('div','usage-heading');row.append(el('span',null,window.name+' · '+label),el('strong',null,window.remainingPercent===null?'—':`${Math.round(window.remainingPercent)}% 剩余`));
        card.append(row);
        if(window.remainingPercent!==null){const track=el('div','usage-track'),fill=el('div');fill.style.width=window.remainingPercent+'%';track.setAttribute('role','meter');track.setAttribute('aria-label',label+'剩余');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',window.remainingPercent);track.append(fill);card.append(track);}
        card.append(el('small','muted',window.resetsAt?'重置于 '+new Date(window.resetsAt*1000).toLocaleString():'重置时间暂无数据'));body.append(card);
      }
      const now=Date.now(),start=days===1?new Date().setHours(0,0,0,0):now-days*86400000;
      const trend=(data.quotaTrend||[]).filter(point=>point.at>=start&&point.at<=now&&Number.isFinite(point.remainingPercent));
      const series=[{duration:300,label:'5 小时额度剩余',color:'#9382ed'},{duration:10080,label:'1 周额度剩余',color:'#55c8e5'}];
      const panel=el('section','usage-trend-panel');panel.append(el('h3',null,'配额剩余趋势'));
      const legend=el('div','usage-trend-legend');series.forEach(item=>{const label=el('span');const dot=el('i');dot.style.background=item.color;label.append(dot,document.createTextNode(item.label));legend.append(label);});panel.append(legend);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 190');svg.setAttribute('class','usage-trend-chart');svg.setAttribute('role','img');svg.setAttribute('aria-label','5 小时与 1 周额度剩余趋势');
      const add=(tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,String(value)));if(text!==undefined)node.textContent=text;svg.append(node);return node;};
      const left=37,right=352,top=10,bottom=160,span=Math.max(1,now-start),x=at=>left+(at-start)/span*(right-left),y=value=>bottom-value/100*(bottom-top);
      [0,25,50,75,100].forEach(value=>{add('line',{x1:left,y1:y(value),x2:right,y2:y(value),class:'usage-chart-grid'});add('text',{x:0,y:y(value)+4,class:'usage-chart-label'},value+'%');});
      for(let tick=0;tick<=3;tick++){const at=start+span*tick/3;add('text',{x:left+(right-left)*tick/3,y:185,'text-anchor':tick===0?'start':tick===3?'end':'middle',class:'usage-chart-label'},new Date(at).toLocaleString('zh-CN',days===1?{hour:'2-digit',minute:'2-digit'}:{month:'numeric',day:'numeric'}));}
      for(const item of series){
        const points=trend.filter(point=>point.durationMins===item.duration).sort((a,b)=>a.at-b.at);
        let path='',previous=null;
        for(const point of points){const command=previous!==null&&point.at-previous<=30*60000?'L':'M';path+=`${command}${x(point.at).toFixed(1)},${y(point.remainingPercent).toFixed(1)} `;previous=point.at;}
        if(path)add('path',{d:path,stroke:item.color,class:'usage-chart-line'});
        if(points.length){const last=points.at(-1);add('circle',{cx:x(last.at),cy:y(last.remainingPercent),r:3.5,fill:item.color});}
      }
      panel.append(svg);
      const counts=series.map(item=>{const count=trend.filter(point=>point.durationMins===item.duration).length;return `${item.label} ${count?`${count} 个真实采样`:'暂无数据'}`;});
      panel.append(el('small','muted',counts.join(' · ')));body.append(panel);
      if(data.quota.stale)body.append(el('p','muted','实时额度暂不可用'+(data.quota.updatedAt?'，显示 '+new Date(data.quota.updatedAt).toLocaleString()+' 的记录':'')));
      if(id||data.tokens){
        body.append(el('h3',null,'当前会话 Token'));
        if(!data.tokens)body.append(el('p','muted','当前会话暂无 Token 记录'));
        else{
        const grid=el('div','usage-tokens');
        for(const [key,label] of [['total','总量'],['input','输入'],['cached','缓存输入'],['output','输出'],['reasoning','推理输出'],['last','最近一次请求'],['contextWindow','上下文上限']]){const card=el('div');card.append(el('small','muted',label),el('strong',null,format(data.tokens[key])));grid.append(card);}
        body.append(grid,el('small','muted','缓存包含在输入中，推理包含在输出中。'));
        }
      }
    }catch(error){body.replaceChildren(el('p',null,/404|not found/i.test(error.message)?'电脑网关需要更新后才能查看用量，请运行“更新电脑网关”。':errorMessage(error)));}
    finally{refresh.disabled=false;body.removeAttribute('aria-busy');}
  }
  await load();
}
$('usageBtn').onclick=()=>run(showUsage);
function messageActions(text,user=false){
  const actions=el('div','message-actions');
  const copyButton=button('',async()=>{await copy(text,false);copyButton.textContent='✓';copyButton.setAttribute('aria-label','已复制');setTimeout(()=>{copyButton.replaceChildren(iconNode('copy'));copyButton.setAttribute('aria-label',user?'复制消息':'复制回复');},1800);},'icon-button');
  copyButton.append(iconNode('copy'));copyButton.setAttribute('aria-label',user?'复制消息':'复制回复');copyButton.title=copyButton.getAttribute('aria-label');actions.append(copyButton);
  return actions;
}
async function copy(text,notify=true) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = el("textarea");
    field.value = text;
    field.style.cssText = "position:fixed;opacity:0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (!ok) throw new Error("复制失败，请手动选择文本复制。");
  }
  if(notify)toast("已复制");
}
async function refreshApprovals() {
  const { approvals } = await api("/api/approvals"+(state.threadId?"?threadId="+encodeURIComponent(state.threadId):""));
  state.approvals = approvals || [];
  queueRender();
}
async function resolveApproval(id, decision) {
  await api(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: { decision },
  });
  await refreshApprovals();
}

function fileDirty() {
  return Boolean(
    state.opened?.editable && $("editor").value !== state.opened.original,
  );
}
async function allowFileLeave() {
  return (
    !fileDirty() ||
    (await confirmAction(
      "放弃未保存的修改？",
      "当前文件的修改尚未保存。放弃后将打开所选内容。",
    ))
  );
}
function resetFile() {
  state.fileRequest++;
  state.opened = null;
  state.diffSelected = null;
  $("fileWorkbench").classList.remove("show-detail");
  $("editor").hidden = true;
  $("filePreview").hidden = true;
  $("diffView").hidden = true;
  $("fileEmpty").hidden = false;
  $("openedFileName").textContent = "文件预览";
  $("fileEmpty").querySelector("h2").textContent = "打开一个文件";
  $("fileEmpty").querySelector("p").textContent =
    "浏览代码、编辑内容，或查看项目改动。";
  $("filePreviewBtn").hidden = true;
  updateControls();
}
async function switchFileMode(mode) {
  if (!(await allowFileLeave())) return;
  state.fileMode = mode;
  resetFile();
  $("fileModeBtn").classList.toggle("selected", mode === "files");
  $("diffModeBtn").classList.toggle("selected", mode === "diff");
  $("fileSearch").placeholder =
    mode === "diff" ? "筛选改动文件" : "筛选当前目录";
  $("fileSearch").value = "";
  await loadFiles("");
}
async function changeFileProject(id) {
  if (!(await allowFileLeave())) {
    $("filesProject").value = state.fileProject;
    return;
  }
  state.fileProject = id;
  state.filePath = "";
  resetFile();
  await loadFiles("");
  updateContext();
}
async function loadFiles(path = state.filePath) {
  const serial = ++state.listRequest;
  if (!state.fileProject) {
    state.files = [];
    state.diffFiles = [];
    renderFiles();
    return;
  }
  const project = state.fileProject;
  state.filePath = path;
  $("files").replaceChildren(el("div", "sidebar-empty", "正在读取…"));
  try {
    if (state.fileMode === "diff") {
      const data = await api(`/api/projects/${project}/diff/files`);
      if (serial !== state.listRequest) return;
      state.diffFiles = data.files || [];
    } else {
      const data = await api(
        `/api/projects/${project}/files?path=${encodeURIComponent(path)}`,
      );
      if (serial !== state.listRequest) return;
      state.files = data.files || [];
    }
    renderFiles();
  } catch (error) {
    if (serial === state.listRequest) {
      $("files").replaceChildren(el("div", "diff-empty", errorMessage(error)));
    }
    throw error;
  }
}
function renderFiles() {
  const diff = state.fileMode === "diff";
  const query = $("fileSearch").value.toLowerCase();
  $("filePathLabel").textContent = diff
    ? "Git 改动"
    : state.filePath || "项目根目录";
  $("upBtn").disabled = diff || !state.filePath;
  $("diffCount").textContent = state.diffFiles.length || "";
  const entries = (diff ? state.diffFiles : state.files).filter((file) =>
    (file.path || file.name).toLowerCase().includes(query),
  );
  $("files").replaceChildren(
    ...entries.map((file) => {
      const name = file.name || file.path;
      const row = button(
        "",
        () =>
          diff
            ? openDiff(file)
            : file.kind === "directory"
              ? loadFiles(file.path)
              : openFile(file),
        "file-row",
      );
      row.classList.toggle(
        "active",
        (state.opened?.path || state.diffSelected?.path) === file.path,
      );
      row.title = file.path;
      row.append(
        iconNode(file.kind === "directory" ? "folder" : "file"),
        el("span", "label", name),
        el(
          "small",
          null,
          diff
            ? `+${file.additions || 0} −${file.deletions || 0}`
            : file.kind === "directory"
              ? ""
              : formatSize(file.size),
        ),
      );
      return row;
    }),
  );
  if (!entries.length)
    $("files").append(
      el(
        "div",
        "diff-empty",
        !state.fileProject
          ? "选择一个项目以浏览文件。"
          : query
            ? "没有匹配的文件。"
            : diff
              ? "没有 Git 改动。"
              : "当前目录为空。",
      ),
    );
}
async function openFile(file) {
  if (!(await allowFileLeave())) return;
  resetFile();
  const serial = ++state.fileRequest;
  const project = state.fileProject;
  const kind = previewKind(file.path);
  $("fileWorkbench").classList.add("show-detail");
  $("openedFileName").textContent = file.path;
  $("fileEmpty").querySelector("h2").textContent = "正在打开…";
  try {
    if (kind === "image" || kind === "web" || kind === "binary") {
      state.opened = {
        project,
        path: file.path,
        kind,
        editable: false,
        original: "",
      };
      await previewFile();
    } else {
      const data = await api(
        `/api/projects/${project}/file?path=${encodeURIComponent(file.path)}`,
      );
      if (serial !== state.fileRequest) return;
      state.opened = {
        project,
        path: file.path,
        kind,
        editable: true,
        original: data.content,
      };
      $("editor").value = data.content;
      $("editor").hidden = false;
      $("fileEmpty").hidden = true;
      $("filePreviewBtn").hidden = !/\.(md|markdown)$/i.test(file.path);
      $("filePreviewBtn").textContent = "预览";
    }
    renderFiles();
    updateControls();
  } catch (error) {
    if (serial === state.fileRequest) {
      $("fileEmpty").hidden = false;
      $("fileEmpty").querySelector("h2").textContent = "无法打开文件";
      $("fileEmpty").querySelector("p").textContent = errorMessage(error);
    }
    throw error;
  }
}
async function previewFile() {
  const opened = state.opened;
  if (!opened) return;
  const target = $("filePreview");
  target.replaceChildren();
  target.hidden = false;
  $("editor").hidden = true;
  $("fileEmpty").hidden = true;
  if (opened.kind === "text") {
    target.append(markdownNode($("editor").value,opened.project,parentPath(opened.path)));
    $("filePreviewBtn").textContent = "返回编辑";
    return;
  }
  if (opened.kind === "image") {
    const image = el("img");
    image.alt = opened.path;
    image.src = `/raw/projects/${opened.project}/file?path=${encodeURIComponent(opened.path)}&token=${encodeURIComponent(state.token)}`;
    target.append(image);
  } else if (opened.kind === "web" || /\.pdf$/i.test(opened.path)) {
    const grant = await api("/api/preview/file", {
      method: "POST",
      body: { projectId: opened.project, path: opened.path },
    });
    if (state.opened !== opened) return;
    if(/\.pdf$/i.test(opened.path)) {await renderPdf(target,grant.url);return;}
    const frame = el("iframe");
    frame.title = opened.path;
    frame.sandbox = "allow-scripts";
    frame.src = grant.url;
    target.append(frame);
  } else {
    target.append(el("div", "pane-empty", "此文件不支持文本编辑。"));
  }
}
async function saveFile() {
  const opened = state.opened;
  if (!opened?.editable) return;
  const content = $("editor").value;
  await api(
    `/api/projects/${opened.project}/file?path=${encodeURIComponent(opened.path)}`,
    { method: "PUT", body: { content } },
  );
  if (state.opened === opened) opened.original = content;
  toast("文件已保存");
  updateControls();
}
function diffCode(text) {
  const node = el("pre", "diff-code");
  for (const line of text.split("\n")) {
    const cls = line.startsWith("@@")
      ? "hunk"
      : line.startsWith("+") && !line.startsWith("+++")
        ? "add"
        : line.startsWith("-") && !line.startsWith("---")
          ? "del"
          : "";
    node.append(el("span", `diff-line ${cls}`, line || " "));
  }
  return node;
}
async function openDiff(file) {
  if (!(await allowFileLeave())) return;
  resetFile();
  const serial = ++state.fileRequest;
  const project = state.fileProject;
  $("openedFileName").textContent = file.path;
  $("fileWorkbench").classList.add("show-detail");
  const [data, hunks] = await Promise.all([
    api(
      `/api/projects/${project}/diff/file?path=${encodeURIComponent(file.path)}`,
    ),
    api(
      `/api/projects/${project}/diff/file/hunks?path=${encodeURIComponent(file.path)}`,
    ),
  ]);
  if (serial !== state.fileRequest) return;
  state.diffSelected = file;
  $("fileEmpty").hidden = true;
  $("diffView").hidden = false;
  const view = $("diffView");
  view.replaceChildren();
  const actions = el("div", "diff-actions");
  const accept = button(
    "暂存文件",
    () => applyDiff("accept", file),
    "button compact",
  );
  accept.disabled = file.status === "accepted";
  actions.append(
    accept,
    button(
      "撤销文件改动",
      () => applyDiff("revert", file),
      "button secondary compact",
    ),
  );
  view.append(actions);
  if (hunks.hunks?.length) {
    for (const hunk of hunks.hunks) {
      const bar = el("div", "diff-actions");
      bar.append(
        el("span", "muted", hunk.source === "staged" ? "已暂存" : "工作区"),
      );
      if (hunk.source === "worktree")
        bar.append(button("暂存此处", () => applyDiff("accept", file, hunk)));
      bar.append(
        button(hunk.source === "staged" ? "取消暂存" : "撤销此处", () =>
          applyDiff("revert", file, hunk),
        ),
      );
      view.append(bar, diffCode(hunk.text));
    }
  } else view.append(diffCode(data.diff || "没有可显示的文本改动。"));
  renderFiles();
  updateControls();
}
async function applyDiff(action, file, hunk) {
  if (
    action === "revert" &&
    !(await confirmAction(
      hunk?.source === "staged" ? "取消暂存？" : "撤销改动？",
      `${file.path}${hunk ? " 的选定片段" : ""}。${hunk?.source === "staged" ? "工作区内容会保留。" : "未提交的修改将被丢弃，无法自动恢复。"}`,
    ))
  )
    return;
  const project = state.fileProject;
  await api(
    `/api/projects/${project}/diff/file/${hunk ? "hunk/" : ""}${action}?path=${encodeURIComponent(file.path)}`,
    {
      method: "POST",
      body: hunk ? { source: hunk.source, index: hunk.index } : {},
    },
  );
  toast(action === "accept" ? "已暂存" : "改动已撤销");
  resetFile();
  await loadFiles();
  const current = state.diffFiles.find((f) => f.path === file.path);
  if (current) await openDiff(current);
}

function isInteractive(record) {
  return Boolean(
    record?.interactive || record?.command?.includes("交互式会话"),
  );
}
async function refreshTerminals() {
  const data = await api("/api/terminal/commands?includeOutput=true&limit=100");
  state.terminalCommands = data.commands || [];
  renderTerminalList();
  if (state.activeTerminal) syncTerminalOutput();
  updateControls();
}
function renderTerminalList() {
  const project = state.projects.find((p) => p.id === state.terminalProject);
  const commands = state.terminalCommands.filter(
    (r) => !project || comparablePath(r.cwd) === comparablePath(project.path),
  );
  $("terminalCount").textContent = state.terminalCommands.filter(
    (r) => r.status === "running",
  ).length;
  $("terminalCount").hidden = $("terminalCount").textContent === "0";
  $("terminalList").replaceChildren(
    ...commands.map((record) => {
      const row = button(
        "",
        () => selectTerminal(record.commandId),
        `terminal-record${state.activeTerminal === record.commandId ? " active" : ""}`,
      );
      row.append(
        el(
          "strong",
          null,
          isInteractive(record) ? "PowerShell" : record.command || "终端",
        ),
        el("small", null, statusLabel(record.status)),
      );
      return row;
    }),
  );
  if (!commands.length)
    $("terminalList").append(el("div", "sidebar-empty", "暂无终端记录"));
}
function ensureTerminal() {
  if (state.terminal) return;
  if (!window.Terminal || !window.FitAddon)
    throw new Error("终端组件加载失败，请刷新页面。");
  const terminal = new window.Terminal({
    cursorBlink: true,
    screenReaderMode: true,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, monospace",
    lineHeight: 1.35,
    scrollback: 10000,
    convertEol: true,
    theme: {
      background: "#172018",
      foreground: "#d7e2cd",
      cursor: "#9bc277",
      selectionBackground: "#688a4744",
      black: "#273024",
      red: "#e58b72",
      green: "#aacd86",
      yellow: "#d5c28c",
      blue: "#91b3cd",
      magenta: "#c09bce",
      cyan: "#91c3b1",
      white: "#d7e2cd",
    },
  });
  const fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open($("terminalHost"));
  state.terminal = terminal;
  state.terminalFit = fit;
  terminal.onData((text) => {
    const record = state.terminalCommands.find(
      (r) => r.commandId === state.activeTerminal,
    );
    if (state.connected && isInteractive(record) && record.status === "running")
      run(() =>
        api(
          `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/input`,
          { method: "POST", body: { text, appendNewline: false } },
        ),
      );
  });
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitTerminal, 100);
  }).observe($("terminalHost"));
}
function fitTerminal() {
  if (!state.terminal || state.page !== "terminal" || !state.activeTerminal)
    return;
  state.terminalFit.fit();
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (state.connected && isInteractive(record) && record.status === "running")
    run(() =>
      api(
        `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/resize`,
        {
          method: "POST",
          body: {
            cols: Math.max(20, Math.min(240, state.terminal.cols)),
            rows: Math.max(5, Math.min(80, state.terminal.rows)),
          },
        },
      ),
    );
}
function selectTerminal(id) {
  state.activeTerminal = id;
  state.terminalOutput = "";
  ensureTerminal();
  state.terminal.reset();
  $("terminalEmpty").hidden = true;
  renderTerminalList();
  syncTerminalOutput();
  fitTerminal();
  state.terminal.focus();
  updateControls();
}
function syncTerminalOutput() {
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (!record || !state.terminal) return;
  const text = record.output || "";
  if (text.startsWith(state.terminalOutput))
    state.terminal.write(text.slice(state.terminalOutput.length));
  else {
    state.terminal.reset();
    state.terminal.write(text);
  }
  state.terminalOutput = text;
  $("terminalTitle").textContent = record.command || "终端";
  $("terminalStatus").textContent =
    `${statusLabel(record.status)} · ${record.cwd || ""}`;
}
async function newTerminal() {
  if (!onlineRequired() || !state.terminalProject) return;
  const project = state.terminalProject;
  const result = await api(`/api/projects/${project}/terminal/session`, {
    method: "POST",
    body: { cols: 100, rows: 30 },
  });
  await refreshTerminals();
  if (state.terminalProject === project) selectTerminal(result.sessionId);
}
async function runTerminalCommand() {
  const command = $("commandInput").value;
  if (!command.trim() || !onlineRequired() || !state.terminalProject) return;
  const active = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (isInteractive(active) && active.status === "running")
    await api(
      `/api/terminal/sessions/${encodeURIComponent(active.commandId)}/input`,
      { method: "POST", body: { text: command, appendNewline: true } },
    );
  else {
    const result = await api(
      `/api/projects/${state.terminalProject}/terminal/run`,
      { method: "POST", body: { command } },
    );
    await refreshTerminals();
    selectTerminal(result.commandId);
  }
  if ($("commandInput").value === command) $("commandInput").value = "";
}
async function stopTerminal() {
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (!record) return;
  await api(
    isInteractive(record)
      ? `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/stop`
      : `/api/terminal/${encodeURIComponent(record.commandId)}/stop`,
    { method: "POST", body: {} },
  );
  await refreshTerminals();
}

async function loadSettings() {
  await loadModels();
  const [settingsResult, rawResult, summaryResult, remoteApprovalResult, publicAccessResult] = await Promise.allSettled([
    api("/api/settings/user"),
    api("/api/settings/user/raw"),
    api("/api/settings/approval-summary"),
    api("/api/settings/remote-approval"),
    api('/api/settings/public-access'),
  ]);
  if (settingsResult.status === "fulfilled") {
    const initialSettings=!state.settingsLoaded;
    state.settings = settingsResult.value.settings || {};
    state.settingsLoaded = true;
    if (!state.settingsDirty) fillSettings();
    if (initialSettings && state.harness==='codex' && !safeRead('cmc.model.codex') && !safeRead('cmc.model') && state.models.some(m=>m.model===state.settings.model))
      $("chatModel").value = state.settings.model || "";
    fillChatEfforts();
  }
  if (rawResult.status === "fulfilled" && !state.rawDirty) {
    $("configPath").textContent = rawResult.value.config.path;
    $("rawConfig").value = rawResult.value.config.content;
  }
  if (summaryResult.status === "fulfilled")
    $("approvalSummary").textContent = summaryResult.value.summary.summary;
  if(remoteApprovalResult.status==='fulfilled')$('settingRemoteAutoApproval').checked=remoteApprovalResult.value.desktopAutoApprove===true;
  if(publicAccessResult.status==='fulfilled'){
    const access=publicAccessResult.value.publicAccess;
    $('publicAccessStatus').textContent=access.configured?(access.publicUrl||'已设置公网密码'):'尚未配置公网入口';
    $('publicPasswordForm').hidden=!access.configured;
  }else $('publicAccessStatus').textContent='公网配置读取失败';
  await refreshCodex();
  updateControls();
}
const settingsFields = {
  model: "settingModel",
  reasoningEffort: "settingEffort",
  modelProvider: "settingProvider",
  providerBaseUrl: "settingBaseUrl",
  approvalPolicy: "settingApproval",
  sandboxMode: "settingSandbox",
  networkAccess: "settingNetwork",
  disableResponseStorage: "settingStorage",
};
function fillSettings() {
  for (const [key, id] of Object.entries(settingsFields)) {
    const field = $(id);
    if (field.type === "checkbox") field.checked = Boolean(state.settings[key]);
    else {
      const value = state.settings[key] || "";
      if (key !== 'model' &&
        field.tagName === "SELECT" &&
        !Array.from(field.options).some((o) => o.value === value)
      )
        field.add(new Option(value, value));
      field.value = value;
    }
  }
  fillModelChoices();
}
async function loadModels() {
  try {
    const result=await api('/api/models?agents=all');
    state.models=result.models || [];
    if(!state.models.length) throw new Error('电脑上的 Codex 没有可选模型');
    fillModelChoices();
  } catch(error) {
    state.models=[];
    for(const id of ['chatModel','settingModel']) {$(id).replaceChildren(new Option('模型列表加载失败',''));$(id).disabled=true;}
    toast(errorMessage(error),true);
    throw error;
  }
}
function fillModelChoices() {
  for(const id of ['chatModel','settingModel']) {
    const node=$(id),previous=node.value || safeRead('cmc.model.'+state.harness) || (state.harness==='codex'?safeRead('cmc.model')||state.settings?.model:'');
    const engine=value=>value.includes('::')?value.split('::')[0]:'codex';
    const models=state.models.filter(m=>engine(m.model)===(id==='settingModel'?'codex':state.harness));
    node.replaceChildren(...models.map(m=>{const option=new Option(m.displayName,m.model);option.dataset.agent=engine(m.model);return option;}));
    node.value=models.some(m=>m.model===previous)?previous:models.find(m=>m.model.endsWith('::default'))?.model||models[0]?.model||'';
    node.disabled=!models.length;
  }
  fillEfforts();
  fillChatEfforts();
}
function fillChatEfforts(){
  const model=state.models.find(m=>m.model===$('chatModel').value),select=$('chatEffort');
  const remembered=safeRead('cmc.effort.'+(model?.model||'')),choices=model?.supportedReasoningEfforts||[];
  const labels={none:'关闭',minimal:'最少',low:'轻量',medium:'标准',high:'深入',xhigh:'更深入',max:'最高',ultra:'极致'};
  select.replaceChildren(...choices.map(e=>{
    const label=labels[e.reasoningEffort]||e.reasoningEffort;
    const option=new Option(`${label} · ${e.reasoningEffort}`,e.reasoningEffort);
    option.dataset.compactLabel=label;
    return option;
  }));
  const preferred=remembered||state.settings?.reasoningEffort||model?.defaultReasoningEffort;
  select.value=choices.some(e=>e.reasoningEffort===preferred)?preferred:model?.defaultReasoningEffort||choices[0]?.reasoningEffort||'';
  if(!choices.length)select.add(new Option('模型默认',''));
  select.disabled=!state.connected||!choices.length;
}
$('chatModel').addEventListener('change',()=>{safeWrite('cmc.model.'+state.harness,$('chatModel').value);if(state.threadId)safeWrite('cmc.threadModel.'+state.threadId,$('chatModel').value);fillChatEfforts();});
$('chatEffort').addEventListener('change',()=>safeWrite('cmc.effort.'+$('chatModel').value,$('chatEffort').value));
function fillEfforts() {
  const model=state.models.find(m=>m.model===$('settingModel').value);
  const current=$('settingEffort').value;
  $('settingEffort').replaceChildren(...(model?.supportedReasoningEfforts || []).map(e=>new Option(e.reasoningEffort,e.reasoningEffort)));
  $('settingEffort').value=[...$('settingEffort').options].some(o=>o.value===current)?current:model?.defaultReasoningEffort || '';
}
$('settingModel').addEventListener('change',fillEfforts);
async function saveSettings() {
  if (!state.settingsLoaded) return;
  const settings = {};
  for (const [key, id] of Object.entries(settingsFields))
    if(key!=='modelProvider' && key!=='providerBaseUrl')
    settings[key] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
  const result = await api("/api/settings/user", {
    method: "PUT",
    body: settings,
  });
  state.settings = result.settings;
  state.settingsDirty = false;
  await loadSettings();
  toast("设置已保存");
}
async function refreshCodex() {
  const { codex } = await api("/api/codex/status");
  state.codex = codex;
  $("codexStatus").replaceChildren(
    el("div", null, codex.running ? "● Codex 正在运行" : "○ Codex 尚未启动"),
    el("div", "muted", codex.cliVersion || "未检测到 Codex CLI"),
  );
  if (codex.lastError)
    $("codexStatus").append(el("p", "muted", codex.lastError));
  $("codexStartBtn").disabled = codex.running;
  $("codexRestartBtn").disabled = !state.connected;
}
async function refreshDevices() {
  const { devices } = await api("/api/devices");
  $("devices").replaceChildren(
    ...(devices || [])
      .filter((d) => !d.revokedAt)
      .map((device) => {
        const row = el("div", "settings-row");
        const content = el("div");
        content.append(
          el("strong", null, device.name),
          el(
            "small",
            null,
            device.lastSeenAt
              ? new Date(device.lastSeenAt).toLocaleString("zh-CN")
              : "已配对",
          ),
        );
        row.append(
          content,
          button("撤销", async () => {
            if (
              !(await confirmAction(
                "撤销设备？",
                `${device.name} 将无法继续访问电脑端。`,
              ))
            )
              return;
            await api(`/api/devices/${device.id}`, { method: "DELETE" });
            await refreshDevices();
          }),
        );
        return row;
      }),
  );
  if (!$("devices").childElementCount)
    $("devices").append(el("p", "muted", "暂无已配对设备。"));
}
function renderRoots() {
  $("projectRoots").replaceChildren(
    ...state.projects.map((project) => {
      const row = el("div", "settings-row");
      const content = el("div");
      content.append(
        el("strong", null, project.name),
        el("small", null, project.path),
      );
      row.append(
        content,
        button("移除", async () => {
          if (
            !(await confirmAction(
              "移除项目？",
              `将移除 ${project.name} 的访问权限，电脑上的文件会保留。`,
            ))
          )
            return;
          await api(
            `/api/config/project-roots?path=${encodeURIComponent(project.path)}`,
            { method: "DELETE" },
          );
          await refreshProjects();
        }),
      );
      return row;
    }),
  );
  if (!state.projects.length)
    $("projectRoots").append(el("p", "muted", "还没有添加项目目录。"));
}
async function pairStart() {
  if (!onlineRequired()) return;
  const data = await api('/api/pair/start?baseUrl='+encodeURIComponent($('pairAddress').value));
  $('pairAddress').replaceChildren(...data.addresses.map(a=>new Option(`${a.name} · ${a.url}`,a.url)));
  $('pairAddress').value=data.baseUrl;
  $("pairQr").innerHTML = DOMPurify.sanitize(data.qrSvg, {
    USE_PROFILES: { svg: true },
  });
  $("pairCode").textContent = data.code;
  $("pairWebLink").href = `${data.baseUrl}/console`;
  $("pairWebLink").textContent = `手机浏览器打开 ${data.baseUrl}`;
  $("pairExpiry").textContent =
    `配对码有效至 ${new Date(data.expiresAt).toLocaleTimeString("zh-CN")}，电脑与手机需要在同一网络。`;
  openDialog("pairDialog");
}
async function previewLocal() {
  if (!onlineRequired()) return;
  const target = validatePreview($("previewUrl").value.trim());
  const result = await api("/api/preview", {
    method: "POST",
    body: { url: target },
  });
  $("preview").src = result.url;
  $("preview").hidden = false;
  $("previewEmpty").hidden = true;
}

let drawerReturnFocus;
const desktopSidebar = matchMedia('(min-width:761px)');
let sidebarExpanded = safeRead('cmc.sidebarExpanded') === 'true';
let mobileDrawerOpen = false;
function syncSidebarLayout() {
  const desktop = desktopSidebar.matches;
  const open = desktop ? sidebarExpanded : mobileDrawerOpen;
  document.body.classList.toggle('sidebar-expanded', desktop && open);
  $("sidebar").hidden = !open;
  $("sidebar").classList.toggle('open', open);
  if (desktop) {
    $("sidebar").removeAttribute('role');
    $("sidebar").removeAttribute('aria-modal');
  } else {
    $("sidebar").setAttribute('role', 'dialog');
    $("sidebar").setAttribute('aria-modal', 'true');
  }
  $("drawerBackdrop").hidden = desktop || !open;
  $("main").inert = !desktop && open;
  for (const id of ["openDrawer", "mobileDrawer"]) $(id).setAttribute('aria-expanded', String(open));
  requestAnimationFrame(updateSidebarScrollbar);
}
function openDrawer({search = false} = {}) {
  hideMenu();
  drawerReturnFocus = document.activeElement;
  if (desktopSidebar.matches) {
    sidebarExpanded = true;
    safeWrite('cmc.sidebarExpanded', 'true');
  } else mobileDrawerOpen = true;
  syncSidebarLayout();
  requestAnimationFrame(() => {
    (search ? $("search") : $("closeDrawer")).focus();
    updateSidebarScrollbar();
  });
}
function closeDrawer({force = false} = {}) {
  if (desktopSidebar.matches && !force) return;
  const wasOpen = !$("sidebar").hidden;
  if (desktopSidebar.matches) {
    sidebarExpanded = false;
    safeWrite('cmc.sidebarExpanded', 'false');
  } else mobileDrawerOpen = false;
  syncSidebarLayout();
  if (wasOpen) {
    const target = drawerReturnFocus?.isConnected && drawerReturnFocus.getClientRects().length ? drawerReturnFocus : $(desktopSidebar.matches ? 'openDrawer' : 'mobileDrawer');
    target.focus({preventScroll:true});
  }
}
desktopSidebar.addListener(() => {
  mobileDrawerOpen = false;
  syncSidebarLayout();
  resizeComposer();
});
syncSidebarLayout();
function showPage(page) {
  state.page = page;
  for (const name of Object.keys(pageNames))
    $(`${name}Page`).hidden = name !== page;
  document.querySelectorAll("[data-page]").forEach((node) => {
    node.classList.toggle("active", node.dataset.page === page);
    if (node.dataset.page === page) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const work = ["files", "terminal", "preview"].includes(page);
  $("workTabs").hidden = !work;
  $("backToChat").hidden = page === 'chat';
  closeDrawer();
  hideMenu();
  updateContext();
  if (page === "files" && state.connected) run(() => loadFiles());
  if (page === "terminal" && state.connected) {
    run(refreshTerminals);
    if (state.activeTerminal) {
      ensureTerminal();
      requestAnimationFrame(fitTerminal);
    }
  }
  if (page === "settings" && state.connected && !state.settingsDirty)
    run(loadSettings);
  if (page === "chat") requestAnimationFrame(resizeComposer);
}
let menuAnchor;
function hideMenu() {
  $("actionMenu").hidden = true;
  menuAnchor?.setAttribute('aria-expanded', 'false');
}
function showMenu(anchor, items) {
  const menu = $("actionMenu");
  if (!menu.hidden && menuAnchor === anchor) {hideMenu();return;}
  if(menuAnchor&&menuAnchor!==anchor)menuAnchor.setAttribute('aria-expanded','false');
  menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  menu.setAttribute('role', 'menu');
  const menuIcons = {'图片或视频':'image','文件':'file','置顶':'arrow-up','取消置顶':'arrow-down','新会话':'compose','当前项目文件':'folder','重试上一条':'refresh','重命名':'compose','移除会话':'close','显示运行提示':'info','隐藏运行提示':'info','编辑消息':'compose','改为引导':'arrow-up','重试发送':'refresh','取消发送':'close','复制错误详情':'copy'};
  menu.replaceChildren(
    ...items.map(([label, action]) => {
      const item = button(
        label,
        () => {
          hideMenu();
          return action();
        },
        "",
      );
      item.setAttribute('role', 'menuitem');
      if (menuIcons[label]) item.prepend(iconNode(menuIcons[label]));
      return item;
    }),
  );
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(innerWidth - menu.offsetWidth - 12, box.right - menu.offsetWidth))}px`;
  const below = box.bottom + 6;
  menu.style.top = `${Math.max(12, below + menu.offsetHeight < innerHeight - 12 ? below : box.top - menu.offsetHeight - 6)}px`;
  menu.onkeydown = event => {
    const options = [...menu.querySelectorAll('button')], index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {event.stopPropagation();hideMenu();anchor.focus();}
  };
  menu.querySelector('button')?.focus({preventScroll:true});
}
async function askText(title, value, maxLength = 160) {
  const dialog = el("dialog", "modal");
  const form = el("form");
  const heading = el("h2", null, title);
  heading.style.marginBottom = "20px";
  const input = el(maxLength > 160 ? "textarea" : "input");
  if(maxLength > 160) input.rows=5;
  input.value = value;
  input.setAttribute("aria-label", title);
  input.style.width = "100%";
  input.required = true;
  input.maxLength = maxLength;
  const actions = el("div", "button-row align-right");
  actions.style.marginTop = "20px";
  const cancel = el("button", "button secondary", "取消");
  cancel.type = "button";
  const save = el("button", "button", "保存");
  actions.append(cancel, save);
  form.append(heading, input, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.onclick = () => finish(null);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      finish(input.value.trim());
    };
  });
}
async function renameThread() {
  return renameSelectedThread(activeThread());
}
async function renameSelectedThread(thread) {
  if (!thread) return;
  const title = await askText("重命名会话", thread.title);
  if (!title) return;
  await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
    method: "PATCH",
    body: { title },
  });
  await refreshThreads();
  renderConversation();
}
async function deleteThread() {
  return deleteSelectedThread(activeThread());
}
async function deleteSelectedThread(thread) {
  if (!thread) return;
  if (
    !(await confirmAction(
      "移除会话？",
      `将从控制台移除「${thread.title}」及其控制台消息记录。`,
    ))
  )
    return;
  await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
    method: "DELETE",
  });
  state.events.delete(thread.id);
  if(state.threadId===thread.id)state.threadId = "";
  await refreshThreads();
  restoreDraft();
  renderConversation();
}
function showThreadMenu(anchor,thread){
  showMenu(anchor,[
    ...(harnessForThread(thread.id)==='codex' ? [[thread.pinnedIndex?'取消置顶':'置顶',async()=>{
      await api(`/api/threads/${encodeURIComponent(thread.id)}/pin`,{method:'POST',body:{pinned:!thread.pinnedIndex}});
      await refreshThreads();
    }]] : []),
    ['重命名',()=>renameSelectedThread(thread)],
    ['移除会话',()=>deleteSelectedThread(thread)],
  ]);
}
function openProjectDialog() {
  if (!onlineRequired()) return;
  showInline("projectError", "");
  openDialog("projectDialog");
  $("projectPath").focus();
}
for (const id of ["openDrawer", "mobileDrawer"]) $(id).onclick = () => openDrawer();
$("railSearch").onclick = () => openDrawer({search:true});
for (const id of ["railNewThread", "mobileNewThread"]) $(id).onclick = () => run(newThread);
$("closeDrawer").onclick = () => closeDrawer({force:true});
$("drawerBackdrop").onclick = closeDrawer;
for (const node of document.querySelectorAll("[data-close]"))
  node.onclick = () => closeDialog(node.dataset.close);
for (const node of document.querySelectorAll("[data-page]"))
  node.onclick = () => showPage(node.dataset.page);
$("connectionHost").textContent = location.host;
$("token").value = state.token;
for (const id of ["connectionBtn", "statusBtn", "welcomeConnect"])
  $(id).onclick = () => openDialog("connectionDialog");
let connectionMethod = "token";
function setConnectionMethod(method) {
  connectionMethod = method;
  $("tokenMethodBtn").classList.toggle("selected", method === "token");
  $("codeMethodBtn").classList.toggle("selected", method === "code");
  $("tokenField").hidden = method !== "token";
  $("codeField").hidden = method !== "code";
  $("connectionHelp").textContent =
    method === "token"
      ? "Token 位于电脑的 ~/.codex-mobile-control/server.json。"
      : "在另一台已连接设备的控制台中点击「手机配对」，获取配对码。";
  showInline("connectionError", "");
}
$("tokenMethodBtn").onclick = () => setConnectionMethod("token");
$("codeMethodBtn").onclick = () => setConnectionMethod("code");
$("connectForm").onsubmit = async (event) => {
  event.preventDefault();
  $("connectBtn").disabled = true;
  showInline("connectionError", "");
  try {
    let token = $("token").value.trim();
    if (connectionMethod === "code") {
      const claim = await api("/api/pair/claim", {
        method: "POST",
        token: "",
        body: { code: $("pairCodeInput").value.trim(), name: "Web 控制台" },
      });
      token = claim.token;
    }
    await connect(token);
  } catch (error) {
    showInline("connectionError", errorMessage(error));
  } finally {
    $("connectBtn").disabled = false;
  }
};
$("reconnectBtn").onclick = () => run(() => connect());
$("disconnectBtn").onclick = () => {
  disconnect();
  toast("已断开连接");
};
$("newThreadBtn").onclick = () => run(newThread);
$("search").oninput = () => {
  renderProjects();
  renderThreads();
};
$("refreshThreads").onclick = () => run(refreshThreads, $("refreshThreads"));
for (const id of ["addProjectBtn", "welcomeAddProject", "settingsAddProject"])
  $(id).onclick = openProjectDialog;
$("projectForm").onsubmit = async (event) => {
  event.preventDefault();
  $("projectSubmitBtn").disabled = true;
  showInline("projectError", "");
  try {
    const { project } = await api("/api/projects", {
      method: "POST",
      body: { path: $("projectPath").value.trim() },
    });
    await refreshProjects();
    closeDialog("projectDialog");
    $("projectPath").value = "";
    await selectProject(project);
    toast("项目已添加");
  } catch (error) {
    showInline("projectError", errorMessage(error));
  } finally {
    $("projectSubmitBtn").disabled = false;
  }
};
$("prompt").oninput = () => {
  storeDraft();
  resizeComposer();
  updateControls();
};
$("prompt").onkeydown = (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    matchMedia("(pointer:fine)").matches
  ) {
    event.preventDefault();
    if (!$("sendBtn").disabled) run(sendPrompt);
  }
};
$("sendBtn").onclick = () => run(() => {
  if (isRunning()&&!$('prompt').value.trim()&&!(state.imageDrafts[draftKey()]||[]).length&&!(state.fileDrafts[draftKey()]||[]).length) return sendCommand({type:'turn.interrupt',threadId:state.threadId,requestId:requestId()});
  return sendPrompt();
});
$('stopBtn').onclick=()=>run(()=>sendCommand({type:'turn.interrupt',threadId:state.threadId,requestId:requestId()}));
$("chatProject").onchange = () => {
  const project = state.projects.find((p) => p.id === $("chatProject").value);
  if (project) run(() => selectProject(project));
  else { storeDraft(); state.chatProject = ''; restoreDraft(); updateControls(); }
};
$("conversationScroll").onscroll = () => {
  followConversation=$('conversationScroll').scrollHeight-$('conversationScroll').scrollTop-$('conversationScroll').clientHeight<8;
  if(!followConversation)rememberReadingAnchor();
  $("jumpLatest").hidden =
    $("welcome").hidden === false ||
    $("conversationScroll").scrollHeight -
      $("conversationScroll").scrollTop -
      $("conversationScroll").clientHeight <
      8;
};
$('loadOlder').onclick=()=>run(loadOlderMessages);
$('conversationScroll').addEventListener('wheel',event=>{if(event.deltaY<0){followConversation=false;rememberReadingAnchor();if($('conversationScroll').scrollTop<100)run(loadOlderMessages);}},{passive:true});
let touchY=0;
$('conversationScroll').addEventListener('touchstart',event=>{touchY=event.touches[0]?.clientY || 0;},{passive:true});
$('conversationScroll').addEventListener('touchmove',event=>{if((event.touches[0]?.clientY || 0)>touchY){followConversation=false;rememberReadingAnchor();if($('conversationScroll').scrollTop<100)run(loadOlderMessages);}},{passive:true});
$("jumpLatest").onclick = () => {
  followConversation=true;
  $("conversationScroll").scrollTo({
    top: $("conversationScroll").scrollHeight,
    behavior: "instant",
  });
};
$("threadGoal").onclick = () => {
  const open=$('goalDetails').hidden;
  $('goalDetails').hidden=!open;
  $('threadGoal').setAttribute('aria-expanded',String(open));
};
$('editGoal').onclick=()=>run(async()=>{
  const thread=activeThread();if(!thread?.goal)return;
  const objective=await askText('编辑目标',thread.goal.objective,200000);
  if(!objective||objective===thread.goal.objective)return;
  const result=await api(`/api/threads/${encodeURIComponent(thread.id)}/goal`,{method:'PATCH',body:{objective}});
  thread.goal=result.goal;renderConversation();await refreshThreads();
});
$('toggleGoal').onclick=()=>run(async()=>{
  const thread=activeThread();if(!thread?.goal)return;
  const status=thread.goal.status==='paused'?'active':'paused';
  const result=await api(`/api/threads/${encodeURIComponent(thread.id)}/goal`,{method:'PATCH',body:{status}});
  thread.goal=result.goal;renderConversation();await refreshThreads();
});
$("threadMenuBtn").onclick = () =>
  showMenu($("threadMenuBtn"), [
    ['用量与配额',showUsage],
    ["重命名", renameThread],
    ["新会话", newThread],
    [state.showWarnings ? '隐藏运行提示' : '显示运行提示', () => {
      state.showWarnings = !state.showWarnings;
      safeWrite('cmc.showWarnings', String(state.showWarnings));
      renderConversation();
    }],
    ["移除会话", deleteThread],
  ]);
$("composerTools").onclick = () =>
  showMenu($("composerTools"), [
    ['图片或视频',()=>$('imageInput').click()],
    ['文件',()=>$('fileInput').click()],
    ["新会话", newThread],
    [
      "当前项目文件",
      () => {
        state.fileProject = state.chatProject;
        $("filesProject").value = state.fileProject;
        showPage("files");
      },
    ],
    [
      "重试上一条",
      () => {
        const previous = (state.events.get(state.threadId) || [])
          .filter((e) => e.type === "user.message")
          .slice(-1)[0];
        if (previous) {
          $("prompt").value = previous.text;
          state.imageDrafts[draftKey()]=previous.images || [];saveImageDrafts();renderImageDrafts();
          state.fileDrafts[draftKey()]=previous.files || [];saveFileDrafts();renderFileDrafts();
          storeDraft();
          resizeComposer();
          updateControls();
        }
      },
    ],
  ]);
$("fileModeBtn").onclick = () => run(() => switchFileMode("files"));
$("diffModeBtn").onclick = () => run(() => switchFileMode("diff"));
$("filesProject").onchange = () =>
  run(() => changeFileProject($("filesProject").value));
$("fileSearch").oninput = renderFiles;
$("refreshFiles").onclick = () => run(() => loadFiles(), $("refreshFiles"));
$("upBtn").onclick = () => run(() => loadFiles(parentPath(state.filePath)));
$("backToFiles").onclick = async () => {
  if (await allowFileLeave()) resetFile();
};
$("editor").oninput = updateControls;
$("editor").onkeydown = (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = event.target.selectionStart;
    event.target.setRangeText("  ", start, event.target.selectionEnd, "end");
    updateControls();
  }
};
$("saveFileBtn").onclick = () => run(saveFile, $("saveFileBtn"));
$("filePreviewBtn").onclick = () => {
  if ($("editor").hidden) {
    $("editor").hidden = false;
    $("filePreview").hidden = true;
    $("filePreviewBtn").textContent = "预览";
  } else run(previewFile);
};
$("newTerminalBtn").onclick = () => run(newTerminal, $("newTerminalBtn"));
$("stopTerminalBtn").onclick = () => run(stopTerminal, $("stopTerminalBtn"));
$("commandForm").onsubmit = (event) => {
  event.preventDefault();
  run(runTerminalCommand);
};
$("terminalProject").onchange = () => {
  state.terminalProject = $("terminalProject").value;
  state.activeTerminal = "";
  state.terminalOutput = "";
  state.terminal?.reset();
  $("terminalEmpty").hidden = false;
  renderTerminalList();
  updateControls();
  updateContext();
};
const keys = {
  ctrlc: "\x03",
  tab: "\t",
  esc: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
};
$("terminalShortcuts")
  .querySelectorAll("[data-key]")
  .forEach(
    (node) =>
      (node.onclick = () =>
        run(() =>
          api(
            `/api/terminal/sessions/${encodeURIComponent(state.activeTerminal)}/input`,
            {
              method: "POST",
              body: { text: keys[node.dataset.key], appendNewline: false },
            },
          ),
        )),
  );
$("previewForm").onsubmit = (event) => {
  event.preventDefault();
  run(previewLocal);
};
for (const id of Object.values(settingsFields))
  $(id).oninput = () => (state.settingsDirty = true);
$('settingRemoteAutoApproval').onchange=()=>run(async()=>{
  const field=$('settingRemoteAutoApproval');
  field.disabled=true;
  try{await api('/api/settings/remote-approval',{method:'PUT',body:{desktopAutoApprove:field.checked}});}
  catch(error){field.checked=!field.checked;throw error;}
  finally{field.disabled=false;}
});
$("rawConfig").oninput = () => (state.rawDirty = true);
$("saveSettingsBtn").onclick = () => run(saveSettings, $("saveSettingsBtn"));
$('publicPasswordForm').onsubmit=event=>{
  event.preventDefault();
  run(async()=>{
    const password=$('publicPassword').value;
    if(password!==$('publicPasswordConfirm').value)throw Error('两次输入的密码不一致');
    if(password.length<16||password.length>128)throw Error('密码长度应为 16 至 128 个字符');
    await api('/api/settings/public-access/password',{method:'PUT',body:{password}});
    $('publicPassword').value='';$('publicPasswordConfirm').value='';
    toast('公网密码已更新，请在手机连接设置中同步修改');
  },$('savePublicPasswordBtn'));
};
$("saveRawBtn").onclick = () =>
  run(async () => {
    const content = $("rawConfig").value;
    await api("/api/settings/user/raw", { method: "PUT", body: { content } });
    state.settingsDirty = false;
    state.rawDirty = false;
    await loadSettings();
    toast("完整配置已保存");
  }, $("saveRawBtn"));
$("codexStartBtn").onclick = () =>
  run(async () => {
    await api("/api/codex/start", { method: "POST", body: {}, timeout: 65000 });
    await refreshCodex();
  }, $("codexStartBtn"));
$("codexRestartBtn").onclick = () =>
  run(async () => {
    if (!(await confirmAction("重启 Codex？", "正在执行的任务可能会中断。")))
      return;
    await api("/api/codex/restart", {
      method: "POST",
      body: {},
      timeout: 65000,
    });
    await refreshCodex();
  }, $("codexRestartBtn"));
$("checkUpgradeBtn").onclick = () =>
  run(async () => {
    const { upgrade } = await api("/api/codex/upgrade-check");
    $("upgradeStatus").textContent =
      upgrade.error ||
      (upgrade.updateAvailable
        ? `可更新到 ${upgrade.latestVersion}。${upgrade.command}`
        : `当前已是最新版本 ${upgrade.installedVersion}`);
  }, $("checkUpgradeBtn"));
$("refreshDevices").onclick = () => run(refreshDevices, $("refreshDevices"));
$("pairStartBtn").onclick = () => run(pairStart, $("pairStartBtn"));
$("settingsPairBtn").onclick = () => run(pairStart, $("settingsPairBtn"));
$('refreshPair').onclick=()=>run(pairStart,$('refreshPair'));
$('pairAddress').onchange=()=>run(pairStart);
$("rotateTokenBtn").onclick = () =>
  run(async () => {
    if (
      !(await confirmAction(
        "轮换当前 Token？",
        "使用当前 Token 的其他连接将失效，本网页会保存新 Token 并重新连接。",
      ))
    )
      return;
    const result = await api("/api/auth/token/rotate", {
      method: "POST",
      body: {},
    });
    safeWrite("cmc.token", result.token);
    await connect(result.token);
    toast("Token 已轮换");
  }, $("rotateTokenBtn"));
window.addEventListener("click", (event) => {
  if (
    !$("actionMenu").contains(event.target) &&
    !menuAnchor?.contains(event.target) &&
    !$("composerTools").contains(event.target) &&
    !$("threadMenuBtn").contains(event.target)
  )
    hideMenu();
});
window.addEventListener("keydown", (event) => {
  // A dialog owns keyboard input until it closes. Global shortcuts must not
  // switch the underlying conversation while the user is choosing an option.
  if (document.querySelector('dialog[open]') || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Tab' && !$("sidebar").hidden && !desktopSidebar.matches) {
    const focusable = [...$("sidebar").querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
  }
  if (event.key === "Escape") {
    hideMenu();
    closeDrawer({force:true});
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    run(newThread);
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s" &&
    state.page === "files"
  ) {
    event.preventDefault();
    if (fileDirty()) run(saveFile);
  }
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    event.preventDefault();
    openDrawer({search:true});
  }
});
window.addEventListener('resize', () => requestAnimationFrame(resizeComposer));
window.addEventListener("beforeunload", (event) => {
  if (fileDirty() || state.settingsDirty || state.rawDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("offline", () => {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.ws?.close();
  state.connected = false;
  state.connecting = false;
  updateConnection();
});
window.addEventListener("online", () => {
  if (!state.connected && !state.manualDisconnect) run(() => connect());
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.connected) {
    run(refreshThreads);
    if (state.threadId) run(() => loadThread(state.threadId));
  }
});
restoreDraft();
renderProjects();
renderConversation();
updateConnection();
renderImageDrafts();
let refreshingDesktop=false;
setInterval(async()=>{
  if(document.hidden||!state.connected||refreshingDesktop)return;
  refreshingDesktop=true;
  try {await Promise.allSettled([refreshThreads(),refreshProjects()]);if(state.threadId&&state.page==='chat')await loadThread(state.threadId);}
  catch { /* A background refresh can be interrupted by navigation or reconnect; keep the last snapshot and retry next tick. */ }
  finally {refreshingDesktop=false;}
},2500);
const desktopPair=new URLSearchParams(location.hash.slice(1)).get('desktopPair');
if(desktopPair) {
  history.replaceState(null,'',location.pathname+location.search);
  run(async()=>{
    const result=await api('/api/pair/claim',{method:'POST',token:'',body:{code:desktopPair,name:'电脑控制台'}});
    await connect(result.token);
    await pairStart();
  });
} else if (state.token)
  connect().catch((error) => {
    toast(errorMessage(error), true);
    if (error.status !== 401) scheduleReconnect();
  });


const questionDrafts=new Map();
function questionCard(event){
  const node=el('div','activity-block question-block');
  const approval=state.approvals.find(a=>a.id===event.approvalId);
  const resolved=approval&&approval.status!=='pending';
  node.append(el('h3',null,resolved?(approval.status==='accepted'?'已回答':'问题已失效'):'需要你的回答'));
  let questions=[];try{questions=JSON.parse(event.detail||'{}').questions||[];}catch{}
  if(resolved){questionDrafts.delete(event.approvalId);for(const q of questions)node.append(el('p',null,q.question));return node;}
  const draft=questionDrafts.get(event.approvalId)||{};questionDrafts.set(event.approvalId,draft);
  const form=el('form','question-form');const submit=el('button','button compact','提交回答');submit.type='submit';
  const update=()=>{submit.disabled=!questions.length||questions.some(q=>!draft[q.id]?.trim());};
  for(const q of questions){
    const field=el('fieldset');field.append(el('legend',null,q.question));
    const input=el('input');input.type=q.isSecret?'password':'text';input.autocomplete='off';input.placeholder='输入你的回答';input.setAttribute('aria-label',q.question);input.value=draft[q.id]||'';
    for(const option of q.options||[]){const choice=el('button','button secondary question-choice',option.label+(option.description?' — '+option.description:''));choice.type='button';choice.setAttribute('aria-pressed',String(draft[q.id]===option.label));choice.onclick=()=>{draft[q.id]=option.label;input.value=option.label;field.querySelectorAll('.question-choice').forEach(b=>b.setAttribute('aria-pressed',String(b===choice)));update();};field.append(choice);}
    input.oninput=()=>{draft[q.id]=input.value;field.querySelectorAll('.question-choice').forEach(b=>b.setAttribute('aria-pressed','false'));update();};field.append(input);form.append(field);
  }
  form.append(submit);update();form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/approvals/'+encodeURIComponent(event.approvalId)+'/answer',{method:'POST',body:{threadId:state.threadId,answers:Object.fromEntries(questions.map(q=>[q.id,{answers:[draft[q.id]]}]))}});questionDrafts.delete(event.approvalId);await refreshApprovals();}catch(error){toast(error.message);update();}};
  node.append(form);return node;
}
