import { marked } from "./marked.js";
import {createAttachmentsController} from './attachments-controller.js';
import {createSettingsController} from './settings-controller.js';
import {createManagementController} from './management-controller.js';
import {displayThreadTitle,displayPath} from './console-core.js';
import {modelHarness} from './model-identity.js';
import {renderModelChoices,renderModelEfforts} from './model-controls.js';
import {ThreadEventCache,BoundedLruMap} from './thread-cache.js';
import './compat.js';
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},true);
document.addEventListener('keydown',()=>{document.documentElement.dataset.input='keyboard';},true);
import {mathExtension,renderMath} from './math.js';
marked.use({extensions:[mathExtension]});
import DOMPurify from "./purify.js";
import {localFilePath,resolveFileLink,renderPdf} from './file-links.js';
import {highlightCodeElement} from './highlight.js';
import {sidebarThreadRoots,subagentLabel,threadFamilyRunning,subagentRunning,sidebarInactiveAgents,conversationParent,conversationLineage,conversationRunningAgents} from './thread-family.js';
import {filePatch,patchLines} from './patch-view.js';
import {
  GoalRunClock,
  requestId,
  ThreadEventFocus,
  comparablePath,
  parentPath,
  statusLabel,
  formatSize,
  previewKind,
  validatePreview,
  mergeEvents,
  retainCompaction,
  conversationBlocks,
  groupToolActivity,
  activityEntries,
  activitySummary,
  activeConversationTask,
  restoreActivityDetails,
  cleanActivityLabel,
  compactError,
  errorMessage,
  agentAvailability,
  sessionUsageValues,
} from "./console-core.js";

const $ = (id) => document.getElementById(id);

// Safari's keyboard changes the visual viewport while its layout viewport can stay full height.
const viewport=window.visualViewport;
function updateViewportHeight(){
  if(viewport&&viewport.scale===1)document.documentElement.style.setProperty('--viewport-height',viewport.height+'px');
}
viewport?.addEventListener('resize',updateViewportHeight);
window.addEventListener('resize',updateViewportHeight);
updateViewportHeight();
const changingGoals=new Set();
let openUsage=null;
const icons = {
  info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  compose: 'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1L22 8l-5-5-7 11Z',
  panel: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 3v18',
  copy:'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  chart:'M4 4v16h16M8 16v-4M12 16V8M16 16V5',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  save:'M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7',
  image:'M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M15 7h.01',
  code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8z",
  bot: "M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM2 14h2m16 0h2M9 13v2m6-2v2",
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
  target: "M22 12a10 10 0 1 0-20 0 10 10 0 1 0 20 0M18 12a6 6 0 1 0-12 0 6 6 0 1 0 12 0M14 12a2 2 0 1 0-4 0 2 2 0 1 0 4 0",
  check: "m20 6-11 11-5-5",
  pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
  'pin-off': "M12 17v5M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89M2 2l20 20M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
  pencil: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4",
  steer: "m15 10 5 5-5 5M4 4v7a4 4 0 0 0 4 4h12",
  trash: "M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  eye: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0",
  'eye-off': "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20",
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
for(const [id,name] of Object.entries({saveFileBtn:'save',saveSettingsBtn:'save',newTerminalBtn:'plus',stopTerminalBtn:'stop',reconnectBtn:'refresh'})) {
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
    const target=$(button.dataset.collapse),open=searching||!(collapsedSections[target.id]??(target.id==='inactiveAgents'));
    target.hidden=!open;button.setAttribute('aria-expanded',String(open));
    button.querySelector('.section-count').textContent=target.dataset.totalCount??(target.querySelectorAll('.thread-row,.project-row').length||'');
  });
  requestAnimationFrame(updateSidebarScrollbar);
}
document.querySelectorAll('[data-collapse]').forEach(button=>{button.onclick=()=>{
  const id=button.dataset.collapse;collapsedSections[id]=!(collapsedSections[id]??(id==='inactiveAgents'));safeWrite('cmc.sidebarCollapsed',JSON.stringify(collapsedSections));
  if(id==='inactiveAgents')renderThreads();else applySidebarSections();
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
  harness:['codex','claude','antigravity','grok','deepseek','hermes','opencode'].includes(safeRead('cmc.harness'))?safeRead('cmc.harness'):'codex',
  imageDrafts: (()=>{try{return JSON.parse(safeRead('cmc.imageDrafts')||'{}')}catch{return {}}})(),
  fileDrafts: (()=>{try{return JSON.parse(safeRead('cmc.fileDrafts')||'{}')}catch{return {}}})(),
  uploading:0,
  uploadOwners:new Set(),
  uploadError:'',
  models: [],
  backends: [],
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
  events: new ThreadEventCache(()=>state.threadId),
  hydrating: new Map(),
  historyCount: new Map(),
  historyMore: new Map(),
  historyLoading: new Set(),
  historyPageOwners: new Map(),
  historyErrors: new Map(),
  threadListRequest: 0,
  queueRequests: new Map(),
  selection: 0,
  pending: null,
  capabilities: [],
  drafts: readDrafts(),
  draftRevisions: new Map(),
  draftEpoch: String(performance.timeOrigin),
  composerRevision: 0,
  chatModelRevision: 0,
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
  terminalBuffer: null,
  terminalOutputRead: null,
  terminalOutputLoading: false,
  terminalOutputError: "",
};
const pageNames = {
  chat: "工作区",
  files: "文件与改动",
  terminal: "终端",
  preview: "浏览器预览",
  settings: "设置",
};
let toastExitTimer, toastTimer,
  renderQueued = false,
  controlsQueued = false,
  refreshTimer,
  terminalTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  clearTimeout(toastExitTimer);
  const node = $("toast");
  node.classList.remove("leaving");
  node.textContent = message;
  node.className = `toast${error ? " error" : ""}`;
  node.hidden = false;
  void node.offsetWidth;
  toastTimer = setTimeout(() => {
    node.classList.add("leaving");
    toastExitTimer = setTimeout(() => {
      node.hidden = true;
      node.classList.remove("leaving");
    }, 170);
  }, error ? 6500 : 3500);
}
const desktopNotifications=new Map(),completionNoticeSeen=new BoundedLruMap(256),completionNoticeQueue=new Map(),approvalNoticeQueue=new Map(),approvalNoticeSeen=new BoundedLruMap(256);
let taskNoticeTimer=null,approvalNoticePolicy=null;
function canDesktopNotify(){return document.hidden&&'Notification' in window&&Notification.permission==='granted'&&safeRead('cmc.desktopNotify')==='on';}
function closeDesktopNotifications(){
  for(const owner of approvalNoticeQueue.values()){clearTimeout(owner.timer);owner.controller.abort();}
  approvalNoticeQueue.clear();
  approvalNoticePolicy?.controller.abort();approvalNoticePolicy=null;
  for(const notification of desktopNotifications.values())notification.close();desktopNotifications.clear();
}
function desktopNotify(title, body, threadId,tag=`cmc-${threadId || 'general'}-${title}`) {
  if(!canDesktopNotify())return;
  try {
    desktopNotifications.get(tag)?.close();
    const notification = new Notification(title, {
      body: String(body || "").slice(0, 200),
      tag,
    });
    desktopNotifications.set(tag,notification);
    notification.onclose=()=>{if(desktopNotifications.get(tag)===notification)desktopNotifications.delete(tag);};
    notification.onclick = () => {
      window.focus();
      const thread = state.threads.find((item) => item.id === threadId);
      if (thread) run(() => openThread(thread));
      notification.close();
    };
    return notification;
  } catch {}
}
function showTaskNotice(title,text,threadId){
  if(document.hidden||state.page==='chat'&&state.threadId===threadId)return;
  let notice=$('taskNotice');
  if(!notice){notice=el('div','task-notice');notice.id='taskNotice';notice.setAttribute('role','status');document.body.append(notice);}
  clearTimeout(taskNoticeTimer);notice.dataset.threadId=threadId;notice.hidden=false;
  const previousFocus=document.activeElement;
  const content=el('div','task-notice-content');content.append(el('strong',null,title),el('p',null,text));
  const close=()=>{const restore=notice.contains(document.activeElement);notice.hidden=true;clearTimeout(taskNoticeTimer);if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});};
  notice.replaceChildren(content,button('查看',()=>{const thread=state.threads.find(row=>row.id===threadId);close();if(thread)return openThread(thread);},'button secondary compact'),button('关闭',close,'icon-button'));
  const dismiss=()=>{clearTimeout(taskNoticeTimer);taskNoticeTimer=setTimeout(close,5000);};
  notice.onpointerenter=()=>clearTimeout(taskNoticeTimer);notice.onpointerleave=dismiss;
  notice.onfocusin=()=>clearTimeout(taskNoticeTimer);notice.onfocusout=event=>{if(!notice.contains(event.relatedTarget))dismiss();};dismiss();
}
function queueCompletionNotice(event){
  const id=event.threadId,thread=state.threads.find(row=>row.id===id);
  if(!id||event.replayed||event.subagent||thread?.subagent)return;
  const turn=event.turnId||state.events.get(id)?.findLast(row=>row.type==='turn.started')?.turnId;
  const key=JSON.stringify([state.generation,id,event.type,turn||event.eventId||event.createdAt||event.text||event.status]);
  if(completionNoticeSeen.has(key))return;completionNoticeSeen.set(key,true);
  if(!document.hidden&&state.page==='chat'&&state.threadId===id)return;
  const previous=completionNoticeQueue.get(id);
  if(previous?.event.type==='goal.completed'&&event.type==='turn.completed')return;
  if(previous)clearTimeout(previous.timer);
  const owner={event,generation:state.generation,timer:null};completionNoticeQueue.set(id,owner);
  owner.timer=setTimeout(()=>{
    if(completionNoticeQueue.get(id)!==owner)return;completionNoticeQueue.delete(id);
    if(owner.generation!==state.generation)return;
    const title=event.type==='goal.completed'?'目标已结束':['ok','completed','complete','success','idle'].includes(event.status)?'任务已完成':['interrupted','cancelled','canceled','aborted'].includes(event.status)?'任务已中断':['error','failed'].includes(event.status)?'任务失败':'任务已结束';
    const text=[state.threads.find(row=>row.id===id)?.title,event.text,event.type==='goal.completed'&&Number.isFinite(event.timeUsedSeconds)?`运行时间 ${Math.floor(event.timeUsedSeconds/60)}分${event.timeUsedSeconds%60}秒`:''].filter(Boolean).join('\n');
    if(document.hidden)desktopNotify(title,text,id,`cmc-task-${id}`);else showTaskNotice(title,text,id);
  },250);
}
async function readApprovalNoticePolicy(){
  const generation=state.generation;
  if(approvalNoticePolicy?.generation===generation)return approvalNoticePolicy.promise;
  const controller=new AbortController();
  const owner={generation,controller,promise:api('/api/settings/remote-approval',{signal:controller.signal})};approvalNoticePolicy=owner;
  try{return await owner.promise;}finally{if(approvalNoticePolicy===owner)approvalNoticePolicy=null;}
}
function cancelApprovalNotice(threadId,approvalId){
  const key=threadId+':'+approvalId,owner=approvalNoticeQueue.get(key);
  if(owner){clearTimeout(owner.timer);owner.controller.abort();approvalNoticeQueue.delete(key);}
  // Other approvals may still be waiting on this shared policy read.
  if(!approvalNoticeQueue.size){approvalNoticePolicy?.controller.abort();approvalNoticePolicy=null;}
  const tag=`cmc-approval-${threadId}-${approvalId}`;desktopNotifications.get(tag)?.close();desktopNotifications.delete(tag);
}
function queueApprovalNotice(event){
  if(!event.threadId||!event.approvalId||event.replayed||!canDesktopNotify())return;
  const key=event.threadId+':'+event.approvalId;
  const seenKey=state.generation+':'+key,previous=approvalNoticeQueue.get(key);
  if(approvalNoticeSeen.has(seenKey)||previous?.generation===state.generation)return;
  if(previous)clearTimeout(previous.timer);
  const owner={generation:state.generation,timer:null,controller:new AbortController()};approvalNoticeQueue.set(key,owner);
  owner.timer=setTimeout(async()=>{
    try{
      if(approvalNoticeQueue.get(key)!==owner||owner.generation!==state.generation||!canDesktopNotify())return;
      const question=event.approvalType==='question';
      const [approvals,policy]=await Promise.allSettled([api('/api/approvals?'+new URLSearchParams({threadId:event.threadId}),{signal:owner.controller.signal}),question?Promise.resolve({desktopAutoApprove:false}):readApprovalNoticePolicy()]);
      if(approvalNoticeQueue.get(key)!==owner||owner.generation!==state.generation||!canDesktopNotify()||approvals.status!=='fulfilled')return;
      const approval=approvals.value.approvals?.find(row=>row.id===event.approvalId&&row.threadId===event.threadId);
      if(approval?.status!=='pending'||!question&&(policy.status!=='fulfilled'||policy.value.desktopAutoApprove!==false))return;
      if(desktopNotify(question?'有问题待回答':'需要你的确认',[state.threads.find(row=>row.id===event.threadId)?.title,approval.title||event.title].filter(Boolean).join('\n'),event.threadId,`cmc-approval-${event.threadId}-${event.approvalId}`))approvalNoticeSeen.set(seenKey,true);
    }catch{}finally{if(approvalNoticeQueue.get(key)===owner)approvalNoticeQueue.delete(key);}
  },250);
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
  { method = "GET", body, token = state.token, timeout = 20000, headers = {}, signal, ...rest } = {},
) {
  const controller = new AbortController();
  const cancel=()=>controller.abort();
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      ...rest,
    });
    let data;
    try{data=await response.json();}
    catch(error){
      if(!response.ok||response.status===204||response.status===205)data={};
      else if(error.name==='AbortError'||error.name==='TimeoutError')throw error;
      else throw new Error('电脑返回的响应格式异常，请刷新确认操作结果。');
    }
    if (!response.ok) {
      const error = new Error(
        response.status === 401
          ? "访问凭据无效或已撤销，请重新连接。"
          : data?.error || `请求失败（HTTP ${response.status}）`,
      );
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',cancel);
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
let confirmationQueue=Promise.resolve();
function confirmAction(title, detail) {
  const generation=state.generation;
  const pending=confirmationQueue.then(()=>{
    if(generation!==state.generation)return false;
    $('confirmTitle').textContent=title;
    $('confirmText').textContent=detail;
    openDialog('confirmDialog');
    return new Promise(resolve=>{
      let settled=false,closing=false,accepted=false;
      const closed=()=>{
        if(settled)return;
        settled=true;
        $('confirmDialog').removeEventListener('cancel',cancel);
        $('confirmDialog').removeEventListener('close',closed);
        $('confirmAccept').onclick=null;$('confirmCancel').onclick=null;
        resolve(accepted&&generation===state.generation);
      };
      const finish=value=>{
        if(closing||settled)return;
        closing=true;accepted=value;
        if($('confirmDialog').open)closeDialog('confirmDialog');else closed();
      };
      const cancel=event=>{event.preventDefault();finish(false);};
      $('confirmAccept').onclick=()=>finish(true);
      $('confirmCancel').onclick=()=>finish(false);
      $('confirmDialog').addEventListener('cancel',cancel);
      $('confirmDialog').addEventListener('close',closed);
    });
  });
  confirmationQueue=pending.catch(()=>false);
  return pending;
}
function updateConnection() {
  if(!state.connected)closeDesktopNotifications();
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
  $("connectionBanner").classList.toggle("connecting", state.connecting);
  $("connectionSpinner").hidden = !state.connecting;
  $("reconnectBtn").disabled = Boolean(state.connecting);
  $("connectionBannerText").textContent = state.connecting
    ? "正在连接电脑…"
    : "连接已断开，草稿已保留。";
  $("welcomeConnect").hidden = state.connected;
  updateSessionStatus();
  updateControls();
}
function activeThread() {
  return state.threads.find((thread) => thread.id === state.threadId);
}
function isRunning() {
  return activeThread()?.status === "running";
}
const pendingStops = new Map();
function clearPendingStop(id) {
  clearTimeout(pendingStops.get(id)?.timer);
  pendingStops.delete(id);
}
function stopCurrentTurn() {
  const id = state.threadId;
  if (!id || !isRunning() || pendingStops.has(id)) return;
  const request = requestId();
  const timer = setTimeout(() => {
    if (pendingStops.get(id)?.requestId !== request) return;
    clearPendingStop(id);
    updateControls();
    if (state.threadId === id) toast('尚未收到停止确认，任务可能仍在运行，可重试停止。', true);
  }, 12000);
  pendingStops.set(id, {requestId: request, timer});
  updateControls();
  try { sendCommand({type:'turn.interrupt', threadId:id, requestId:request}); }
  catch (error) { clearPendingStop(id); updateControls(); throw error; }
}
function draftKey(threadId = state.threadId, project = state.chatProject) {
  return threadId ? `thread:${threadId}` : `${state.harness==='codex'?'':state.harness+':'}project:${project || "none"}`;
}
function markDraftEdited(key){
  if(state.pending?.key===key)state.pending.draftEdited=true;
  const submitted=readPendingSubmission();
  if(submitted?.key===key){submitted.draftEdited=true;safeWrite('cmc.pendingSubmit',JSON.stringify(submitted));}
}
function storeDraft({edited=false}={}) {
  const key=draftKey();
  if(!edited&&state.pending?.key===key&&!$("prompt").value)return;
  if(edited||state.drafts[key]!==$("prompt").value){
    const revisions=state.draftRevisions||=new Map();revisions.set(key,(revisions.get(key)||0)+1);
    state.composerRevision=(state.composerRevision||0)+1;
  }
  state.drafts[key]=$("prompt").value;
  if(edited)markDraftEdited(key);
  safeWrite("cmc.drafts",JSON.stringify(state.drafts));
  syncQueueRestoreCopies(key);
}
function restoreDraft() {
  $("prompt").value = state.drafts[draftKey()] || "";
  resizeComposer();
  updateControls();
  renderImageDrafts();
  renderFileDrafts();
}
const {trackFilePreview, closeFilePreviews, readPreviewText, fileCards, scheduleUploadDraftSync, saveFileDrafts, renderFileDrafts, openImageViewer, imageGallery, saveImageDrafts, renderImageDrafts, enableImageZoom, cancelUpload} = createAttachmentsController({
  state,$,el,button,icon,iconNode,api,safeRead,safeWrite,requestId,draftKey,readPendingSubmission,
  syncQueueRestoreCopies,resizeComposer,updateControls,onlineRequired,toast,run,confirmAction,errorMessage,markdownNode,renderPdf,
});
function resizeComposer() {
  const text = $("prompt").value;
  // Expand long drafts into two rows without moving the model controls apart.
  $("composer").classList.toggle("expanded", text.includes('\n') || text.length > 80 || !$('imageDrafts').hidden || !$('fileDrafts').hidden);
  $("prompt").style.height = "auto";
  $("prompt").style.height = `${Math.max(26, Math.min(160, $("prompt").scrollHeight))}px`;
}
function updateGoalControls(){
  const goal=activeThread()?.goal,busy=changingGoals.has(state.threadId);
  const disabled=!state.connected||!goal||busy;
  $('toggleGoal').disabled=disabled||goal.status==='paused'&&isRunning();
  $('editGoal').disabled=disabled;
  $('closeGoal').disabled=disabled;
  for(const id of ['toggleGoal','editGoal','closeGoal'])$(id).setAttribute('aria-busy',String(busy));
}
function updateControls() {
  scheduleUploadDraftSync();
  updateGoalControls();
  updateUpgradeControl();
  renderSlashCommands();
  const readOnly=activeThread()?.readOnly===true;
  $("composer").hidden=readOnly;
  document.querySelector(".composer-footer").hidden=readOnly;
  const running = isRunning();
  const hasDraft=Boolean($('prompt').value.trim() || (state.imageDrafts[draftKey()]||[]).length || (state.fileDrafts[draftKey()]||[]).length);
  const stop=running&&!hasDraft;
  const stopping=pendingStops.has(state.threadId);
  const pending =
    state.pending &&
    (state.pending.threadId === state.threadId || !state.threadId);
  const action=pending?'sending':queueSubmitting?'queuing':stopping?'stopping':stop?'stop':running?'queue':'send';
  if($('sendBtn').dataset.action!==action){
    $('sendBtn').dataset.action=action;
    $("sendBtn").innerHTML = pending || queueSubmitting || stopping ? '<span class="submit-spinner" aria-hidden="true"></span>' : icon(stop ? "stop" : running ? "list" : "arrow-up");
  }
  $('stopBtn').hidden=!running || !hasDraft;
  $('stopBtn').disabled=!state.connected || stopping;
  $('stopBtn').setAttribute('aria-busy',String(stopping));
  $('stopBtn').title=stopping?'正在停止任务':'停止任务';
  $('composer').classList.toggle('has-stop',running&&hasDraft);
  $("sendBtn").classList.toggle("running", running);
  $("sendBtn").setAttribute("aria-label", stopping ? "正在停止任务" : stop ? "停止任务" : running ? "加入队列" : "发送消息");
  $("sendBtn").setAttribute('aria-busy',String(Boolean(pending || queueSubmitting || stopping)));
  $("sendBtn").title = $("sendBtn").getAttribute('aria-label');
  $("sendBtn").disabled =
    !state.connected || stopping || Boolean(pending) || queueSubmitting || (hasDraft && Boolean(state.uploading)) ||
    (!running && !$('chatModel').value) ||
    (hasDraft && state.harness==='opencode' && Boolean($('chatModel').selectedOptions[0]?.disabled)) ||
    (!running &&
      (Boolean(pending) ||
        state.uploading || (!$("prompt").value.trim() && !(state.imageDrafts[draftKey()]||[]).length && !(state.fileDrafts[draftKey()]||[]).length)));
  $("chatState").textContent = "";
  $("chatState").hidden = !$("chatState").textContent;
  $("welcomeProjectArea").hidden = !state.connected || Boolean(state.threadId);
  $("saveFileBtn").disabled =
    !state.connected || !state.opened || !state.opened.editable || !fileDirty();
  $("dirtyIndicator").hidden = !fileDirty();
  $("saveSettingsBtn").disabled = !state.connected || !state.settingsLoaded || Boolean(state.settingsSaving);
  $("saveRawBtn").disabled = !state.connected || !state.rawSettingsLoaded || Boolean(state.settingsSaving);
  $("newTerminalBtn").disabled = !state.connected || !state.terminalProject || Boolean(state.terminalSubmitting);
  updateTerminalStopControl();
  $("commandInput").disabled = !state.connected || !state.terminalProject;
  $("commandForm").querySelector("button").disabled =
    !state.connected || !state.terminalProject || Boolean(state.terminalSubmitting);
  const record=state.terminalCommands.find(row=>row.commandId===state.activeTerminal);
  $("terminalShortcuts")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.disabled =
          !state.connected ||
          !isInteractive(record) ||
          record.status !== "running"),
    );
  renderCodexStatus();
}
const eventFocus=new ThreadEventFocus();
async function connect(token = state.token) {
  eventFocus.reset();
  cancelActivityReads();
  cancelHistoryReads();
  cancelUpload();
  closeFilePreviews();
  const generation = ++state.generation;
  state.settingsLoaded=false;state.rawSettingsLoaded=false;
  outputImageGrants.clear();outputImageDimensions.clear();
  clearTimeout(desktopRefreshTimer);
  state.historyErrors.clear();
  updateConversationHistoryState();
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
    if(generation!==state.generation)return;
    if (
      !health.ok ||
      health.protocolVersion < 1 ||
      health.minAndroidProtocolVersion > 1
    )
      throw new Error("当前 Gateway 协议不兼容，请更新 Gateway。");
    state.capabilities=health.capabilities||[];
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
    const restoreConversation=(async()=>{
      // History errors belong to the conversation's inline retry, not the live connection.
      if(state.threadId)await loadThread(state.threadId).catch(()=>{});
      if(generation!==state.generation)return;
      await recoverLocalSubmission();
    })();
    await Promise.allSettled([
      restoreConversation,
      refreshProjects({changed:false}),
      refreshThreads(),
      loadSettings(),
      refreshTerminals(),
      refreshApprovals(),
    ]);
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
    if(state.capabilities.includes('mobile-live-activity-details'))wsUrl.searchParams.set('activityDetails','deferred');
    if(state.capabilities.includes('focused-thread-stream'))wsUrl.searchParams.set('streamThread',state.threadId||'');
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
      if(event.type==='thread.focused'){eventFocus.acknowledge(ws,event.requestId,event.threadId);return;}
      if (event.type === "connected") {
        ready = true;
        clearTimeout(deadline);
        state.connected = true;
        focusEventStream();
        queueThreadMatches();
        scheduleDesktopRefresh();
        updateConnection();
        resolve();
        return;
      }
      receiveEvent(event);
    };
    ws.onclose = (event) => {
      clearTimeout(deadline);
      eventFocus.reset(ws);
      if (generation !== state.generation) return;
      state.connected = false;
      queueThreadMatches();
      scheduleDesktopRefresh();
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
  eventFocus.reset();
  cancelActivityReads();
  cancelHistoryReads();
  cancelUpload();
  closeFilePreviews();
  state.manualDisconnect = true;
  state.generation++;
  outputImageGrants.clear();outputImageDimensions.clear();
  clearTimeout(desktopRefreshTimer);
  state.historyErrors.clear();
  updateConversationHistoryState();
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.ws?.close();
  state.connected = false;
  state.connecting = false;
  queueThreadMatches();
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
  if(event.type==='usage.updated'){
    const id=event.threadId;
    if(id===state.threadId||sessionUsageCache.has(id)){
      sessionUsageVersions.set(id,(sessionUsageVersions.get(id)||0)+1);
      const cached=sessionUsageCache.get(id);if(cached)cached.captured=0;
    }
    if(openUsage?.id===id)openUsage.schedule();else if(id===state.threadId)scheduleSessionUsage(1000);
    return;
  }
  if (event.replayed) return;
  const id = event.threadId;
  if(event.type==='thread.history.changed'){
    queueThreadRefresh();if(id===state.threadId)run(()=>loadThread(id,{refresh:true}));return;
  }
  if(event.type==='goal.completed'){
    queueCompletionNotice(event);
    queueThreadRefresh();return;
  }
  if (event.type === 'turn.completed' || event.type === 'turn.started') clearPendingStop(id);
  if(event.type==='command.accepted'){
    const saved=readPendingSubmission();
    if(saved?.requestId===event.requestId){if(state.pending?.requestId===event.requestId){
      bindSubmissionThread(state.pending,event.threadId);
      if(saved.goal){
        if(!saved.draftEdited&&state.drafts[saved.key]===saved.text){delete state.drafts[saved.key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));}
        commitComposerModes(saved.key,saved.modeOptions);run(refreshThreads);
      }
      consumeSubmissionAttachments(saved,event.threadId);
      if(!saved.draftEdited&&state.drafts[saved.key]===saved.text&&(state.draftRevisions.get(saved.key)||0)===saved.draftRevision){delete state.drafts[saved.key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));}
      safeWrite('cmc.pendingSubmit','');state.pending=null;updateControls();run(()=>loadThread(event.threadId,{refresh:true}));
    }else run(()=>recoverLocalSubmission());}
    return;
  }
  if((event.type==='user.message'||event.type==='message.queued')&&readPendingSubmission()?.requestId===event.requestId){if(state.pending?.requestId===event.requestId)safeWrite('cmc.pendingSubmit','');else run(()=>recoverLocalSubmission());}
  if (event.type === 'error' && event.requestId) {
    const stopped = [...pendingStops].find(([,pending]) => pending.requestId === event.requestId);
    if (stopped) {
      clearPendingStop(stopped[0]);
      updateControls();
      if (state.threadId === stopped[0]) toast(event.message || '停止失败，可重试。', true);
      return;
    }
  }
  if(event.type==='message.queued'){
    const pending=state.pending;
    if(pending?.requestId===event.requestId){
      delete state.drafts[pending.key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));
      state.imageDrafts[pending.key]=(state.imageDrafts[pending.key]||[]).filter(i=>!(pending.images||[]).some(p=>p.id===i.id));saveImageDrafts();renderImageDrafts();
      state.fileDrafts[pending.key]=(state.fileDrafts[pending.key]||[]).filter(i=>!(pending.files||[]).some(p=>p.id===i.id));saveFileDrafts();renderFileDrafts();
      commitComposerModes(pending.key,pending.modeOptions);state.pending=null;updateControls();
    }
    if(id)run(()=>refreshQueue(id));
    toast(event.message||'消息已加入待发队列');
    return;
  }
  if (event.type === "error") {
    if (id) {
      state.events.append(id,event);
      state.hydrating.get(id)?.push(event);
    }
    const matches =
      !event.requestId || event.requestId === state.pending?.requestId;
    if (matches && !event.willRetry && (!id || id === state.threadId)) {
      if (state.pending) restorePendingDraft();
      const thread = activeThread();
      if (thread) thread.status = "error";
      toast(event.message || "任务执行失败", true);
      renderConversation();
      updateControls();
    }
    if(event.willRetry&&id===state.threadId){renderConversation();updateControls();}
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
      bindSubmissionThread(state.pending,id);
    }
    renderThreads();
    queueRender();
  }
  if (event.type === "projects.changed" || event.type === "project.changed")
    run(refreshProjects);
  if (event.type === "codex.status") run(refreshCodex);
  if (id) {
    state.events.append(id,event);
    state.hydrating.get(id)?.push(event);
  }
  if (event.type === "user.message") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = event.status || "running";
    const pending = state.pending;
    if (
      pending &&
      (event.requestId===pending.requestId||(!event.requestId&&event.text===pending.text&&JSON.stringify(event.images||[])===JSON.stringify(pending.images||[])&&JSON.stringify(event.files||[])===JSON.stringify(pending.files||[]))) &&
      (pending.threadId === id || !pending.threadId)
    ) {
      bindSubmissionThread(pending,id);
      if (!pending.draftEdited && state.drafts[pending.key] === pending.text) {
        delete state.drafts[pending.key];
        safeWrite("cmc.drafts", JSON.stringify(state.drafts));
      }
      if (state.threadId === id && draftKey()===pending.key && (state.draftRevisions.get(pending.key)||0)===pending.draftRevision && $("prompt").value.trim() === pending.text) {
        $("prompt").value = "";
        resizeComposer();
      }
      outgoingMessageKeys.set(`${id}:${event.eventId}`,`outgoing:${pending.requestId}`);
      if(outgoingMessageKeys.size>500)outgoingMessageKeys.delete(outgoingMessageKeys.keys().next().value);
      commitComposerModes(pending.key,pending.modeOptions);
      state.pending = null;
      state.imageDrafts[pending.key]=(state.imageDrafts[pending.key]||[]).filter(i=>!(pending.images||[]).some(p=>p.id===i.id));saveImageDrafts();renderImageDrafts();
      state.fileDrafts[pending.key]=(state.fileDrafts[pending.key]||[]).filter(i=>!(pending.files||[]).some(p=>p.id===i.id));saveFileDrafts();renderFileDrafts();
    }
  }
  if (event.type === "message.delta" || event.type === "turn.started") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = "running";
  }
  if (event.type === "turn.completed") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = event.status;
    queueThreadRefresh();
    queueCompletionNotice(event);
  }
  if(event.type==='approval.requested')queueApprovalNotice(event);
  if(event.type==='approval.resolved')cancelApprovalNotice(id,event.approvalId);
  if (event.type.startsWith("approval.")) run(refreshApprovals);
  if (event.type === "terminal.output" && id?.startsWith("terminal:")) {
    if (!terminalTimer)
      terminalTimer = setTimeout(() => {
        terminalTimer = null;
        void refreshTerminals({quiet:true});
      }, state.page==='terminal'&&!document.hidden?160:1500);
    if (state.page !== "terminal" || document.hidden) setTerminalUnread(terminalUnread + 1);
  }
  if (event.type === "thread.started" || event.type === "user.message" || event.type === "turn.started")
    queueThreadRefresh();
  if (id === state.threadId) queueRender();
  queueControlsUpdate();
}
function queueControlsUpdate(){
  if(renderQueued||controlsQueued)return;
  controlsQueued=true;
  requestAnimationFrame(()=>{controlsQueued=false;if(!renderQueued)updateControls();});
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
  refreshTimer = setTimeout(() => run(()=>refreshThreads({changed:true})), 350);
}
let projectListRead=null;
function refreshProjects({changed=true}={}) {
  const generation=state.generation;
  if(projectListRead?.generation===generation){
    if(changed)projectListRead.pending=true;
    return projectListRead.promise;
  }
  const owner={generation,pending:false,promise:null};projectListRead=owner;
  owner.promise=(async()=>{
    try{
      do{owner.pending=false;await readProjects();}
      while(owner.pending&&generation===state.generation&&projectListRead===owner);
    }finally{if(projectListRead===owner)projectListRead=null;}
  })();
  return owner.promise;
}
async function readProjects() {
  const generation=state.generation,request=state.projectsRequest=(state.projectsRequest||0)+1;
  const [projectsResult,sidebarResult]=await Promise.allSettled([api('/api/projects'),api('/api/sidebar')]);
  if(generation!==state.generation||request!==state.projectsRequest)return;
  if(projectsResult.status==='rejected')throw projectsResult.reason;
  const projects=projectsResult.value.projects||[],chatProject=state.chatProject;
  const projectsChanged=!sameConversationData(state.projects,projects);
  if(projectsChanged)state.projects=projects;
  if (state.threadId && !state.chatProject) state.chatProject = state.projects.find(p=>comparablePath(p.path)===comparablePath(activeThread()?.projectPath))?.id || '';
  const sidebarProjects=sidebarResult.status==='fulfilled'?sidebarResult.value.projects||state.projects:state.projects;
  const sidebarChanged=!sameConversationData(state.sidebarProjects,sidebarProjects);
  if(sidebarChanged)state.sidebarProjects=sidebarProjects;
  // Rebuilding unchanged options interrupts an open project picker and sidebar interaction.
  if(projectsChanged||sidebarChanged||chatProject!==state.chatProject)renderProjects();
  const error=sidebarResult.status==='rejected'?errorMessage(sidebarResult.reason):'';
  if(error&&error!==state.sidebarProjectsError)toast('已加载授权项目，侧边栏读取失败：'+error,true);
  state.sidebarProjectsError=error;
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
function conversationThreadKey(thread) {
  return JSON.stringify([thread?.status,thread?.title,thread?.goal,thread?.readOnly,
    thread?.snapshotUpdatedAt,thread?.snapshotStatus,thread?.snapshotContentKind,thread?.snapshotStale]);
}
let threadListRead=null;
function refreshThreads({changed=true}={}) {
  const generation=state.generation;
  if(threadListRead?.generation===generation){
    if(changed)threadListRead.pending=true;
    return threadListRead.promise;
  }
  const owner={generation,pending:false,promise:null};threadListRead=owner;
  owner.promise=(async()=>{
    try{
      do{owner.pending=false;await readThreads();}
      while(owner.pending&&generation===state.generation&&threadListRead===owner);
    }finally{if(threadListRead===owner)threadListRead=null;}
  })();
  return owner.promise;
}
async function readThreads() {
  const request=state.threadListRequest=(state.threadListRequest||0)+1;
  const generation=state.generation,selection=state.selection;
  const prior=new Map(state.threads.map(thread=>[thread.id,JSON.stringify(thread)]));
  let threads;
  try {({threads}=await api("/api/threads"));}
  catch(error){if(request!==state.threadListRequest||generation!==state.generation)return;throw error;}
  if(request!==state.threadListRequest||generation!==state.generation)return;
  const before=state.threads.find(t=>t.id===state.threadId),beforeKey=conversationThreadKey(before);
  // Keep records changed by live events or authoritative history while this list
  // request was in flight. A response must not evict a newly selected thread.
  const changed=new Map(state.threads.filter(thread=>prior.get(thread.id)!==JSON.stringify(thread)||
    (selection!==state.selection&&thread.id===state.threadId)).map(thread=>[thread.id,thread]));
  const incoming=(threads||[]).map(thread=>changed.has(thread.id)?{...changed.get(thread.id),subagent:thread.subagent}:thread);
  const ids=new Set(incoming.map(thread=>thread.id));
  const lineage=before?.subagent?conversationLineage(state.threads,state.threadId):[];
  const retained=new Map([...lineage,...changed.values()].map(thread=>[thread.id,thread]));
  state.threads=[...incoming,...[...retained.values()].filter(thread=>!ids.has(thread.id))];
  if(state.threadId&&!state.threads.some(t=>t.id===state.threadId)&&!state.pending&&selection===state.selection){
    storeDraft();setConversationSelection();restoreDraft();renderConversation({followLatest:true});
  }
  renderThreads();updateControls();
  if(state.threadId){updateContext();if(beforeKey!==conversationThreadKey(state.threads.find(t=>t.id===state.threadId)))queueRender();}
}
const sidebarThreadRowState=new WeakMap();
function sidebarThreadRow(thread,goalRow=false,existing){
  let row=existing,data=existing&&sidebarThreadRowState.get(existing);
  if(!data){
    row=button('',()=>{const current=resolve();if(current)return openThread(current);},'thread-row');
    row.dataset.threadId=thread.id;
    data={id:thread.id,indicator:el('span','thread-indicator'),label:el('span','thread-title'),labels:el('span','running-labels'),project:el('small','running-project'),pressed:false,moved:false,timer:null};
    const resolve=()=>row.isConnected?state.threads.find(item=>item.id===data.id&&harnessForThread(item.id)===state.harness):null;
    data.cancelPress=()=>{clearTimeout(data.timer);data.timer=null;data.pointerActive=false;};
    row.oncontextmenu=event=>{event.preventDefault();const current=resolve();if(current&&!data.pressed)showThreadMenu(row,current);};
    row.addEventListener('pointerdown',event=>{
      data.cancelPress();data.pressed=false;data.moved=false;data.x=event.clientX;data.y=event.clientY;
      if(event.pointerType==='mouse'||event.isPrimary===false)return;
      data.pointerActive=true;
      data.timer=setTimeout(()=>{data.timer=null;const current=resolve();if(!current||data.moved)return;data.pressed=true;showThreadMenu(row,current);},500);
    });
    row.addEventListener('pointermove',event=>{if(data.pointerActive&&Math.hypot(event.clientX-data.x,event.clientY-data.y)>8){data.moved=true;data.cancelPress();}});
    for(const name of ['pointerup','pointercancel','pointerleave'])row.addEventListener(name,data.cancelPress);
    row.addEventListener('click',event=>{if(data.pressed||data.moved){event.stopImmediatePropagation();event.preventDefault();data.pressed=false;data.moved=false;}},true);
    sidebarThreadRowState.set(row,data);
  }
  const classes=`thread-row ${thread.status||''}${state.threadId===thread.id?' active':''}${thread.unread?' unread':''}${thread.readOnly?' snapshot-row':''}${goalRow?' goal-row':''}`;
  if(row.className!==classes)row.className=classes;
  const name=displayThreadTitle(subagentLabel(thread)),label=goalRow?name:(thread.source==='cloudCodex'?'云端 · ':thread.readOnly?'云端快照 · ':'')+name;
  if(data.label.textContent!==label)data.label.textContent=label;
  const title=`${thread.title||name}\n${thread.projectPath||''}${thread.unread?'\n未读':''}`;
  if(row.title!==title)row.title=title;
  if(thread.subagent&&!goalRow){
    const parent=state.threads.find(item=>item.id===thread.subagent.parentThreadId);
    const detail=[statusLabel(thread.status),parent?subagentLabel(parent):''].filter(Boolean).join(' · ');
    if(data.project.textContent!==detail)data.project.textContent=detail;
    if(data.label.parentElement!==data.labels){data.labels.replaceChildren(data.label,data.project);row.replaceChildren(data.indicator,data.labels);}
  }else if(goalRow&&thread.projectPath){
    const project=thread.projectPath.replaceAll('\\','/').replace(/\/$/,'').split('/').at(-1);if(data.project.textContent!==project)data.project.textContent=project;
    if(data.label.parentElement!==data.labels){data.labels.replaceChildren(data.label,data.project);row.replaceChildren(data.indicator,data.labels);}
  }else if(data.label.parentElement!==row)row.replaceChildren(data.indicator,data.label);
  return row;
}
function reconcileThreadSection(host,threads,goalRow=false,emptyText=''){
  const before=[...host.children],positions=new Map(before.map((node,index)=>[node,index])),existing=new Map(before.filter(node=>node.dataset.threadId).map(node=>[node.dataset.threadId,node]));
  const desired=threads.map(thread=>sidebarThreadRow(thread,goalRow,existing.get(thread.id)));
  if(!desired.length&&emptyText){const empty=host.querySelector('.sidebar-empty')||el('div','sidebar-empty');if(empty.textContent!==emptyText)empty.textContent=emptyText;desired.push(empty);}
  const keep=new Set(desired),focused=host.contains(document.activeElement)?document.activeElement:null;
  desired.forEach((node,index)=>{if(positions.get(node)!==index)sidebarThreadRowState.get(node)?.cancelPress();});
  for(const node of [...host.children])if(!keep.has(node)){sidebarThreadRowState.get(node)?.cancelPress();node.remove();}
  let position=host.firstChild;
  for(const node of desired){if(node===position)position=position.nextSibling;else{sidebarThreadRowState.get(node)?.cancelPress();host.insertBefore(node,position);}}
  if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
}
function renderThreads() {
  const query=$('search').value.toLowerCase(),harnessThreads=state.threads.filter(thread=>harnessForThread(thread.id)===state.harness),visible=sidebarThreadRoots(harnessThreads,query),children=new Map();
  for(const thread of harnessThreads)if(thread.subagent?.parentThreadId){const list=children.get(thread.subagent.parentThreadId)||[];list.push(thread);children.set(thread.subagent.parentThreadId,list);}
  const pinned=visible.filter(thread=>thread.pinnedIndex).sort((a,b)=>a.pinnedIndex-b.pinnedIndex),activeGoals=visible.filter(thread=>threadFamilyRunning(thread,children)),recent=visible.filter(thread=>!thread.pinnedIndex);
  reconcileThreadSection($('pinnedThreads'),pinned);$('pinnedHeading').hidden=!pinned.length;
  reconcileThreadSection($('activeGoals'),activeGoals,true);$('activeGoalsHeading').hidden=!activeGoals.length;
  const inactive=sidebarInactiveAgents(harnessThreads,query);
  $('inactiveAgents').dataset.totalCount=String(inactive.length);
  reconcileThreadSection($('inactiveAgents'),query.trim()||!(collapsedSections.inactiveAgents??true)?inactive:[]);$('inactiveAgentsHeading').hidden=!inactive.length;
  reconcileThreadSection($('threads'),recent.slice(0,100),false,state.connected?(query?'没有匹配的会话':'你的会话会出现在这里'):'连接后同步最近会话');
  applySidebarSections();
}
const harnessNames={codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build',deepseek:'DeepSeek Harness',hermes:'Hermes',opencode:'OpenCode'};
function harnessForThread(id=''){return /^(claude|antigravity|grok|deepseek|hermes|opencode)-/.exec(id)?.[1]||'codex';}
function harnessForModel(model=''){return modelHarness(model);}
function updateBackendNotice(){
  if(!state.backends.length&&!state.models.length){$('backendNotice').hidden=true;return;}
  const status=agentAvailability(state.backends,state.models,state.harness);
  const notice=status.reason;
  $('backendNotice').textContent=notice;$('backendNotice').hidden=!notice;
}
function updateHarnessLabel(){
  $('prompt').placeholder='向 '+harnessNames[state.harness]+' 描述任务';
  $('prompt').setAttribute('aria-label','发送给 '+harnessNames[state.harness]+' 的消息');
  for(const host of document.querySelectorAll('.brand-symbol,.welcome-mark,#openDrawer')){
    host.removeAttribute('data-icon');
    const mark=el('span','harness-mark harness-brand-mark');mark.dataset.harness=state.harness;mark.setAttribute('aria-hidden','true');host.replaceChildren(mark);
  }
  $('harnessBtn').replaceChildren(document.createTextNode(harnessNames[state.harness]),iconNode('chevron-down'));
  updateBackendNotice();
}
async function switchHarness(harness){
  if(harness===state.harness)return;
  const status=agentAvailability(state.backends,state.models,harness);
  if(!status.available){toast(status.reason,true);return;}
  if(state.pending){toast('消息正在提交，请稍后切换');return;}
  storeDraft();safeWrite('cmc.workspace.'+state.harness,JSON.stringify({threadId:state.threadId,project:state.chatProject}));
  safeWrite('cmc.permission.'+state.harness,safeRead('cmc.permission')||'full');
  state.harness=harness;setConversationSelection();safeWrite('cmc.harness',harness);
  safeWrite('cmc.permission',safeRead('cmc.permission.'+harness)||'full');
  let saved={};try{saved=JSON.parse(safeRead('cmc.workspace.'+harness)||'{}')}catch{}
  state.chatProject=saved.project||'';$('chatModel').value='';fillModelChoices();restoreDraft();updateHarnessLabel();
  renderProjects();renderThreads();showPage('chat');renderConversation({followLatest:true});closeDrawer();
  queueThreadMatches();
  const thread=state.threads.find(t=>t.id===saved.threadId&&harnessForThread(t.id)===harness);
  if(thread)await openThread(thread);
}
$('harnessBtn').onclick=()=>{
  const dialog=el('dialog','choice-dialog harness-dialog');
  const header=el('div','choice-header');header.append(el('h3',null,'选择助手'),button('关闭',()=>dialog.close(),'text-button'));dialog.append(header);
  for(const [key,label] of Object.entries(harnessNames)){
    const status=agentAvailability(state.backends,state.models,key),available=status.available;
    const row=button('',()=>{dialog.close();run(()=>switchHarness(key));},'harness-option');row.disabled=!available;row.setAttribute('aria-pressed',String(key===state.harness));
    const mark=el('span','harness-mark');mark.dataset.harness=key;mark.setAttribute('aria-hidden','true');
    row.title=status.reason;row.setAttribute('aria-label',label+(status.reason?'，'+status.reason:''));
    row.append(mark,el('span','harness-name',label),el('span','harness-state',!available?(status.reason.includes('公网')?'公网不支持':'不可用'):key===state.harness?'当前':''));dialog.append(row);
    if(!available&&status.reason)dialog.append(el('p','form-help',label+'：'+status.reason));
  }
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
};
updateHarnessLabel();
function focusEventStream(threadId=state.threadId){
  if(!state.capabilities?.includes('focused-thread-stream'))return null;
  if(!state.connected||state.ws?.readyState!==WebSocket.OPEN)return Promise.resolve(false);
  return eventFocus.ensure(state.ws,threadId);
}
function setConversationSelection(threadId=''){
  if(threadId!==state.threadId){cancelActivityReads();cancelHistoryReads();}
  state.selection++;
  state.threadId=threadId;
  focusEventStream(threadId);
}
async function selectProject(project) {
  if (!(await allowFileLeave())) return;
  storeDraft();
  setConversationSelection();
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
  setConversationSelection();
  fillModelChoices();
  restoreDraft();
  showPage("chat");
  renderThreads();
  renderConversation();
  closeDrawer();
  $("prompt").focus();
}
let lastEnteredThread="";
const unreadChanges=new Map();
async function openThread(thread,{saveDraft=true}={}) {
  const entered=state.threadId!==thread.id,generation=state.generation;
  const unreadVersion=unreadChanges.get(thread.id)||0;
  const completedAt=Number(thread.completedAt)||0;
  desktopModelSettings.delete(thread.id);
  if(saveDraft)storeDraft();
  setConversationSelection(thread.id);
  const selection=state.selection;
  state.harness=harnessForThread(thread.id);safeWrite('cmc.harness',state.harness);updateHarnessLabel();
  const remembered=safeRead("cmc.threadModel."+thread.id);
  fillModelChoices(remembered);
  const options=[...$("chatModel").options].filter(o=>!o.disabled);
  if(state.harness!=='opencode')$("chatModel").value=options.find(o=>o.value===remembered)?.value||options.find(o=>o.value===$("chatModel").value)?.value||options[0]?.value||"";
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
  if(lastEnteredThread!==thread.id){
    lastEnteredThread=thread.id;
    const conversationHost=$('events');
    conversationHost.classList.remove('thread-enter');void conversationHost.offsetWidth;conversationHost.classList.add('thread-enter');
  }
  await loadThread(thread.id);
  if(entered&&thread.unread&&completedAt>0&&generation===state.generation&&selection===state.selection&&state.threadId===thread.id&&
    unreadVersion===(unreadChanges.get(thread.id)||0)&&!state.historyErrors?.has(thread.id)&&!state.hydrating.has(thread.id)){
    try{
      await api(`/api/threads/${encodeURIComponent(thread.id)}/read`,{method:'POST',body:{completedAt}});
      if(generation!==state.generation||selection!==state.selection||state.threadId!==thread.id||unreadVersion!==(unreadChanges.get(thread.id)||0))return;
      state.threadListRequest=(state.threadListRequest||0)+1;
      state.threads=state.threads.map(row=>row.id===thread.id&&Number(row.completedAt)<=completedAt?{...row,unread:false}:row);
      renderThreads();
    }catch(error){if(generation===state.generation&&selection===state.selection)toast('更新已读状态失败：'+errorMessage(error),true);}
  }
}
const desktopModelSettings=new Map();
function syncDesktopModelSettings(id,settings,revision=state.chatModelRevision) {
  if(state.threadId!==id)return false;
  let pending=desktopModelSettings.get(id);
  if(settings?.model){
    const signature=JSON.stringify(settings);
    if(!pending||pending.signature!==signature||pending.generation!==state.generation||pending.selection!==state.selection){
      pending={signature,model:settings.model,effort:settings.effort,revision,generation:state.generation,selection:state.selection,applied:false};
      desktopModelSettings.set(id,pending);
    }
  }
  if(!pending||pending.applied||pending.generation!==state.generation||pending.selection!==state.selection)return false;
  if(pending.revision!==state.chatModelRevision){pending.applied=true;return false;}
  // A history response may precede the catalog; retain its settings until the model is selectable.
  if(!state.models.some(model=>model.model===pending.model)||![...$('chatModel').options].some(option=>option.value===pending.model&&!option.disabled))return false;
  $('chatModel').value=pending.model;
  safeWrite('cmc.threadModel.'+id,pending.model);
  fillChatEfforts();
  if([...$('chatEffort').options].some(option=>option.value===pending.effort))$('chatEffort').value=pending.effort;
  pending.applied=true;
  return true;
}
function sameConversationEvents(before,after) {
  return before.length===after.length&&before.every((event,index)=>sameConversationData(event,after[index]));
}
function updateConversationHistoryState() {
  const id=state.threadId,events=state.events.get(id)||[];
  const errors=state.historyErrors||=new Map(),error=errors.get(id);
  const pending=Boolean(id)&&state.hydrating.has(id);
  const loading=pending&&!state.events.has(id);
  const setText=(name,text)=>{const node=$(name);if(node.textContent!==text)node.textContent=text;};
  $('historySkeleton').hidden=!loading;
  $('historyEmpty').hidden=!id||loading||Boolean(error)||!state.events.has(id)||events.length>0;
  setText('historyEmpty',activeThread()?.readOnly?'此快照没有可见消息。':'此会话还没有消息。');
  $('historyError').hidden=!id||!error;
  setText('historyErrorText',error?(error.older?'更早消息加载失败：':'消息加载失败：')+error.message:'');
  $('historyRetry').disabled=pending||state.historyLoading.has(id);
  setText('historyRetry',pending?'正在重试…':'重试加载消息');
  $('loadOlder').disabled=state.historyLoading.has(id);
  $('loadOlder').hidden=!id||!state.historyMore.get(id);
  $('events').setAttribute('aria-busy',String(loading));
}
function cancelHistoryReads(){
  for(const read of state.historyReads?.values()||[])read.controller?.abort();
  state.historyReads?.clear();state.hydrating.clear();state.historyLoading.clear();state.historyPageOwners?.clear();
}
async function loadThread(id,{older=false,refresh=false}={}) {
  if(!older&&state.historyLoading.has(id)){
    const owner=state.historyPageOwners?.get(id);
    if(!owner||(owner.generation===state.generation&&owner.selection===state.selection))return;
    state.historyLoading.delete(id);state.historyPageOwners.delete(id);
  }
  const reads=state.historyReads||=new Map(),generation=state.generation,selection=state.selection;
  const existing=reads.get(id);
  if(existing&&existing.generation===generation&&existing.selection===selection&&existing.older===older){
    if(refresh)existing.refresh=true;
    return existing.promise;
  }
  existing?.controller?.abort();
  const owner={generation,selection,older,refresh:false,promise:null,controller:new AbortController()};
  reads.set(id,owner);
  owner.promise=(async()=>{
    try{
      do{
        owner.refresh=false;
        await readThreadHistory(id,{older,signal:owner.controller.signal});
      }while(owner.refresh&&reads.get(id)===owner&&generation===state.generation&&selection===state.selection&&state.threadId===id);
    }finally{
      if(reads.get(id)===owner)reads.delete(id);
    }
  })();
  return owner.promise;
}
async function readThreadHistory(id,{older=false,signal}={}) {
  if(signal?.aborted)return;
  const pendingEvents = [],generation=state.generation,selection=state.selection;
  const requestedRevision=state.chatModelRevision;
  state.hydrating.set(id, pendingEvents);
  updateConversationHistoryState();
  try {
    const focus=id===state.threadId?focusEventStream(id):null;
    if(focus&&(!await focus||signal?.aborted||generation!==state.generation||selection!==state.selection||state.threadId!==id))return;
    const count=older?Math.min(20000,(state.historyCount.get(id)||180)+180):state.threads.find(thread=>thread.id===id)?.readOnly?Math.max(200,state.historyCount.get(id)||200):180;
    const { events, status, hasMore, settings, snapshot } = await api(
      `/api/threads/${encodeURIComponent(id)}/events?count=${count}&activityDetails=deferred`,
      {signal},
    );
    if (signal?.aborted||state.hydrating.get(id) !== pendingEvents||generation!==state.generation) return;
    if(selection===state.selection&&syncDesktopModelSettings(id,settings,requestedRevision))updateControls();
    if(older||!state.historyCount.has(id)){
      state.historyCount.set(id,count);
      state.historyMore.set(id,Boolean(hasMore)&&count<20000);
    }else if(count===180&&state.historyCount.get(id)===180)state.historyMore.set(id,Boolean(hasMore));
    const existing=state.events.get(id)||[];
    const history = restoreActivityDetails(events||[],existing);
    const firstKnown=existing.findIndex(event=>event.eventId&&event.eventId===history[0]?.eventId);
    const earlier=firstKnown>0?existing.slice(0,firstKnown):[];
    const merged=retainCompaction(existing,mergeEvents([...earlier,...history], pendingEvents));
    state.events.set(id,merged);
    state.historyErrors?.delete(id);
    const currentThread=state.threads.find(thread=>thread.id===id);
    const priorStatus=currentThread?.status,priorThreadKey=conversationThreadKey(currentThread);
    if(currentThread?.readOnly&&snapshot?.id===id&&snapshot.readOnly)Object.assign(currentThread,snapshot);
    if(status && !pendingEvents.some(event=>event.type==='user.message'||event.type==='turn.completed') && !state.pending) {
      const thread=state.threads.find(thread=>thread.id===id);if(thread)thread.status=status;
    }
    const unchanged=!older&&sameConversationEvents(existing,merged)&&priorStatus===status&&priorThreadKey===conversationThreadKey(currentThread);
    if (state.threadId === id&&(!unchanged||conversationGeneration!==generation)) {
      renderConversation();
    }
    if(state.threadId===id)await refreshQueue(id).catch(()=>{});
  } catch(error) {
    if(signal?.aborted||state.hydrating.get(id)!==pendingEvents||generation!==state.generation)return;
    (state.historyErrors||=new Map()).set(id,{message:errorMessage(error),older});
    if(state.threadId===id&&selection===state.selection)throw error;
  } finally {
    if(generation===state.generation){
      if(state.hydrating.get(id)===pendingEvents)state.hydrating.delete(id);
      updateConversationHistoryState();
    }
  }
}
async function loadOlderMessages(){
  const id=state.threadId;
  if(!id||!state.historyMore.get(id)||state.historyLoading.has(id))return;
  const generation=state.generation,owners=state.historyPageOwners||=new Map(),owner={generation,selection:state.selection};
  owners.set(id,owner);state.historyLoading.add(id);
  const control=$('loadOlder');control.disabled=true;
  followConversation=false;rememberReadingAnchor();
  try{await loadThread(id,{older:true});}
  finally{if(generation===state.generation&&owners.get(id)===owner){owners.delete(id);state.historyLoading.delete(id);updateConversationHistoryState();}}
}
async function retryConversationHistory() {
  const id=state.threadId;
  if(!id||state.hydrating.has(id)||state.historyLoading.has(id)||!onlineRequired())return;
  if(state.historyErrors?.get(id)?.older&&state.historyMore.get(id))await loadOlderMessages();
  else await loadThread(id);
}
const slashCommands=[['help','查看命令和使用说明'],['status','查看会话、目录和连接'],['goal','设置或编辑会话目标'],['plan','切换下一条消息的计划模式'],['fast','切换快速模式，可能增加用量']];
const composerModes=new Map();
function commitComposerModes(key,sent){
  if(!sent)return;
  const options={...(composerModes.get(key)||sent)};
  if(sent.mode==='plan'&&options.mode==='plan')options.mode='default';
  composerModes.set(key,options);
  if(state.pending?.key===key&&state.pending.selection===state.selection)composerModes.set(draftKey(),options);
  renderSlashCommands();
}
function harnessPlanAvailable(){return state.backends.find(backend=>backend.agent===state.harness)?.supportsPlanMode??['codex','claude','antigravity'].includes(state.harness);}
function availableSlashCommands(){return slashCommands.filter(([name])=>name==='help'||name==='status'||name==='plan'&&harnessPlanAvailable()||state.harness==='codex');}
function slashOptions(){const options=composerModes.get(draftKey())||{mode:'default'};return state.harness==='codex'?options:{mode:harnessPlanAvailable()?options.mode:'default'};}
function renderSlashCommands(){
  let host=$('slashCommands');
  if(!host){host=el('div','slash-commands');host.id='slashCommands';$('composer').before(host);}
  const draft=$('prompt').value;
  const matches=/^\/\S*$/.test(draft)?availableSlashCommands().filter(([name])=>name.startsWith(draft.slice(1).toLowerCase())):[];
  const commandsKey=JSON.stringify([draftKey(),state.harness,matches]);
  if(host.dataset.signature!==commandsKey){
    host.dataset.signature=commandsKey;host.hidden=!matches.length;
    host.replaceChildren(...matches.map(([name,description])=>{
      const row=button('',()=>run(()=>executeSlash(name)),'slash-command');
      row.append(el('strong','', '/'+name),el('span','',description));return row;
    }));
  }
  let modes=$('composerModes');
  if(!modes){modes=el('div','composer-modes');modes.id='composerModes';host.after(modes);}
  const options=slashOptions(),modesKey=JSON.stringify([draftKey(),state.harness,options.mode==='plan',options.fast===true]);
  if(modes.dataset.signature!==modesKey){
    modes.dataset.signature=modesKey;modes.replaceChildren();
    if(options.mode==='plan')modes.append(button('计划模式 ×',()=>run(()=>executeSlash('plan')),'button secondary'));
    if(options.fast===true)modes.append(button('快速模式 ×',()=>run(()=>executeSlash('fast')),'button secondary'));
    modes.hidden=!modes.childElementCount;
  }
}
async function executeSlash(name,goalObjective=null){
  const options={...slashOptions()},thread=activeThread(),commandDraft=$('prompt').value,commandKey=draftKey();
  if(name==='goal'){
    if(!thread){toast('新会话可在输入框直接使用 /goal 目标内容 创建目标');return;}
    if(changingGoals.has(thread.id))return;
    const generation=state.generation;
    const saveObjective=async objective=>{
      changingGoals.add(thread.id);
      updateGoalControls();
      try{
      const result=await api(`/api/threads/${encodeURIComponent(thread.id)}/goal`,{method:'PATCH',body:{objective:objective.trim(),...(goalObjective!==null?{status:'active'}:{})}});
      if(!result.goal)throw new Error('电脑未返回目标状态，输入已保留');
      if(generation!==state.generation)return;
      state.threads=state.threads.map(row=>row.id===thread.id?{...row,goal:result.goal}:row);renderConversation();
      }finally{changingGoals.delete(thread.id);updateControls();}
    };
    if(goalObjective===null){
      if(!await askText('会话目标',thread.goal?.objective||'',200000,saveObjective))return;
    }else{
      if(!goalObjective.trim())return;
      await saveObjective(goalObjective);
    }
  }else if(name==='plan'||name==='fast'){
    if(name==='plan'&&!harnessPlanAvailable()){toast('当前助手未提供计划模式');return;}
    if(name==='fast'&&state.harness!=='codex'){toast('当前助手未提供快速模式切换');return;}
    if(name==='plan')options.mode=options.mode==='plan'?'default':'plan';
    else options.fast=options.fast!==true;
    composerModes.set(draftKey(),options);
  }else{
    const dialog=el('dialog','output-modal'),body=el('div','output-body');
    if(name==='help')for(const [command,description] of slashCommands)body.append(el('p','',`/${command} · ${description}`));
    else body.append(el('pre','output-text',`会话：${thread?.title||'新会话'}\nID：${state.threadId||'尚未建立'}\n目录：${thread?.projectPath||'未选择项目'}\n模型：${$('chatModel').value}\n连接：${state.connected?'已连接':'未连接'}`));
    dialog.append(el('div','output-heading',name==='help'?'命令':'会话状态'),body,button('关闭',()=>dialog.close(),'button secondary'));
    document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  }
  const consumed=goalObjective!==null||/^\/\S*$/.test(commandDraft)&&name.startsWith(commandDraft.slice(1).toLowerCase());
  if(consumed&&state.drafts[commandKey]===commandDraft){state.drafts[commandKey]='';safeWrite('cmc.drafts',JSON.stringify(state.drafts));}
  if(consumed&&draftKey()===commandKey&&$('prompt').value===commandDraft){$('prompt').value='';storeDraft();resizeComposer();}
  renderSlashCommands();updateControls();
}
function readPendingSubmission(){try{return JSON.parse(safeRead('cmc.pendingSubmit')||'null');}catch{return null;}}
function bindSubmissionThread(submission,threadId){
  if(!threadId||submission.threadId===threadId)return;
  submission.threadId=threadId;
  moveNewConversationDraft(submission,threadId);
  moveGoalAttachments(submission,threadId);
  if(!state.threads.some(thread=>thread.id===threadId)){
    const projectPath=submission.command?.projectPath||state.projects.find(project=>project.id===submission.project)?.path||'';
    state.threads=[{id:threadId,title:submission.text.slice(0,80)||'新会话',projectPath,status:'running'},...state.threads];
    queueThreadRefresh();
  }
  if(state.selection===submission.selection){
    state.threadId=threadId;
    focusEventStream(threadId);
    safeWrite('cmc.threadModel.'+threadId,$('chatModel').value);
    fillModelChoices();
    const thread=state.threads.find(thread=>thread.id===threadId);
    state.chatProject=submission.project||state.projects.find(project=>comparablePath(project.path)===comparablePath(thread?.projectPath))?.id||'';
  }
  renderImageDrafts();renderFileDrafts();renderThreads();queueRender();
}
function moveNewConversationDraft(submission,threadId,text=$('prompt').value){
  const target=`thread:${threadId}`;
  if(submission.key===target)return;
  // Requests already in flight must finish in the newly assigned conversation.
  for(const owner of state.uploadOwners){
    if(owner.key===submission.key&&owner.selection===submission.selection)owner.key=target;
  }
  if(state.selection!==submission.selection)return;
  state.drafts[target]=text;
  if(submission.draftEdited||(state.draftRevisions.get(submission.key)||0)!==submission.draftRevision){
    delete state.drafts[submission.key];
  }
  safeWrite('cmc.drafts',JSON.stringify(state.drafts));
  if(submission.goal)return;
  for(const [drafts,sent] of [[state.imageDrafts,submission.images],[state.fileDrafts,submission.files]]){
    const submitted=new Set((sent||[]).map(file=>file.id));
    const source=drafts[submission.key]||[];
    const next=[...(drafts[target]||[]),...source.filter(file=>!submitted.has(file.id))];
    drafts[target]=[...new Map(next.map(file=>[file.id,file])).values()];
    drafts[submission.key]=source.filter(file=>submitted.has(file.id));
  }
  saveImageDrafts();saveFileDrafts();
}
function restoreSubmissionAttachments(submission,threadId){
  if(submission.goal||!threadId||submission.key===`thread:${threadId}`)return;
  const target=`thread:${threadId}`;
  for(const [drafts,sent] of [[state.imageDrafts,submission.images],[state.fileDrafts,submission.files]]){
    const ids=new Set((sent||[]).map(file=>file.id));
    drafts[target]=[...new Map([...(sent||[]),...(drafts[target]||[])].map(file=>[file.id,file])).values()];
    drafts[submission.key]=(drafts[submission.key]||[]).filter(file=>!ids.has(file.id));
  }
  const untouched=!submission.draftEdited&&(submission.draftEpoch===state.draftEpoch?
    (state.draftRevisions.get(submission.key)||0)===submission.draftRevision:!state.draftRevisions.has(submission.key));
  if(untouched&&state.drafts[submission.key]===submission.text&&!state.drafts[target]){
    state.drafts[target]=submission.text;delete state.drafts[submission.key];
  }
  safeWrite('cmc.drafts',JSON.stringify(state.drafts));saveImageDrafts();saveFileDrafts();
}
function consumeSubmissionAttachments(submission,threadId){
  if(submission.goal)return;
  for(const [drafts,sent] of [[state.imageDrafts,submission.images],[state.fileDrafts,submission.files]]){
    const ids=new Set((sent||[]).map(file=>file.id));
    for(const key of new Set([submission.key,...(threadId?[`thread:${threadId}`]:[])]))
      drafts[key]=(drafts[key]||[]).filter(file=>!ids.has(file.id));
  }
  saveImageDrafts();saveFileDrafts();renderImageDrafts();renderFileDrafts();
}
function moveGoalAttachments(submission,threadId){
  if(!submission.goal||!threadId||submission.key===`thread:${threadId}`)return;
  for(const drafts of [state.imageDrafts,state.fileDrafts]){
    const next=[...(drafts[`thread:${threadId}`]||[]),...(drafts[submission.key]||[])];
    drafts[`thread:${threadId}`]=[...new Map(next.map(file=>[file.id,file])).values()];
    delete drafts[submission.key];
  }
  saveImageDrafts();saveFileDrafts();
}
let recoveringSubmission=null,recoveringSubmissionOwner=null;
async function recoverLocalSubmission(retry=false){
  const saved=readPendingSubmission();if(!saved||!state.connected)return !saved;
  const generation=state.generation,selection=state.selection,page=state.page,threadId=state.threadId,project=state.chatProject;
  const stillCurrent=()=>generation===state.generation&&selection===state.selection&&page===state.page&&threadId===state.threadId&&project===state.chatProject;
  if(recoveringSubmission&&recoveringSubmissionOwner?.generation===generation&&recoveringSubmissionOwner.requestId===saved.requestId)return recoveringSubmission;
  const owner={generation,requestId:saved.requestId};
  const editorRevision=state.composerRevision||0,draftRevision=state.draftRevisions?.get(saved.key)||0;
  const submittedDraftOwned=saved.draftEpoch===state.draftEpoch&&saved.draftRevision!==undefined?
    saved.draftRevision===draftRevision:!state.draftRevisions?.has(saved.key);
  const untouchedDraft=()=>!saved.draftEdited&&submittedDraftOwned&&(state.draftRevisions?.get(saved.key)||0)===draftRevision;
  const untouchedComposer=()=>untouchedDraft()&&(state.composerRevision||0)===editorRevision;
  const recovery=(async()=>{
    if(!state.capabilities.includes('local-task-receipts')){toast('请更新电脑网关后确认上次提交；系统不会重复启动。',true);return false;}
    let receipt;
    try{receipt=(await api(`/api/local-tasks/${encodeURIComponent(saved.requestId)}`)).request;}
    catch(error){
      if(generation!==state.generation||readPendingSubmission()?.requestId!==saved.requestId)return false;
      if(error.status!==404){toast('暂时无法确认上次提交，请稍后检查。',true);return false;}
      if(retry&&stillCurrent()&&untouchedComposer()&&$('prompt').value.trim()===saved.text){
        state.pending={...saved,selection:state.selection};sendCommand(saved.command);$('prompt').value='';resizeComposer();updateControls();
        setTimeout(()=>{if(generation===state.generation&&readPendingSubmission()?.requestId===saved.requestId)run(()=>recoverLocalSubmission());},3000);return false;
      }
      toast('上次请求尚未确认；再次发送相同内容会使用原请求 ID。');return false;
    }
    if(generation!==state.generation||readPendingSubmission()?.requestId!==saved.requestId)return false;
    if(receipt.state==='starting'){
      toast('上次提交仍在确认中，请稍后检查。');
      setTimeout(()=>{if(generation===state.generation&&readPendingSubmission()?.requestId===saved.requestId)run(()=>recoverLocalSubmission());},3000);return false;
    }
    if(receipt.state==='uncertain'){
      if(state.pending?.requestId===saved.requestId)restorePendingDraft();
      toast('上次提交结果待确认，请先查看会话；系统不会自动重发。',true);return false;
    }
    saved.draftEdited ||= readPendingSubmission()?.draftEdited===true;
    const retryGoal=saved.goal&&receipt.state==='failed'&&receipt.retryAllowed===true;
    if(!retryGoal||retry)safeWrite('cmc.pendingSubmit','');
    if(state.pending?.requestId===saved.requestId)state.pending=null;
    moveGoalAttachments(saved,receipt.threadId);
    if(receipt.state==='failed')restoreSubmissionAttachments(saved,receipt.threadId);
    if(receipt.state==='accepted')consumeSubmissionAttachments(saved,receipt.threadId);
    renderImageDrafts();renderFileDrafts();
    let ownsView=stillCurrent()&&((state.threadId===(saved.threadId||'')&&state.chatProject===saved.project)||state.threadId===receipt.threadId||(state.selection===0&&!state.threadId));
    let listFailed=false;
    if(receipt.threadId&&ownsView){
      try{await refreshThreads();}catch{listFailed=true;}
      ownsView=stillCurrent();
      const thread=state.threads.find(t=>t.id===receipt.threadId);
      if(thread&&ownsView&&!listFailed){
        const moveFollowup=receipt.state==='accepted'&&!saved.threadId&&saved.key!==`thread:${thread.id}`&&state.threadId!==thread.id;
        if(moveFollowup){
          const source=state.drafts[saved.key]||'';
          moveNewConversationDraft({...saved,selection:state.selection},thread.id,!untouchedDraft()||source!==saved.text?source:'');
        }
        const opening=state.threadId===thread.id?loadThread(thread.id):openThread(thread,{saveDraft:!moveFollowup&&!(saved.goal&&untouchedComposer()&&!$('prompt').value)}),openedSelection=state.selection,openedId=state.threadId,openedProject=state.chatProject;
        await opening;
        ownsView=generation===state.generation&&openedSelection===state.selection&&openedId===state.threadId&&openedProject===state.chatProject&&page===state.page;
      }
    }
    if(generation!==state.generation)return receipt.state==='failed';
    if(retryGoal&&retry&&ownsView&&untouchedComposer()&&$('prompt').value.trim()===saved.text){
      state.pending={...saved,threadId:receipt.threadId||saved.threadId,selection:state.selection};
      safeWrite('cmc.pendingSubmit',JSON.stringify(state.pending));
      try{sendCommand(saved.command);$('prompt').value='';resizeComposer();updateControls();}
      catch(error){restorePendingDraft();throw error;}
      return false;
    }
    if(receipt.state==='accepted'){
      if(untouchedDraft()&&state.drafts[saved.key]===saved.text){delete state.drafts[saved.key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));}
      if(ownsView&&untouchedComposer()&&$('prompt').value.trim()===saved.text){$('prompt').value='';resizeComposer();}
      toast(listFailed?'上次提交已确认，会话列表暂时无法刷新。':ownsView?'上次提交已确认，已恢复会话。':'上次提交已确认。');
    }else {
      if(ownsView&&untouchedComposer()&&!$('prompt').value){$('prompt').value=saved.text;state.drafts[draftKey()]=saved.text;safeWrite('cmc.drafts',JSON.stringify(state.drafts));resizeComposer();}
      toast(receipt.error||'上次提交失败，草稿已保留。',true);
    }
    updateControls();return receipt.state==='failed';
  })();
  recoveringSubmission=recovery;recoveringSubmissionOwner=owner;
  try{return await recovery;}finally{if(recoveringSubmission===recovery){recoveringSubmission=null;recoveringSubmissionOwner=null;}}
}
function showCloudSnapshotImport(){
  if(!onlineRequired())return;
  if(!state.capabilities.includes('cloud-snapshot-readonly')){toast('请先更新电脑网关以支持云端快照。',true);return;}
  const dialog=el('dialog','text-dialog snapshot-import');
  let dismissed=false,submitting=false,fileRead=0;
  const active=()=>!dismissed&&dialog.isConnected!==false&&dialog.open!==false;
  dialog.append(el('h2',null,'导入云端只读快照'),el('p','muted','仅导入用户可见摘要和消息。不要包含内部指令、私人记录或凭据。快照不会自动同步，也不能控制云端任务。'));
  const input=el('textarea','snapshot-json');input.setAttribute('aria-label','快照 JSON');input.placeholder='{"schemaVersion":1,"snapshots":[{"externalId":"任务 ID","title":"标题","updatedAt":"采集时间（ISO 8601）","status":"unknown","contentKind":"summary","messages":[{"role":"assistant","text":"用户可见摘要"}]}]}';
  const file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','选择快照 JSON 文件');
  const error=el('p','error');error.setAttribute('role','alert');
  input.addEventListener('input',()=>{fileRead++;error.textContent='';});
  file.onchange=()=>run(async()=>{
    const read=++fileRead,selected=file.files?.[0];if(!selected)return;
    try{if(selected.size>900000)throw Error('文件超过 900 KB，请分批导入。');const text=await selected.text();if(active()&&read===fileRead)input.value=text;}
    catch(e){if(active()&&read===fileRead)error.textContent=errorMessage(e);}
  });
  const submit=button('导入',async()=>{
    if(submitting||!active())return;
    submitting=true;
    submit.disabled=true;error.textContent='';
    const selection=state.selection,generation=state.generation,page=state.page,read=fileRead;
    try{
      const batch=JSON.parse(input.value),result=await api('/api/cloud-snapshots/import',{method:'POST',body:batch});
      if(generation!==state.generation)return;
      // A successful import invalidates older reads even when its timestamp is
      // unchanged. Keep the visible cache until the authoritative reload arrives.
      for(const row of batch.snapshots||[]){
        const id='cloud-snapshot:'+row.externalId;
        state.historyReads?.get(id)?.controller?.abort();state.historyReads?.delete(id);
        state.hydrating?.delete(id);state.historyLoading?.delete(id);state.historyPageOwners?.delete(id);
      }
      await refreshThreads();
      if(active()&&selection===state.selection&&generation===state.generation&&page===state.page&&read===fileRead){
        dialog.close();const importedId='cloud-snapshot:'+batch.snapshots?.[0]?.externalId;
        const first=state.threads.find(thread=>thread.id===importedId)||result.threads?.find(thread=>thread.id===importedId);
        if(first)await openThread(first);
      }
      if(generation===state.generation)toast(`已导入 ${result.imported} 个只读快照。`);
    }catch(e){if(active()&&read===fileRead&&generation===state.generation)error.textContent=errorMessage(e);}
    finally{submitting=false;submit.disabled=false;}
  },'button');
  dialog.append(file,input,error,submit,button('取消',()=>dialog.close(),'button secondary'));
  dialog.addEventListener('close',()=>{dismissed=true;fileRead++;dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();input.focus();
}
$('cloudSnapshotImportBtn').onclick=showCloudSnapshotImport;

async function sendPrompt() {
  if(activeThread()?.readOnly){toast('云端快照仅供查看。',true);return;}
  const pendingEdit=readMessageEdit(state.threadId);
  if(pendingEdit){
    const id=state.threadId,generation=state.generation,selection=state.selection;
    const current=()=>id===state.threadId&&generation===state.generation&&selection===state.selection;
    try{const result=await checkMessageEdit(pendingEdit);if(!current())return;if(result.state!=='accepted'){showMessageEdit(pendingEdit.message);return;}}
    catch{if(current())showMessageEdit(pendingEdit.message);return;}
  }
  if(state.harness==='opencode'&&$('chatModel').selectedOptions[0]?.disabled){toast('该模型已不可用，请重新选择模型',true);return;}
  if(safeRead('cmc.pendingSubmit')&&!(await recoverLocalSubmission(true)))return;
  const goalCommand=/^\/goal\s+([\s\S]+)$/i.exec($('prompt').value.trim());
  const newGoal=state.harness==='codex'&&!!goalCommand&&!state.threadId;
  if(state.harness==='codex'&&goalCommand&&!newGoal){await executeSlash('goal',goalCommand[1].trim());return;}
  if(newGoal&&!state.capabilities.includes('new-thread-goals')){toast('请更新电脑网关后直接创建目标；当前可先建立会话再设置目标',true);return;}
  const slash=availableSlashCommands().find(([name])=>'/'+name===$('prompt').value.trim().toLowerCase());
  if(slash){await executeSlash(slash[0]);return;}
  if (isRunning()) {
    await enqueueMessage();
    return;
  }
  const text = $("prompt").value.trim();
  const images=newGoal?[]:state.imageDrafts[draftKey()]||[],files=newGoal?[]:state.fileDrafts[draftKey()]||[];
  if ((!text && !images.length&&!files.length) || !onlineRequired() || state.pending || state.uploading) return;
  const project = state.projects.find((p) => p.id === state.chatProject);
  storeDraft();
  const pending = {
    requestId: requestId(),
    text,
    goal:newGoal,
    images,
    files,
    key: draftKey(),
    project: state.chatProject,
    threadId: state.threadId,
    selection: state.selection,
    draftRevision: state.draftRevisions?.get(draftKey())||0,
    draftEpoch: state.draftEpoch,
    modeOptions: {...slashOptions()},
  };
  state.pending = pending;
  try {
    pending.command=state.threadId
        ? {
            type: "turn.start",
            images,
            files,
            threadId: state.threadId,
            projectPath: activeThread()?.projectPath,
            model: $("chatModel").value.trim(),
            effort: $('chatEffort').value || undefined,
            ...slashOptions(),
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
            ...slashOptions(),
            permission: safeRead('cmc.permission') || 'full',
            initialText: text,
            requestId: pending.requestId,
          };
    safeWrite('cmc.pendingSubmit',JSON.stringify(pending));
    sendCommand(pending.command);
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
function queuedMessageCopyButton(message){
  let resetTimer;
  const text=message.text||'',control=button('',async()=>{
    await copy(text,false);clearTimeout(resetTimer);control.replaceChildren(iconNode('check'));control.setAttribute('aria-label','已复制');
    resetTimer=setTimeout(()=>{if(control.isConnected){control.replaceChildren(iconNode('copy'));control.setAttribute('aria-label','复制待发消息');}},1600);
  },'icon-button queue-copy');
  control.append(iconNode('copy'));control.setAttribute('aria-label','复制待发消息');control.title='复制待发消息';control.disabled=!text;
  return control;
}
async function refreshQueue(id=state.threadId) {
  const host=$('followupQueue');
  const requests=state.queueRequests||=new Map(),request=(requests.get(id)||0)+1;requests.set(id,request);
  const selection=state.selection,generation=state.generation;
  if(!id){host.hidden=true;host.replaceChildren();host.dataset.signature='';return;}
  let result;
  try{result=await api(`/api/threads/${encodeURIComponent(id)}/queue`);}
  catch(error){if(requests.get(id)!==request||state.threadId!==id||selection!==state.selection||generation!==state.generation)return;throw error;}
  if(requests.get(id)!==request||state.threadId!==id||selection!==state.selection||generation!==state.generation)return;
  const wasLocked=state.writerLocked.has(id),isLocked=result.messages.some(message=>message.error?.includes('桌面版仍持有'));
  if(isLocked)state.writerLocked.add(id);else state.writerLocked.delete(id);
  if(wasLocked!==isLocked)queueRender();
  const drafts=result.drafts||[];
  if(Object.hasOwn(result,'drafts'))pruneQueueRestoreCopies(id,drafts);
  const signature=JSON.stringify([result.messages,drafts]);
  if(host.dataset.signature===id+signature)return;
  host.dataset.signature=id+signature;host.hidden=!result.messages.length&&!drafts.length;
  host.replaceChildren(...result.messages.map(message=>{
    const row=el('div','queued-message');
    const content=el('div','queued-content');
    content.append(el('span','queued-text',message.text || `${message.images?.length||0} 张图片 · ${message.files?.length||0} 个文件`));
    const status=message.status==='sending'?'发送中':message.error||message.status==='failed'?'待处理':'';
    if(status)content.append(el('small',null,status));
    row.append(iconNode('list'),content);
    const menu=button('',()=>showMenu(menu,[
      ['编辑消息',()=>restoreQueuedMessage(id,message,menu)],
      ...(message.canSteer?[['改为引导',()=>queueAction(id,message.id,'steer')]]:[]),
      ...(message.status==='failed'?[['重试发送',()=>queueAction(id,message.id,'retry')]]:!isRunning()&&message.id===result.messages[0]?.id?[['发送下一条',()=>queueAction(id,message.id,'retry')]]:[]),
      ...(message.error?[['复制错误详情',()=>copy(message.error)]]:[]),
      ['取消发送',()=>queueAction(id,message.id,'delete')],
    ]),'icon-button');menu.append(iconNode('more'));menu.setAttribute('aria-label','待发消息操作');menu.disabled=message.status==='sending'||restoringQueuedMessages.get(JSON.stringify([id,message.id]))?.generation===state.generation;row.append(queuedMessageCopyButton(message),menu);
    if(message.error)row.title=message.error;return row;
  }),...drafts.map(message=>{
    const row=el('div','queued-message'),content=el('div','queued-content');
    content.append(el('span','queued-text',message.text||`${message.images?.length||0} 张图片 · ${message.files?.length||0} 个文件`),el('small',null,'已暂停发送'));
    const restore=button('继续编辑',()=>run(async()=>{
      restore.disabled=true;restore.textContent='正在恢复';
      try{await restoreQueuedMessage(id,message);}finally{restore.disabled=false;restore.textContent='继续编辑';}
    }),'button secondary compact');
    row.append(iconNode('compose'),content,queuedMessageCopyButton(message),restore);return row;
  }));
}
async function queueAction(threadId,id,action,body) {
  const base=`/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(id)}`;
  await api(['steer','retry'].includes(action)?base+'/'+action:base,{method:action==='delete'?'DELETE':action==='edit'?'PATCH':'POST',body});
  await refreshQueue(threadId);
}
const restoringQueuedMessages=new Map();
const queueRestoreCopies=(()=>{try{return JSON.parse(safeRead('cmc.queueRestoreCopies')||'{}')}catch{return {}}})();
const visibleQueueRestoreCopies=new Set();
function pruneQueueRestoreCopies(threadId,drafts){
  const retained=new Set(drafts.map(message=>message.id));let changed=false;
  for(const operation of Object.keys(queueRestoreCopies)){
    const [thread,message]=JSON.parse(operation);
    if(thread===threadId&&!retained.has(message)&&queueRestoreCopies[operation].phase==='saved'){
      delete queueRestoreCopies[operation];visibleQueueRestoreCopies.delete(operation);changed=true;
    }
  }
  if(changed)safeWrite('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));
}
function writeQueueRestoreValue(key,value){
  safeWrite(key,value);
  if(safeRead(key)!==value)throw new Error('草稿未能保存，原待发消息仍保留，请继续恢复');
}
function queueRestoreSnapshot(key){return {text:state.drafts[key]||'',images:state.imageDrafts[key]||[],files:state.fileDrafts[key]||[]};}
function restoredQueueText(original,draft=''){
  if(!original?.trim())return draft||'';
  if(draft.trim()===original.trim()||draft.startsWith(original+'\n\n'))return draft;
  return [original,draft].filter(Boolean).join('\n\n');
}
function syncQueueRestoreCopies(key){
  let changed=false;
  for(const [operation,record] of Object.entries(queueRestoreCopies)){
    if(record.phase==='applying'&&visibleQueueRestoreCopies.has(operation)&&(!key||record.key===key)){
      record.snapshot=queueRestoreSnapshot(record.key);changed=true;
    }
  }
  if(changed)safeWrite('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));
}
function applyQueueRestoreCopy(operation){
  const record=queueRestoreCopies[operation];
  if(record.phase==='saved')return;
  if(!visibleQueueRestoreCopies.has(operation)){
    state.drafts[record.key]=record.snapshot.text;
    state.imageDrafts[record.key]=record.snapshot.images;
    state.fileDrafts[record.key]=record.snapshot.files;
    if(draftKey()===record.key)$('prompt').value=record.snapshot.text;
    visibleQueueRestoreCopies.add(operation);
  }
  syncQueueRestoreCopies(record.key);
  writeQueueRestoreValue('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));
  writeQueueRestoreValue('cmc.drafts',JSON.stringify(state.drafts));
  writeQueueRestoreValue('cmc.imageDrafts',JSON.stringify(state.imageDrafts));
  writeQueueRestoreValue('cmc.fileDrafts',JSON.stringify(state.fileDrafts));
  markDraftEdited(record.key);
  const submitted=readPendingSubmission();
  if(submitted?.key===record.key&&!submitted.draftEdited)throw new Error('草稿编辑状态未保存，请继续恢复');
  record.phase='saved';
  try{writeQueueRestoreValue('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));}
  catch(error){record.phase='applying';throw error;}
}
// An unfinished local copy is replayed before the composer becomes editable.
for(const [operation,record] of Object.entries(queueRestoreCopies)){
  if(record.phase==='applying')try{applyQueueRestoreCopy(operation)}catch(error){queueMicrotask(()=>toast(error.message,true));}
}
async function restoreQueuedMessage(threadId,message,control=null){
  if(state.threadId!==threadId)return;
  if(state.uploading){toast('文件上传完成后再编辑待发消息');return;}
  if(!state.capabilities.includes('queue-draft-recovery')){toast('请更新电脑端后再编辑待发消息');return;}
  const key=draftKey(),operation=JSON.stringify([threadId,message.id]),generation=state.generation,token=state.token;
  if(restoringQueuedMessages.get(operation)?.generation===generation)return;
  const images=[...(message.images||[]),...(state.imageDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index);
  const files=[...(message.files||[]),...(state.fileDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index);
  if(queueRestoreCopies[operation]?.phase!=='saved'&&files.length>8){toast('文件附件已满，请先移除部分文件再编辑待发消息');return;}
  const owner={generation};restoringQueuedMessages.set(operation,owner);if(control)control.disabled=true;
  try{
    const base=`/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(message.id)}/restore`;
    if(!queueRestoreCopies[operation]){
      const {message:original}=await api(base,{method:'POST',token});
      if(generation!==state.generation)return;
      const current=generation===state.generation&&draftKey()===key;
      const snapshot={
        text:restoredQueueText(original.text,(current?$('prompt').value:state.drafts[key])||''),
        images:[...(original.images||[]),...(state.imageDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index),
        files:[...(original.files||[]),...(state.fileDrafts[key]||[])].filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index),
      };
      if(snapshot.files.length>8)throw new Error('文件附件已满，请先移除部分文件再继续编辑');
      queueRestoreCopies[operation]={key,phase:'applying',snapshot};
      try{writeQueueRestoreValue('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));}
      catch(error){delete queueRestoreCopies[operation];throw error;}
    }
    const copied=queueRestoreCopies[operation].phase!=='saved';
    applyQueueRestoreCopy(operation);
    if(copied){const revisions=state.draftRevisions||=new Map();revisions.set(key,(revisions.get(key)||0)+1);}
    const current=generation===state.generation&&draftKey()===key;
    if(current){
      $('prompt').value=state.drafts[key]||'';state.composerRevision=(state.composerRevision||0)+1;
      renderImageDrafts();renderFileDrafts();resizeComposer();updateControls();$('prompt').focus({preventScroll:true});
    }
    if(generation!==state.generation)return;
    try{await api(base+'/complete',{method:'POST',token});}
    catch(error){if(generation===state.generation)throw new Error('内容已取回，队列同步失败：'+errorMessage(error));return;}
    if(generation!==state.generation||restoringQueuedMessages.get(operation)!==owner)return;
    delete queueRestoreCopies[operation];visibleQueueRestoreCopies.delete(operation);
    safeWrite('cmc.queueRestoreCopies',JSON.stringify(queueRestoreCopies));
  }finally{
    if(restoringQueuedMessages.get(operation)===owner){restoringQueuedMessages.delete(operation);if(control)control.disabled=false;}
    if(generation===state.generation)run(()=>refreshQueue(threadId));
  }
}
let queueSubmitting=false;
async function enqueueMessage() {
  if(queueSubmitting||!state.threadId||!onlineRequired())return;
  const queuedOptions={...slashOptions()};
  const text=$('prompt').value.trim(),key=draftKey(),images=state.imageDrafts[key]||[],files=state.fileDrafts[key]||[],id=state.threadId;
  const revision=state.draftRevisions?.get(key)||0;
  if(!text&&!images.length&&!files.length)return;
  queueSubmitting=true;
  updateControls();
  try{
    await api(`/api/threads/${encodeURIComponent(id)}/queue`,{method:'POST',body:{id:requestId(),text,images,files,...slashOptions(),model:$('chatModel').value,effort:$('chatEffort').value||undefined,permission:safeRead('cmc.permission')||'full'}});
    commitComposerModes(key,queuedOptions);
    if((state.draftRevisions?.get(key)||0)===revision){
      if((state.drafts[key]||'').trim()===text){delete state.drafts[key];safeWrite('cmc.drafts',JSON.stringify(state.drafts));}
      if(state.threadId===id&&$('prompt').value.trim()===text){$('prompt').value='';storeDraft();resizeComposer();}
    }
    state.imageDrafts[key]=(state.imageDrafts[key]||[]).filter(i=>!images.some(x=>x.id===i.id));saveImageDrafts();renderImageDrafts();
    state.fileDrafts[key]=(state.fileDrafts[key]||[]).filter(i=>!files.some(x=>x.id===i.id));saveFileDrafts();renderFileDrafts();
    await refreshQueue(id);
  }finally{queueSubmitting=false;updateControls();}
}
function restorePendingDraft() {
  const pending = state.pending;
  if(pending)restoreSubmissionAttachments(pending,pending.threadId);
  if (pending && state.selection === pending.selection && !$("prompt").value) {
    $("prompt").value = pending.text;
    state.drafts[draftKey()]=pending.text;safeWrite('cmc.drafts',JSON.stringify(state.drafts));
    resizeComposer();
  }
  renderImageDrafts();renderFileDrafts();
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
const outputImageGrants=new BoundedLruMap(128);
const outputImageDimensions=new BoundedLruMap(256);
$('events').addEventListener('error',event=>{
  const img=event.target;
  if(!(img instanceof HTMLImageElement)||img.dataset.retryAttached)return;
  img.dataset.retryAttached='true';
  const retry=button('图片加载失败，点击重试',async()=>{retry.disabled=true;retry.textContent='正在加载…';try{if(img.reloadOutputImage)await img.reloadOutputImage();else{const source=img.src;img.removeAttribute('src');img.src=source;}}catch(error){retry.disabled=false;retry.textContent='图片加载失败，点击重试';retry.title=errorMessage(error);}},'text-button');
  img.hidden=true;img.after(retry);
  img.addEventListener('load',()=>{img.hidden=false;retry.remove();delete img.dataset.retryAttached;},{once:true});
  img.addEventListener('error',()=>{retry.disabled=false;retry.textContent='图片加载失败，点击重试';});
},true);
function resolveOutputFile(href,projectId,basePath,source){
  try{return resolveFileLink(href,state.projects,projectId,basePath);}
  catch(error){
    if(!source?.eventId||!source.threadId||!state.capabilities.includes('local-thread-output-files'))throw error;
    const path=localFilePath(href);if(path===null)throw error;
    const target=basePath&&!/^(?:[a-z]:\/|\/)/i.test(path)?encodeURIComponent(basePath+'/'+path):href;
    const name=localFilePath(target).split('/').pop();
    const query=new URLSearchParams({eventId:source.eventId,path:target,token:state.token});
    if(source.documentPath)query.set('source',source.documentPath);
    return {path:localFilePath(target),sourcePath:target,url:`/api/threads/${encodeURIComponent(source.threadId)}/output-file/${encodeURIComponent(name)}?${query}`};
  }
}
function markdownNode(text,projectId=state.chatProject,basePath='',source=null) {
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
      a.onclick=event=>{event.preventDefault();run(()=>openOutputFile(decodeURIComponent(a.dataset.outputFile),projectId,basePath,source));};
      return;
    }
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  renderMath(node);
  node.querySelectorAll('pre > code').forEach(code=>{
    highlightCodeElement(code);
    const pre=code.parentElement;
    if(pre)pre.append(button('复制',()=>copy(code.textContent),'code-copy glyph-action'));
  });
  node.querySelectorAll('[data-output-image]').forEach(holder=>{
    const href=decodeURIComponent(holder.dataset.outputImage);
    try {
      const file=resolveOutputFile(href,projectId,basePath,source),generation=state.generation,key=JSON.stringify(file);
      let grant=outputImageGrants.get(key);
      const preview=()=>file.url?Promise.resolve({url:file.url}):api('/api/preview/file',{method:'POST',body:file});
      if(!grant||grant.expires<Date.now()){grant={expires:Date.now()+50*60*1000,promise:preview()};outputImageGrants.set(key,grant);}
      grant.promise.then(value=>{
        if(generation!==state.generation)return;
        const image=el('img','inline-output-image'),size=outputImageDimensions.get(key);
        image.reloadOutputImage=async()=>{
          const retryGeneration=state.generation;
          const fresh={expires:Date.now()+50*60*1000,promise:preview()};outputImageGrants.set(key,fresh);
          try{const preview=await fresh.promise;if(retryGeneration!==state.generation)throw new Error('连接已切换，请重新打开图片');image.removeAttribute('src');image.src=preview.url;}
          catch(error){if(outputImageGrants.get(key)===fresh)outputImageGrants.delete(key);throw error;}
        };
        if(size){image.width=size.width;image.height=size.height;image.style.aspectRatio=`${size.width} / ${size.height}`;image.style.width=`min(100%, ${size.width}px, calc(min(320px, 50vh) * ${size.width/size.height}))`;}
        image.addEventListener('load',()=>{image.style.removeProperty('width');image.style.removeProperty('aspect-ratio');if(generation===state.generation&&image.naturalWidth>0)outputImageDimensions.set(key,{width:image.naturalWidth,height:image.naturalHeight});},{once:true});
        image.src=value.url;image.alt=file.path;image.onclick=()=>run(()=>openOutputFile(href,projectId,basePath,source));holder.replaceChildren(image);
      }).catch(error=>{if(generation!==state.generation)return;if(outputImageGrants.get(key)===grant)outputImageGrants.delete(key);holder.textContent='图片无法加载：'+errorMessage(error)});
    } catch(error){holder.textContent=errorMessage(error)}
  });
  return node;
}
async function openOutputFile(href,projectId,basePath='',source=null) {
  const generation=state.generation;
  const file=resolveOutputFile(href,projectId,basePath,source);
  if(!file) return;
  const modal=el('dialog','output-modal');
  const heading=el('div','output-heading'),title=el('h2',null,file.path.split('/').pop());
  const close=button('关闭',()=>modal.close(),'button secondary');
  const body=el('div','output-body','正在打开文件…');
  heading.append(title,close);modal.append(heading,body);document.body.append(modal);
  modal.addEventListener('close',()=>modal.remove(),{once:true});trackFilePreview(modal);modal.showModal();
  let controller;
  modal.addEventListener('close',()=>controller?.abort(),{once:true});
  async function load(){
  controller?.abort();controller=new AbortController();body.textContent='正在打开文件…';
  let timer;
  try {
    const grant=file.url?{url:file.url}:await api('/api/preview/file',{method:'POST',body:file});
    if(!modal.isConnected)return;
    if(generation!==state.generation){body.textContent='连接已改变，请重新打开文件。';return;}
    heading.querySelector('a')?.remove();
    const download=el('a','button secondary','下载');download.href=grant.url+(grant.url.includes('?')?'&':'?')+'download=1';download.download=title.textContent;
    download.innerHTML=icon('download');download.title='下载';download.setAttribute('aria-label','下载');
    heading.insertBefore(download,close);
    if(/\.pdf$/i.test(file.path)) await renderPdf(body,grant.url,()=>modal.isConnected&&generation===state.generation);
    else if(previewKind(file.path)==='image') {const img=el('img');img.alt=file.path;img.src=grant.url;enableImageZoom(img);body.replaceChildren(img);}
    else if(previewKind(file.path)==='web'&&!file.url) {const frame=el('iframe');frame.sandbox='allow-scripts';frame.title=file.path;frame.src=grant.url;body.replaceChildren(frame);}
    else if(previewKind(file.path)==='text'||file.url&&previewKind(file.path)==='web') {
      if(file.url)timer=setTimeout(()=>controller.abort(),20000);
      const result=file.url?{content:await readPreviewText(file.url,controller.signal)}:await api(`/api/projects/${file.projectId}/file?path=${encodeURIComponent(file.path)}`);
      if(!modal.isConnected)return;
      if(generation!==state.generation){body.textContent='连接已改变，请重新打开文件。';return;}
      const documentSource=file.url?{...source,documentPath:file.sourcePath}:source;
      body.replaceChildren(/\.(md|markdown)$/i.test(file.path)?markdownNode(result.content,file.projectId||projectId,parentPath(file.path),documentSource):el('pre','output-text',result.content));
    } else body.textContent='此文件可下载到设备后打开。';
    if(modal.isConnected&&generation!==state.generation)body.textContent='连接已改变，请重新打开文件。';
  } catch(error) {if(modal.isConnected){const message=el('p',null,generation===state.generation?'无法打开文件：'+(error.name==='AbortError'?'文件读取超时，请重试':errorMessage(error)):'连接已改变，请重新打开文件。');message.setAttribute('role','alert');body.replaceChildren(message);if(generation===state.generation)body.append(button('重试',load,'button secondary'));}}
  finally{clearTimeout(timer);}
  }
  await load();
}
let conversationCache = new Map();
let conversationExpanded = new Map();
const messageContent=new WeakMap();
function prepareMessage(node,event){
  messageContent.set(node,{...event,threadId:event.threadId||state.threadId});
  node.tabIndex=0;node.setAttribute('aria-haspopup','menu');node.setAttribute('aria-expanded','false');
  node.setAttribute('aria-keyshortcuts','Shift+F10');
  return node;
}
const outgoingMessageKeys=new Map();
function userMessageSignature(event){return JSON.stringify([event.text||'',event.images||[],event.files||[],event.attachments||[],event.questionReplies||[],event.messageSource||null]);}
function sameConversationData(before,after) {
  if(before===after)return true;
  if(!before||!after||typeof before!=='object'||typeof after!=='object')return false;
  if(Array.isArray(before)||Array.isArray(after)){
    return Array.isArray(before)&&Array.isArray(after)&&before.length===after.length&&before.every((value,index)=>sameConversationData(value,after[index]));
  }
  const keys=Object.keys(before);
  return keys.length===Object.keys(after).length&&keys.every(key=>Object.hasOwn(after,key)&&sameConversationData(before[key],after[key]));
}
const activityGroupAppenders=new WeakMap();
let conversationThread = null;
let conversationGeneration = -1;
let followConversation = true;
let readingAnchor = null;
let userScrollUntil = 0;
let jumpScrolling = false;
let jumpScrollingUntil = 0;
let followFrame=0,followTime=0;
function followLatestPosition({immediate=false}={}) {
  if(!followConversation)return;
  const scroll=$('conversationScroll'),target=scroll.scrollHeight-scroll.clientHeight;
  if(immediate||matchMedia('(prefers-reduced-motion: reduce)').matches||Math.abs(target-scroll.scrollTop)>2400){
    cancelAnimationFrame(followFrame);followFrame=0;jumpScrolling=false;readingAnchor=null;scroll.scrollTop=target;return;
  }
  if(followFrame)return;
  followTime=performance.now();
  const tick=now=>{
    followFrame=0;
    if(!followConversation)return;
    const distance=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop;
    if(Math.abs(distance)<1){jumpScrolling=false;readingAnchor=null;scroll.scrollTop=scroll.scrollHeight;return;}
    const elapsed=Math.min(64,Math.max(1,now-followTime));followTime=now;
    scroll.scrollTop+=distance*(1-Math.exp(-elapsed/65));
    followFrame=requestAnimationFrame(tick);
  };
  followFrame=requestAnimationFrame(tick);
}
function rememberReadingAnchor() {
  const scroll = $('conversationScroll'), top = scroll.getBoundingClientRect().top;
  const node = [...$('events').children].find(node => node.getBoundingClientRect().bottom > top);
  readingAnchor = node ? {key:node.dataset.messageKey,offset:node.getBoundingClientRect().top-top} : null;
}
function restoreReadingAnchor() {
  const scroll=$('conversationScroll');
  if(jumpScrolling)return;
  if(followConversation){followLatestPosition();return;}
  const node=readingAnchor && [...$('events').children].find(node=>node.dataset.messageKey===readingAnchor.key);
  if(node) scroll.scrollTop+=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top-readingAnchor.offset;
}
const conversationResize = new ResizeObserver(()=>restoreReadingAnchor());
conversationResize.observe($('events'));
conversationResize.observe($('conversationScroll'));
function showChangeDialog(title,files,diff,load){
  const dialog=el('dialog','output-modal change-modal');
  const heading=el('div','output-heading');
  heading.append(el('strong',null,files?.join('、')||title),button('关闭',()=>dialog.close(),'button secondary compact'));
  const content=el('div'),paint=patch=>diffCode(files?.length===1?filePatch(patch,files[0]):patch);
  dialog.append(heading,content);
  let closed=false;
  const read=async()=>{
    content.textContent='正在加载改动…';
    try{const patch=await load();if(!closed)content.replaceChildren(paint(patch||'此记录未保存补丁'));}
    catch(error){if(!closed)content.replaceChildren(...(error.name==='AbortError'?[]:[el('p',null,errorMessage(error))]),button('重新加载',read,'button secondary compact'));}
  };
  if(load)void read();else content.append(paint(diff));
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{closed=true;dialog.remove();},{once:true});
  dialog.showModal();
}
const activityReads=new Map();
let activityReadEpoch=0;
function cancelActivityReads(){activityReadEpoch++;for(const read of activityReads.values())read.controller.abort();activityReads.clear();}
async function readActivityEvents(threadId,sources){
  const generation=state.generation,epoch=activityReadEpoch;
  while(true){
    if(generation!==state.generation||epoch!==activityReadEpoch)throw new DOMException('会话或连接已切换','AbortError');
    const events=restoreActivityDetails(sources,state.events.get(threadId)||[]);
    const ids=[...new Set(events.filter(event=>event.detailsDeferred&&event.eventId).map(event=>event.eventId))].slice(0,100);
    if(!ids.length)return events;
    let pending=activityReads.get(threadId);const own=!pending;
    if(!pending){
      pending={controller:new AbortController(),promise:null};activityReads.set(threadId,pending);
      const owner=pending;
      pending.promise=(async()=>{
        try{
          const response=await api(`/api/threads/${encodeURIComponent(threadId)}/activity?eventIds=${encodeURIComponent(JSON.stringify(ids))}`,{signal:owner.controller.signal});
          if(generation!==state.generation||epoch!==activityReadEpoch||!state.events.has(threadId))throw new DOMException('会话已切换','AbortError');
          const loaded=new Map((response.events||[]).filter(event=>event.threadId===threadId&&!event.detailsDeferred).map(event=>[event.eventId,event]));
          if(ids.some(id=>!loaded.has(id)))throw new Error('操作详情暂不可用，请重试');
          state.events.set(threadId,state.events.get(threadId).map(event=>loaded.has(event.eventId)?{...event,...loaded.get(event.eventId),detailsDeferred:false}:event));
        }finally{if(activityReads.get(threadId)===owner)activityReads.delete(threadId);}
      })();
    }
    try{await pending.promise;}catch(error){if(own)throw error;}
  }
}
function operationActivityNode(activity,key,expanded,threadId,onRendered){
  const detail=el('details','tool-entry');
  detail.dataset.eventType=activity.type;
  detail.dataset.activityKey=`${key}:operation:${activity.key}`;
  const heading=el('summary','tool-entry-heading');
  heading.append(el('span','tool-entry-title',activity.title));
  if(activity.status==='error')heading.append(el('span','tool-entry-error','失败'));
  detail.append(heading);
  return operationActivityDetails(detail,expanded,activity,threadId,onRendered);
}
function createActivityGroup(event,expanded){
  const node=el('details','activity-block tool-group');
  const generation=state.generation;
  const key=event.eventId||`${event.turnId}:${event.itemId}`;
  node.dataset.activityKey=key;
  node.open=expanded.get(key)||false;
  const summary=el('summary'),label=el('span','status-label');summary.append(label);node.append(summary);
  let current=event,rendered=null,waiting=false;
  const entries=group=>activityEntries(group.activities,{includeDetails:false}).filter(entry=>entry.type!=='reasoning.summary');
  const updateLabel=()=>{const text=activitySummary(current.activities);if(label.textContent!==text)label.textContent=text;};
  const append=host=>{
    const next=entries(current);
    const additions=next.slice(rendered?.length||0);
    for(const activity of additions)host.append(operationActivityNode(activity,key,expanded,current.threadId,events=>{activity.activities=events;}));
    rendered=[...(rendered||[]),...additions];
  };
  const appendWhenOpen=()=>{
    if(waiting||!node.isConnected)return;
    waiting=true;
    renderActivityWhenOpen(node,()=>{waiting=false;if(generation===state.generation)append(node);});
  };
  activityGroupAppenders.set(node,next=>{
    if(next.type!=='activity.group')return false;
    if(rendered){
      const incoming=entries(next);
      if(incoming.length<rendered.length||rendered.some((entry,index)=>!sameConversationData(entry,incoming[index])))return false;
    }
    current=next;updateLabel();
    if(rendered)appendWhenOpen();
    return true;
  });
  updateLabel();
  return lazyActivityDetails(node,expanded,append,appendWhenOpen);
}
function renderActivityWhenOpen(node,render){
  if(!node.isConnected)return;
  const parents=[];
  for(let detail=node;detail;detail=detail.parentElement?.closest('details'))parents.push(detail);
  const paint=()=>{
    if(node.isConnected&&parents.some(detail=>!detail.open))return;
    for(const detail of parents)detail.removeEventListener('toggle',paint);
    if(node.isConnected)render();
  };
  if(parents.every(detail=>detail.open))paint();
  else for(const detail of parents)detail.addEventListener('toggle',paint);
}
function operationActivityDetails(node,expanded,activity,threadId,onRendered){
  return lazyActivityDetails(node,expanded,body=>{
    const content=el('div','tool-entry-body');body.append(content);
    const render=events=>{
      const loaded=activityEntries(events)[0],text=loaded.text;
      const patch=loaded.diff||(loaded.title==='编辑文件'&&text.includes('*** Begin Patch')?text:'');
      content.replaceChildren();
      if(text)content.append(text.includes('![查看图片]')?markdownNode(text):patch?diffCode(text):el('pre',null,text));
      if(patch)content.append(button('查看本次改动',()=>showChangeDialog(loaded.title,loaded.files,patch),'button secondary compact'));
      onRendered?.(events);
    };
    const read=async()=>{
      const generation=state.generation;
      content.textContent='正在加载操作…';
      try{
        const events=await readActivityEvents(threadId,activity.activities);
        if(generation===state.generation)renderActivityWhenOpen(node,()=>{if(generation===state.generation)render(events);});
      }catch(error){
        if(generation===state.generation)renderActivityWhenOpen(node,()=>{
          if(generation!==state.generation)return;
          content.replaceChildren(...(error.name==='AbortError'?[]:[el('p',null,errorMessage(error))]),button('重新加载',read,'button secondary compact'));
        });
      }
    };
    if(activity.activities.some(event=>event.detailsDeferred))void read();else render(activity.activities);
  });
}
function lazyActivityDetails(node, expanded, render, onOpen) {
  const key=node.dataset.activityKey;
  if(expanded.has(key))node.open=expanded.get(key);
  let rendered=false;
  const populate=()=>{
    if(!node.open)return;
    if(rendered){onOpen?.();return;}
    const content=document.createDocumentFragment();
    render(content);
    node.append(content);
    rendered=true;
  };
  node.addEventListener('toggle',event=>{
    if(event.target!==node||!node.isConnected)return;
    expanded.set(key,node.open);
    populate();
  });
  populate();
  return node;
}
let goalClockKey='',goalClock=new GoalRunClock();
function updateGoalRuntime(){
  const goal=activeThread()?.goal,node=$('goalRunTime');
  if(!node)return;
  const key=state.threadId+':'+(goal?.goalId||'');
  if(key!==goalClockKey){goalClockKey=key;goalClock=new GoalRunClock();}
  const seconds=goalClock.sample(goal?.timeUsedSeconds,Boolean(state.connected&&goal?.status==='active'&&isRunning()),performance.now());
  node.hidden=seconds===null||!goal;
  if(seconds!==null){
    const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
    node.textContent=`${hours}:${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    node.setAttribute('aria-label',`运行时间 ${hours}小时${minutes}分${seconds%60}秒`);
  }
}
function renderConversation({ followLatest = false } = {}) {
  const agents=$('conversationAgents');
  if(agents){
    const children=conversationRunningAgents(state.threads,state.threadId);
    const parent=conversationParent(state.threads,state.threadId),back=$('conversationParentBack');
    back.hidden=!parent;back.onclick=parent?()=>run(()=>openThread(parent)):null;
    agents.hidden=!children.length;
    const glyph=el('span','agent-glyph');glyph.append(iconNode('bot'));agents.replaceChildren(glyph);
    const label=children.length?`子代理 · ${children.length}`:'子代理';
    agents.title=label;agents.setAttribute('aria-label',label);
    agents.classList.toggle('has-agents',Boolean(children.length));
    if(children.length)glyph.append(el('span','agent-count',String(children.length)));
    if(agents.dataset.threadId!==state.threadId){if(menuAnchor===agents)hideMenu();agents.dataset.threadId=state.threadId;}
    agents.onclick=()=>showMenu(agents,[
      ...children.map(child=>{
        const parent=state.threads.find(row=>row.id===child.subagent?.parentThreadId&&row.id!==state.threadId);
        return [`${subagentLabel(child)} · ${statusLabel(child.status)}${parent?' · '+subagentLabel(parent):''}`,()=>openThread(child)];
      }),
      ...children.map(child=>[`关闭 ${subagentLabel(child)}`,()=>archiveSubagent(child)]),
    ]);
  }
  const preservingReader=conversationThread===state.threadId&&!followConversation&&!followLatest;
  // Preserve the old geometry before loading/error controls change height.
  if(preservingReader)rememberReadingAnchor();
  updateConversationHistoryState();
  const snapshot=activeThread();
  const running=snapshot?.status==='running';
  $('snapshotNotice').hidden=!snapshot?.readOnly;
  if(snapshot?.source==='cloudCodex'){$('snapshotNotice').textContent='云端会话 · 自动刷新 · 在桌面继续';}
  else if(snapshot?.readOnly){$('snapshotNotice').textContent=`云端会话 · 只读快照\n采集于 ${new Date(snapshot.snapshotUpdatedAt).toLocaleString()} · ${snapshot.snapshotStale?'已过期，':''}非实时状态（${({running:'进行中',completed:'已完成',error:'错误',interrupted:'已中断',unknown:'未知'})[snapshot.snapshotStatus]||'未知'}）\n${snapshot.snapshotContentKind==='messages'?'仅显示导入时的用户可见消息':'人工整理的用户可见摘要，不是完整会话记录'}；需要新快照才能更新。`;}
  document.querySelector('.composer-wrap').hidden=!!snapshot?.readOnly;
  const container = $("conversationScroll");
  const previousTop = container.scrollTop;
  if($('followupQueue').dataset.thread!==state.threadId){$('followupQueue').hidden=true;$('followupQueue').dataset.thread=state.threadId;}
  // Keep nested states even while a refreshed, closed parent has no child DOM.
  const expanded=conversationThread===state.threadId?conversationExpanded:new Map();
  if(conversationThread===state.threadId)for(const node of container.querySelectorAll('details[data-activity-key]'))expanded.set(node.dataset.activityKey,node.open);
  conversationExpanded=expanded;
  if (conversationThread !== state.threadId) { conversationThread=state.threadId; conversationCache=new Map([...conversationCache].filter(([key])=>key===`outgoing:${state.pending?.requestId}`||[...outgoingMessageKeys].some(([eventKey,outgoingKey])=>eventKey.startsWith(state.threadId+":")&&outgoingKey===key)));cancelAnimationFrame(followFrame);followFrame=0;jumpScrolling=false;jumpScrollingUntil=0;userScrollUntil=0;followConversation=true; readingAnchor=null; }
  if (followLatest) followConversation=true;
  const nearBottom = followConversation;
  if(!nearBottom&&!preservingReader) rememberReadingAnchor();
  const events = state.events.get(state.threadId) || [];
  const active=running?activeConversationTask(events):undefined;
  $('taskProgress').hidden=!running;
  $('taskProgress').textContent=running?active?.title&&active.title!=='exec'?active.title:'':'';
  $('taskProgress').setAttribute('aria-label',running?'正在执行任务':'');
  $('loadOlder').hidden=!state.threadId||!state.historyMore.get(state.threadId);
  const blocks = groupToolActivity(conversationBlocks(events, state.threadId, {showWarnings: state.showWarnings}),{running});
  sessionContextActivity={id:state.threadId,generation:state.generation,running:blocks.some(event=>event.type==='context.compaction'&&event.status==='running')};
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
  $("threadTitle").textContent = displayThreadTitle(snapshot?.title,"新会话");
  $("threadMeta").textContent = [
    state.projects.find((p) => p.id === state.chatProject)?.name ||
      displayPath(snapshot?.projectPath),
    state.writerLocked.has(state.threadId)?'桌面占用':statusLabel(snapshot?.status),
  ]
    .filter(Boolean)
    .join(" · ");
  const goal=snapshot?.goal;
  const goalDock=$('goalDock');
  if(goalDock.dataset.threadId!==state.threadId){$('goalDetails').hidden=true;$('threadGoal').setAttribute('aria-expanded','false');goalDock.dataset.threadId=state.threadId||'';}
  goalDock.hidden=!goal;
  if(goal){
    const status=goal.status==='active'?(running?'进行中':'已就绪'):goal.status==='paused'?'已暂停':goal.status==='blocked'?'受阻':goal.status==='usage_limited'?'用量限制':'预算限制';
    $('goalChipText').textContent=`目标：${goal.objective}`;
    $('goalChipStatus').textContent=status;
    $('goalStatus').textContent=status;
    $('goalObjective').textContent=goal.objective;
    $('goalBudget').hidden=goal.tokenBudget==null;
    $('goalBudget').textContent=goal.tokenBudget==null?'':`已用 ${goal.tokensUsed} / ${goal.tokenBudget} tokens`;
    updateGoalRuntime();
    $('toggleGoal').textContent=goal.status==='paused'?'继续':'暂停';
    $('toggleGoal').hidden=!['active','paused'].includes(goal.status);
    updateGoalControls();
    $('editGoal').hidden=state.harness!=='codex';
  }
  const createBlock = (event) => {
    if(event.type==='run.ended'){const label=runEndLabel(event.endedAt);return el('div','run-ended',label?`结束于 ${label}`:'');}
    if(event.type==='process.completed'||event.type==='process.running'){
      const node=el('details','activity-block completed-process');
      node.dataset.activityKey=event.eventId;
      node.open=expanded.get(event.eventId) || false;
      const summary=el('summary');
      summary.setAttribute('aria-label','展开或收起详情');
      summary.append(el('span',null,event.title||'处理过程'));node.append(summary);
      return lazyActivityDetails(node,expanded,content=>{
        for(const child of event.children)content.append(createBlock(child));
      });
    }
    if(event.type==='activity.group')return createActivityGroup(event,expanded);
    if(event.type==='files.summary'){
      const node=el('details','activity-block tool-group');
      node.dataset.activityKey=event.eventId || `${event.turnId}:${event.itemId}`;
      node.open=expanded.get(node.dataset.activityKey) || false;
      const appendActivitySummary=()=>{const summary=el('summary');summary.append(el('span','status-label',activitySummary(event.activities)));node.append(summary);};
      const renderActivities=content=>{
        for(const activity of activityEntries(event.activities,{includeDetails:false}).filter(entry=>entry.type!=='reasoning.summary')){
          content.append(operationActivityNode(activity,node.dataset.activityKey,expanded,event.threadId));
        }
      };
      const changes=new Map();
      const rememberChange=file=>{const previous=changes.get(file.path);changes.set(file.path,{...file,added:file.added??previous?.added,removed:file.removed??previous?.removed});};
      for(const item of event.activities){
        for(const file of item.fileChanges||[])rememberChange(file);
        for(const name of item.files||[])if(!changes.has(name))changes.set(name,{path:name});
        if(item.fileChanges?.length)continue;
        // Old records can lack file metadata. Read only headers until expanded.
        for(const match of (item.diff||'').matchAll(/^(?:\+\+\+ (?:b\/)?|\*\*\* (?:Update|Add|Delete) File: )(.+)\r?$/gm)){
          const path=match[1].trimEnd();
          if(path!=='/dev/null'&&!changes.has(path))changes.set(path,{path});
        }
      }
      if(!changes.size){appendActivitySummary();return lazyActivityDetails(node,expanded,renderActivities);}
      const wrapper=el('div','activity-with-files'),card=el('details','activity-block file-change-summary');
      card.dataset.activityKey=node.dataset.activityKey;
      const appendCounts=(target,added,removed)=>{if(Number.isFinite(added))target.append(document.createTextNode('  '),el('span','diff-count-added',`+${added}`));if(Number.isFinite(removed))target.append(document.createTextNode(' '),el('span','diff-count-removed',`−${removed}`));};
      const fileSummary=el('summary');
      const updateSummary=()=>{const rows=[...changes.values()];fileSummary.textContent=`已更改 ${rows.length} 个文件`;appendCounts(fileSummary,
        rows.some(f=>Number.isFinite(f.added))?rows.reduce((n,f)=>n+(Number.isFinite(f.added)?f.added:0),0):undefined,
        rows.some(f=>Number.isFinite(f.removed))?rows.reduce((n,f)=>n+(Number.isFinite(f.removed)?f.removed:0),0):undefined);};
      updateSummary();
      card.append(fileSummary);
      lazyActivityDetails(card,expanded,content=>{
        for(const item of event.activities){
          if(item.fileChanges?.length)continue;
          let current=null,hunk=false;
          const parsed=new Map();
          for(const line of (item.diff||'').split(/\r\n|\r|\n/)){
            const header=/^\+\+\+ (?:b\/)?(.+)$/.exec(line)||/^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
            if(header){current=header[1].trimEnd();hunk=line.startsWith('*** Add File:');if(current!=='/dev/null')parsed.set(current,line.startsWith('*** Delete File:')?{path:current}:{path:current,added:0,removed:0});}
            else if(line.startsWith('@@'))hunk=true;
            else if(hunk&&parsed.has(current)){const file=parsed.get(current);if(line.startsWith('+'))file.added=(file.added??0)+1;else if(line.startsWith('-'))file.removed=(file.removed??0)+1;}
          }
          for(const file of parsed.values())rememberChange(file);
        }
        updateSummary();
        for(const file of changes.values()){
          const row=button(file.path,()=>{
            const related=event.activities.filter(e=>e.fileChanges?.some(change=>change.path===file.path)||e.files?.includes(file.path)||!e.fileChanges?.length&&(e.diff?.includes(file.path)||e.detail?.includes(file.path)));
            const items=new Set(related.map(e=>e.itemId).filter(Boolean));
            const sources=event.activities.filter(e=>related.includes(e)||e.itemId&&items.has(e.itemId));
            const patch=events=>events.map(e=>e.diff||(e.detail?.includes('*** Begin Patch')?e.detail:'')).filter(Boolean).join('\n');
            showChangeDialog(file.path,[file.path],patch(sources)||'此记录未保存补丁',sources.some(e=>e.detailsDeferred)?async()=>patch(await readActivityEvents(event.threadId,sources)):undefined);
          },'button secondary compact');
          appendCounts(row,file.added,file.removed);content.append(row);
        }
      });
      wrapper.append(card);return wrapper;
    }
    if(event.type==='context.compaction'){
      const label=({running:'正在压缩上下文',cancelled:'压缩已中止',error:'压缩失败'}[event.status]||'上下文已自动压缩');
      if(!event.text)return el('div','event-meta',label);
      const node=el('details','activity-block context-compaction');
      node.dataset.activityKey=event.eventId||`compaction:${event.turnId||''}:${event.itemId||''}`;
      node.append(el('summary',null,label));
      return lazyActivityDetails(node,expanded,content=>content.append(markdownNode(event.text)));
    }
    if (event.type === "user.message") {
      const scheduled=event.messageSource?.kind==='schedule'?{id:event.messageSource.automationId,prompt:event.text}:
        /^\s*<heartbeat>[\s\S]*<\/heartbeat>\s*$/.test(event.text||'')?{id:event.text.match(/<automation_id>\s*([a-zA-Z0-9_-]+)\s*<\/automation_id>/)?.[1],prompt:event.text.match(/<instructions>\s*([\s\S]*?)\s*<\/instructions>/)?.[1]}:null;
      if(scheduled?.id){
        const card=el('details','event-meta scheduled-trigger'),summary=el('summary',null,'定时任务已触发');
        const manage=button('管理',()=>run(()=>showAutomations(scheduled.id)),'button secondary compact');
        manage.addEventListener('click',e=>e.stopPropagation());summary.append(manage);card.append(summary);
        card.dataset.activityKey=event.eventId||`schedule:${scheduled.id}:${event.turnId||''}`;
        return lazyActivityDetails(card,expanded,content=>content.append(el('p',null,scheduled.prompt||'')));
      }
      const node = el("article", "message user");
      if(event.messageSource){
        const source=el('div','message-source');
        if(event.messageSource.avatar?.startsWith('/api/cloud/avatar/')){const avatar=el('img');avatar.alt='';avatar.src=event.messageSource.avatar+'?token='+encodeURIComponent(state.token);avatar.onerror=()=>avatar.remove();source.append(avatar);}
        source.append(document.createTextNode('来自 '+(event.messageSource.name||'其他任务')));node.append(source);
      }
      const bubble = el("div", "user-bubble");
      if(event.images?.length)bubble.append(imageGallery(event.images));
      if(event.files?.length)bubble.append(fileCards(event.files));
      if(event.attachments?.length) {
        const gallery=el('div','image-gallery');
        const inlineGroup=[];
        for(const file of event.attachments) {
          if(file.url?.startsWith('/api/threads/')) {
            const img=el('img','inline-output-image');img.alt=file.name;img.loading='lazy';img.src=file.url+'&token='+encodeURIComponent(state.token);
            const item={src:img.src,alt:file.name};
            inlineGroup.push(item);
            img.onclick=()=>openImageViewer(inlineGroup,inlineGroup.indexOf(item));
            gallery.append(img);
          }
          else if(/\.(png|jpe?g|gif|webp)$/i.test(file.path)) gallery.append(markdownNode(`![${file.name.replace(/[\[\]]/g,'')}](<${file.path.replace(/\\/g,'/') }>)`));
          else bubble.append(button(file.name,()=>openOutputFile(file.path)));
        }
        if(gallery.childNodes.length)bubble.append(gallery);
      }
      if(event.questionReplies?.length)for(const reply of event.questionReplies){
        const pair=el('div','question-reply');
        pair.append(el('blockquote','reply-question',reply.question),el('div','user-bubble-text',reply.answer));
        bubble.append(pair);
      }else if(event.text)bubble.append(el("div", "user-bubble-text", event.text));
      node.append(bubble);
      return prepareMessage(node,event);
    }
    if (event.type === "message.delta") {
      const node = el("article", "message assistant");
      node.append(markdownNode(event.text,state.chatProject,'',{threadId:event.threadId||state.threadId,eventId:event.eventId}));
      return prepareMessage(node,event);
    }
    if (event.type === "approval.requested" && event.approvalType === "question") return questionCard(event);
    if (event.type === "approval.requested") return approvalCard(event);
    const node = el("details", "activity-block");
    node.dataset.eventType = event.type;
    node.dataset.activityKey=event.eventId || `${event.type}:${event.turnId||''}:${event.itemId||''}`;
    if(event.type==='plan.updated'||event.type==='error'&&!event.willRetry)node.open=true;
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
    return lazyActivityDetails(node,expanded,content=>{
    const detail =
      (event.type==='error'?event.detail:null)||event.text || event.diff || event.detail || event.message || event.files?.join("\n");
    if (detail) content.append(['reasoning.summary','plan.updated'].includes(event.type)?markdownNode(detail):event.diff?diffCode(detail):el("pre", null, detail));
    if(event.type==='error'&&detail)content.append(button('复制错误详情',()=>run(()=>copy(detail)),'button secondary compact'));
    if (event.type === "file.changed" || event.type === "diff.updated")
      content.append(
        button(event.diff?"查看本次改动":"查看当前工作区", async () => {
          if(event.diff){showChangeDialog('本次改动',event.files,event.diff);return;}
          state.fileProject = state.chatProject;
          showPage("files");
          await switchFileMode("diff");
        }),
      );
    });
  };
  const knownKeys=new Set(conversationCache.keys());
  const nextCache=new Map();
  const nodes=blocks.map((event,index)=>{
    const key=outgoingMessageKeys.get(`${state.threadId}:${event.eventId}`)||`${state.threadId}:${event.type}:${event.eventId || event.itemId || index}`;
    // Grouping creates new wrappers every render. Compare their JSON data without
    // serializing unchanged text, command output and patches into large strings.
    const signature=event.type==='user.message'?userMessageSignature(event):JSON.stringify([state.generation,state.chatProject,
      event.type==='approval.requested'?state.approvals.find(a=>a.id===event.approvalId):null,
      event.type==='approval.requested'?approvalFeedback.get(approvalKey(event)):null]);
    const previous=conversationCache.get(key);
    const unchanged=previous?.signature===signature&&(event.type==='user.message'||sameConversationData(previous.event,event));
    const appended=!unchanged&&previous?.signature===signature&&activityGroupAppenders.get(previous.node)?.(event);
    const node=unchanged||appended?previous.node:createBlock(event);
    const currentActivity=(event.type==='context.compaction'&&event.status==='running')||(running&&event===blocks.at(-1)&&event.type==='activity.group'&&event.activities.at(-1)?.type!=='tool.completed');
    node.classList.toggle('status-running',Boolean(currentActivity));
    node.dataset.messageKey=key;nextCache.set(key,{signature,event:unchanged?previous.event:event,node});return node;
  });
  if (pending&&!pending.goal) {
    const key=`outgoing:${pending.requestId}`,signature=userMessageSignature(pending);
    const previous=conversationCache.get(key);
    const node=previous?.signature===signature?previous.node:createBlock({...pending,type:'user.message'});
    node.dataset.messageKey=key;nextCache.set(key,{signature,node});
    nodes.push(node);
  }
  conversationCache=nextCache;
  const host=$('events');
  // Keep unchanged messages and loaded images mounted throughout streaming.
  const freshCount=nodes.reduce((sum,node)=>sum+(node.dataset.messageKey&&!knownKeys.has(node.dataset.messageKey)?1:0),0);
  let animated=0;
  nodes.forEach((node,index)=>{
    if(host.children[index]!==node){
      host.insertBefore(node,host.children[index] || null);
      const messageKey=node.dataset.messageKey;
      if(messageKey&&!knownKeys.has(messageKey)&&freshCount<=6&&animated<3){node.classList.add("msg-enter");animated++;}
    }
  });
  while(host.children.length>nodes.length)host.lastElementChild.remove();
  host.querySelectorAll('.stream-cursor').forEach((node)=>node.remove());
  if(running&&blocks[blocks.length-1]?.type==='message.delta'){
    const lastNode=nodes[nodes.length-1];
    if(lastNode?.classList.contains('message')){
      const target=lastNode.querySelector('.markdown > :last-child, .markdown');
      (target||lastNode).append(el('span','stream-cursor'));
    }
  }
  if(followLatest)followLatestPosition({immediate:!jumpScrolling});
  else if(nearBottom)followLatestPosition();
  else if(!jumpScrolling)container.scrollTop=previousTop;
  restoreReadingAnchor();
  $("jumpLatest").hidden = followLatest || nearBottom || !hasConversation;
  updateContext();
  updateControls();
  updateMessageEditNotice();
  updateSessionStatus();
  if(state.page==='chat'&&$('taskNotice')?.dataset.threadId===state.threadId){$('taskNotice').hidden=true;clearTimeout(taskNoticeTimer);}
  conversationGeneration=state.generation;
}
function openManagement(page='overview'){
    if(!safeRead('cmc.token')){openDialog('connectionDialog');return;}
  const allowed=['overview','accounts','modelAccounts','statistics','usage','access','channels','harnesses'];
  window.open('/manage/#'+(allowed.includes(page)?page:'overview'),'_blank','noopener,noreferrer');
}
const sessionUsageCache=new BoundedLruMap(16),sessionUsageReads=new Map(),sessionUsageVersions=new BoundedLruMap(32);
let sessionUsageTimer=null,sessionUsageSeenKey='',sessionContextActivity={id:'',generation:-1,running:false};
async function readSessionUsage(id,{fresh=false}={}){
  const generation=state.generation,cached=sessionUsageCache.get(id),key=generation+':'+id;
  if(!fresh&&cached?.generation===generation&&Date.now()-cached.captured<5000)return cached.result;
  if(sessionUsageReads.has(key))return sessionUsageReads.get(key);
  const version=sessionUsageVersions.get(id)||0;
  const reading=(async()=>{
    const result=await api('/api/usage?'+new URLSearchParams({threadId:id}));
    if(generation!==state.generation)throw Object.assign(Error('连接已改变，请重新读取用量'),{stale:true});
    const value={tokens:result.tokens||null};
    sessionUsageCache.set(id,{generation,captured:version===(sessionUsageVersions.get(id)||0)?Date.now():0,result:value});
    updateSessionStatus();return value;
  })();
  sessionUsageReads.set(key,reading);
  try{return await reading;}finally{
    if(sessionUsageReads.get(key)===reading)sessionUsageReads.delete(key);
    if(generation===state.generation&&id===state.threadId&&version!==(sessionUsageVersions.get(id)||0)&&openUsage?.id!==id)scheduleSessionUsage(1000);
  }
}
function scheduleSessionUsage(delay=400){
  clearTimeout(sessionUsageTimer);sessionUsageTimer=null;
  const id=state.threadId,generation=state.generation;
  if(!id||!state.connected||document.hidden||state.page!=='chat'||activeThread()?.readOnly)return;
  sessionUsageTimer=setTimeout(()=>{sessionUsageTimer=null;if(generation===state.generation&&id===state.threadId&&!document.hidden&&state.connected&&state.page==='chat')void readSessionUsage(id,{fresh:true}).catch(()=>{});},delay);
}
function updateSessionStatus(){
  const id=state.threadId,cached=sessionUsageCache.get(id),tokens=cached?.generation===state.generation?cached.result.tokens:null;
  const compacting=sessionContextActivity.id===id&&sessionContextActivity.generation===state.generation&&sessionContextActivity.running;
  const awaiting=tokens?.contextState==='awaiting_usage';
  const known=typeof tokens?.context==='number'&&Number.isFinite(tokens.context)&&tokens.context>=0;
  const show=Boolean(state.connected&&state.page==='chat'&&id&&(known||awaiting||compacting));
  const button=$('contextUsageBtn');button.hidden=!show;
  const text=compacting?'正在压缩':awaiting?'更新中':sessionUsageValues(tokens).context;
  $('contextCount').textContent=show?text:'';button.classList.toggle('context-pending',compacting||awaiting);
  button.setAttribute('aria-label','上下文 '+text+'，查看本会话用量');button.title='上下文 '+text+' · 本会话用量';
  $('sessionStatus').dataset.connected=String(state.connected);
  $('main').style.setProperty('--session-controls-width',show?'144px':'48px');
  const key=state.generation+':'+id;
  if(state.connected&&state.page==='chat'&&id&&sessionUsageSeenKey!==key){sessionUsageSeenKey=key;scheduleSessionUsage();}
}
function showUsage(){
  if(!onlineRequired())return;
  const thread=activeThread();if(!thread){toast('请先打开一个会话');return;}
  if(openUsage?.id===thread.id&&openUsage.dialog.open){openUsage.dialog.focus();return;}
  openUsage?.dialog.close();
  const generation=state.generation,dialog=el('dialog','modal usage-dialog session-usage-dialog'),heading=el('div','usage-heading'),body=el('div','usage-body');
  const refresh=button('更新用量',()=>reload(),'button secondary compact'),dismiss=button('关闭',()=>dialog.close(),'button secondary compact');
  const actions=el('div','session-usage-actions');actions.append(refresh,dismiss);heading.append(el('h2',null,'本会话用量'),actions);
  const title=el('p','session-usage-title',displayThreadTitle(thread.title,'当前会话')),summary=el('div','session-usage-summary'),counts=el('div','session-usage-counts'),fields=new Map();
  const identity=el('div','session-usage-identity'),threadCode=el('code',null,thread.id);threadCode.title=thread.id;
  identity.append(el('small',null,'会话 ID'),threadCode,button('复制',()=>copy(thread.id),'icon-button'));
  const context=el('div','session-usage-context');
  function metric(root,key,label){const item=el('div'),value=el('strong',null,'—');item.append(el('small',null,label),value);root.append(item);fields.set(key,value);}
  metric(context,'context','当前上下文');metric(context,'contextWindow','上下文窗口');
  metric(summary,'total','总 Token');metric(summary,'cacheHit','缓存命中率');
  for(const [key,label]of [['input','输入'],['output','输出'],['cached','缓存']])metric(counts,key,label);
  const more=el('details','session-usage-more');more.append(el('summary',null,'更多用量信息'));const extra=el('div','session-usage-extra');
  for(const [key,label]of [['last','最近一轮 Token'],['reasoning','思考 Token']])metric(extra,key,label);
  more.append(extra);const feedback=el('p','session-usage-feedback');feedback.setAttribute('role','status');
  body.append(title,identity,context,summary,counts,more,feedback);dialog.append(heading,body);document.body.append(dialog);dialog.showModal();
  let pending=false,loaded=false,updateTimer,refreshAgain=false;
  const cached=sessionUsageCache.get(thread.id);if(cached?.generation===generation){const values=sessionUsageValues(cached.result.tokens);for(const [key,node]of fields)node.textContent=values[key];loaded=true;}
  const owner={id:thread.id,dialog,reload,schedule(){if(updateTimer||!dialog.open)return;updateTimer=setTimeout(()=>{updateTimer=undefined;void reload();},1000);}};openUsage=owner;
  dialog.addEventListener('close',()=>{clearTimeout(updateTimer);if(openUsage===owner)openUsage=null;dialog.remove();},{once:true});
  async function reload(){
    if(!dialog.open)return;if(pending){refreshAgain=true;return;}
    if(generation!==state.generation){feedback.textContent='连接已改变，请重新打开本会话用量';return;}
    pending=true;refresh.disabled=true;refresh.textContent='更新中';refresh.setAttribute('aria-busy','true');feedback.textContent='';
    try{
      const result=await readSessionUsage(thread.id,{fresh:true});
      if(!dialog.open)return;
      if(generation!==state.generation){feedback.textContent='连接已改变，请重新打开本会话用量';return;}
      const values=sessionUsageValues(result.tokens);for(const [key,node]of fields)node.textContent=values[key];loaded=true;
      feedback.textContent=result.tokens?'':'该会话暂未返回用量';
    }catch(error){if(dialog.open)feedback.textContent=(loaded?'更新失败，已保留上次数据：':'读取失败：')+errorMessage(error);}
    finally{pending=false;refresh.disabled=false;refresh.textContent='更新用量';refresh.removeAttribute('aria-busy');if(refreshAgain){refreshAgain=false;owner.schedule();}}
  }
  void reload();
}
$('usageBtn').onclick=()=>openManagement('usage');
$('contextUsageBtn').onclick=showUsage;
$('managementBtn').onclick=()=>openManagement();
document.querySelectorAll('[data-management-page]').forEach(control=>{control.onclick=()=>openManagement(control.dataset.managementPage);});
$('automationsBtn').onclick=()=>run(()=>showAutomations());

async function showAutomations(focusId,{threadId:scopeThreadId=''}={}){
  if(!onlineRequired())return;
  if(state.automationDialog?.open){state.automationDialog.focus();return;}
  const generation=state.generation,creationId=scopeThreadId||state.threadId;
  const creationThread=state.threads.find(thread=>thread.id===creationId);
  let tasks=[],renderedTasks=null,revision=0,saving=false,loading=false,loaded=false;
  const dialog=el('dialog','modal automation-dialog'),heading=el('div','usage-heading'),body=el('div','usage-body');
  const list=el('div','automation-list'),editor=el('div','automation-editor'),rows=el('div','automation-rows');
  const toolbar=el('div','automation-toolbar'),feedback=el('p','automation-feedback');
  feedback.setAttribute('role','status');editor.hidden=true;
  const current=()=>dialog.open&&generation===state.generation;
  const title=el('div');title.append(el('h2',null,scopeThreadId?'本会话定时任务':'定时任务'),el('p','muted',scopeThreadId?creationThread?.title||'当前会话':'全部会话'));
  heading.append(title,button('关闭',()=>{if(!saving)dialog.close();},'button secondary compact'));
  const create=button('新建任务',()=>edit(null),'button compact');
  const refresh=button('刷新列表',()=>run(load),'button secondary compact');
  toolbar.append(create,refresh);list.append(toolbar,feedback,rows);body.append(list,editor);
  dialog.oncancel=event=>{if(saving)event.preventDefault();};
  dialog.append(heading,body);document.body.append(dialog);
  state.automationDialog=dialog;
  dialog.addEventListener('close',()=>{if(state.automationDialog===dialog)state.automationDialog=null;dialog.remove();},{once:true});dialog.showModal();
  function syncControls(){const retired=generation!==state.generation;create.disabled=retired||saving||!loaded;refresh.disabled=retired||saving||loading;refresh.textContent=loading?'正在加载…':'刷新列表';refresh.setAttribute('aria-busy',String(loading));if(retired)feedback.textContent='连接已改变，请重新打开定时任务';}
  async function update(id,value){
    if(saving)return;
    if(!current())throw Error('连接已改变，请重新打开定时任务');
    saving=true;revision++;
    const controls=['button','input','textarea','select'].flatMap(tag=>[...dialog.querySelectorAll(tag)]).map(node=>[node,node.disabled]);
    for(const [node] of controls)node.disabled=true;
    try{
      const result=await api('/api/automations'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:value});
      if(!current())return;
      if(result.automation?.id){const previous=tasks.find(task=>task.id===result.automation.id);tasks=[{...previous,...result.automation},...tasks.filter(task=>task.id!==result.automation.id)];feedback.textContent='';renderList();}
      else{renderList();toast('任务已保存，请刷新列表确认',true);}
    }finally{saving=false;for(const [node,disabled] of controls)if(node.isConnected)node.disabled=disabled;syncControls();}
  }
  function edit(task){
    if(saving)return;
    if(!current()){syncControls();return;}
    revision++;
    list.hidden=true;editor.hidden=false;editor.replaceChildren();
    const form=el('form','automation-form'),name=el('input'),prompt=el('textarea'),interval=el('input'),frequency=el('div','segmented'),change=el('input'),error=el('p','error');
    const activeEditor=()=>current()&&!editor.hidden&&form.isConnected;
    name.value=task?.name||'';name.placeholder='名称';name.required=true;name.maxLength=200;name.setAttribute('aria-label','名称');
    prompt.value=task?.prompt||'';prompt.placeholder='任务内容';prompt.required=true;prompt.maxLength=200000;prompt.setAttribute('aria-label','任务内容');prompt.rows=6;
    change.type='checkbox';change.checked=!task;change.disabled=!task;
    interval.type='number';interval.min='1';interval.max='10080';interval.value=task?.rrule?.match(/INTERVAL=(\d+)/)?.[1]||'5';interval.setAttribute('aria-label','运行间隔');
    let selectedFrequency=task?.rrule?.match(/FREQ=([A-Z]+)/)?.[1]||'MINUTELY';
    if(!['MINUTELY','HOURLY','DAILY','WEEKLY'].includes(selectedFrequency))selectedFrequency='MINUTELY';
    frequency.setAttribute('role','group');frequency.setAttribute('aria-label','间隔单位');
    for(const [value,label] of [['MINUTELY','分钟'],['HOURLY','小时'],['DAILY','天'],['WEEKLY','周']]){
      const option=button(label,()=>{selectedFrequency=value;for(const node of frequency.children){const selected=node===option;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));}},'');
      option.classList.toggle('selected',value===selectedFrequency);option.setAttribute('aria-pressed',String(value===selectedFrequency));frequency.append(option);
    }
    const time=el('div','automation-interval');time.append(interval,frequency);time.hidden=!change.checked;change.onchange=()=>time.hidden=!change.checked;
    const label=el('label',null,task?'调整运行间隔':'运行间隔');label.prepend(change);
    const save=el('button','button','保存');save.type='submit';error.hidden=true;error.setAttribute('role','alert');
    form.onsubmit=event=>{event.preventDefault();if(saving)return;return run(async()=>{
      error.hidden=true;
      try{
      if(!name.value.trim()||!prompt.value.trim())throw Error('请填写名称和任务内容');
      const value={name:name.value.trim(),prompt:prompt.value.trim()};
      if(change.checked){const n=Number(interval.value);if(!Number.isInteger(n)||n<1||n>10080)throw Error('间隔需要为 1–10080');value.schedule={frequency:selectedFrequency,interval:n};}
      if(task?.kind!=='cron'&&!targetId)throw Error('请选择执行会话');
      if(!task||targetId!==task.threadId)value.threadId=targetId;
      await update(task?.id,value);
      }catch(failure){if(dialog.open){error.textContent=errorMessage(failure);error.hidden=false;}}
    });};
    let targetId=task?task.threadId:(creationThread?.readOnly||/^(cloud:|cloud-snapshot:|claude-|antigravity-|grok-|deepseek-|hermes-|opencode-)/.test(creationId)?'':creationId);
    const target=el('div','automation-target'),picker=el('div','automation-target-picker'),search=el('input'),matches=el('div','automation-target-matches'),pickerStatus=el('p','muted');
    picker.hidden=true;search.placeholder='搜索会话名称、路径或 ID';search.setAttribute('aria-label',search.placeholder);picker.append(search,pickerStatus,matches);
    let choose;
    function renderTarget(thread){
      const title=displayThreadTitle(thread?.title||task?.threadTitle||state.threads.find(item=>item.id===targetId)?.title,targetId?`会话 ${targetId.slice(0,8)}`:task?.kind==='cron'?'每次新建会话':'未绑定会话');
      target.replaceChildren(el('span','muted','执行会话'),el('strong',null,title));
      const path=thread?.projectPath||task?.threadPath||state.threads.find(item=>item.id===targetId)?.projectPath;
      if(path)target.append(el('p','automation-target-path',displayPath(path)));
      if(choose)target.append(choose);
    }
    renderTarget();
    if(task?.kind!=='cron'){
      let ticket=0,timer;
      const loadTargets=async()=>{
        if(!activeEditor()||picker.hidden||saving)return;
        const request=++ticket;pickerStatus.textContent='正在读取…';matches.replaceChildren();
        try{
          const result=await api('/api/automations/targets?q='+encodeURIComponent(search.value));
          if(!activeEditor()||request!==ticket||picker.hidden||saving)return;
          pickerStatus.textContent=result.threads.length?(result.hasMore?'请输入关键词查找更多会话':''):'没有匹配的会话';
          for(const thread of result.threads){
            const option=button('',()=>{targetId=thread.id;renderTarget(thread);picker.hidden=true;ticket++;},'button secondary automation-target-option');
            option.append(el('strong',null,displayThreadTitle(thread.title)),el('span',null,displayPath(thread.projectPath)),el('small','muted',thread.id));matches.append(option);
          }
        }catch(failure){if(activeEditor()&&request===ticket&&!picker.hidden){pickerStatus.textContent=errorMessage(failure);matches.append(button('重试',()=>run(loadTargets),'button secondary compact'));}}
      };
      choose=button('更换执行会话',()=>{picker.hidden=!picker.hidden;if(!picker.hidden)return run(loadTargets);ticket++;},'button secondary compact');
      search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>run(loadTargets),250);};
      target.append(choose);form.append(picker);
    }
    const field=(text,control)=>{const node=el('label','automation-field');node.append(el('span',null,text),control);return node;};
    form.append(field('名称',name),field('任务内容',prompt),label,time,error,save);
    editor.append(button('返回列表',()=>{if(!saving)renderList();},'button secondary compact'),target,form);
  }
  async function load(){
    if(saving||loading)return;
    if(!current()){syncControls();return;}
    const request=++revision;
    loading=true;feedback.textContent='正在加载…';syncControls();
    try{
      const {automations}=await api('/api/automations');if(!current()||request!==revision)return;
      if(!Array.isArray(automations))throw Error('电脑返回的任务列表格式异常');
      tasks=automations;loaded=true;feedback.textContent='';renderRows();
      if(focusId){const task=tasks.find(t=>t.id===focusId&&(!scopeThreadId||t.threadId===scopeThreadId));focusId=null;if(task)edit(task);}
    }catch(error){if(current()&&request===revision){
      feedback.textContent=(loaded?'更新失败，已保留列表：':'读取失败：')+errorMessage(error);
    }}
    finally{loading=false;syncControls();}
  }
  function renderList(){
    revision++;list.hidden=false;editor.hidden=true;renderRows();
  }
  function renderRows(){
    const visible=tasks.filter(task=>!scopeThreadId||task.threadId===scopeThreadId);
    if(renderedTasks&&sameConversationData(renderedTasks,visible))return;
    const top=dialog.scrollTop,focused=document.activeElement;
    rows.replaceChildren();renderedTasks=visible;
    if(!visible.length)rows.append(el('p','muted',scopeThreadId?'本会话暂无定时任务':'暂无定时任务'));
    for(const task of visible){
      const row=el('section'),n=task.rrule.match(/INTERVAL=(\d+)/)?.[1]||'1',unit={MINUTELY:'分钟',HOURLY:'小时',DAILY:'天',WEEKLY:'周'}[task.rrule.match(/FREQ=([A-Z]+)/)?.[1]];
      row.className='automation-row';
      row.append(el('h3',null,task.name),el('p',null,(task.status==='ACTIVE'?'已启用':'已暂停')+' · '+(unit&&!task.rrule.includes('BY')?`每 ${n} ${unit}`:'自定义时间')));
      row.append(el('p',null,'执行会话 · '+displayThreadTitle(task.threadTitle||state.threads.find(item=>item.id===task.threadId)?.title,task.threadId?`会话 ${task.threadId.slice(0,8)}`:task.kind==='cron'?'每次新建会话':'未绑定会话')));
      const targetPath=task.threadPath||state.threads.find(item=>item.id===task.threadId)?.projectPath;
      if(targetPath)row.append(el('p','automation-target-path',displayPath(targetPath)));
      if(task.nextRunAt)row.append(el('p',null,'下次运行 '+new Date(task.nextRunAt).toLocaleString()));
      const toggle=button(task.status==='ACTIVE'?'暂停':'恢复',()=>run(()=>update(task.id,{status:task.status==='ACTIVE'?'PAUSED':'ACTIVE'})),'button secondary compact');
      const editButton=button('编辑',()=>edit(task),'button secondary compact'),actions=el('div','automation-actions');
      toggle.dataset.taskId=editButton.dataset.taskId=task.id;toggle.dataset.action='toggle';editButton.dataset.action='edit';
      actions.append(toggle,editButton);row.append(actions);rows.append(row);
    }
    if(focused?.dataset.taskId){const target=[...rows.querySelectorAll('button')].find(node=>node.dataset.taskId===focused.dataset.taskId&&node.dataset.action===focused.dataset.action);target?.focus({preventScroll:true});}
    dialog.scrollTop=top;
  }
  await load();
}
function runEndLabel(value){
  const ended=new Date(value);
  if(!Number.isFinite(ended.getTime()))return '';
  const today=new Date(),yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
  const sameDay=day=>day.getFullYear()===ended.getFullYear()&&day.getMonth()===ended.getMonth()&&day.getDate()===ended.getDate();
  const day=sameDay(today)?'今天':sameDay(yesterday)?'昨天':`${ended.getFullYear()===today.getFullYear()?'':ended.getFullYear()+'年'}${ended.getMonth()+1}月${ended.getDate()}日`;
  const time=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(ended);
  return `${day} ${time}`;
}
const messageEditRecords=new Map();
let messageEditDialog=null;
const messageEditChecks=new Map();
function readMessageEdit(threadId,{fresh=false}={}){
  if(!threadId)return;
  if(fresh||!messageEditRecords.has(threadId)){
    let record;
    try{const saved=JSON.parse(safeRead('cmc.messageEdit.'+threadId)||'null');if(saved?.command?.replaceTurnId&&saved.requestId&&saved.message?.threadId===threadId)record=saved;}catch{}
    messageEditRecords.set(threadId,record);
  }
  return messageEditRecords.get(threadId);
}
function storeMessageEdit(record,remove=false){
  const previous=readMessageEdit(record.message.threadId,{fresh:true});
  if(remove&&previous?.requestId!==record.requestId)return;
  messageEditRecords.set(record.message.threadId,remove?undefined:record);
  safeWrite('cmc.messageEdit.'+record.message.threadId,remove?'':JSON.stringify(record));
  updateMessageEditNotice();
}
function messageEditTurn(message){
  if(message?.type!=='user.message')return '';
  const id=message?.threadId,thread=state.threads.find(row=>row.id===id);
  if(!id||id!==state.threadId||message.type!=='user.message'||!message.text?.trim()||message.questionReplies?.length||!message.eventId||thread?.readOnly||harnessForThread(id)!=='codex')return '';
  if(!state.connected||state.pending||state.uploading||state.hydrating.has(id)||isRunning()||!state.capabilities.includes('last-message-edit')||!state.capabilities.includes('local-task-receipts'))return '';
  const events=state.events.get(id)||[],last=events.findLast(event=>event.type==='user.message');
  if(last?.eventId!==message.eventId)return '';
  return last.turnId||events.findLast(event=>event.type==='turn.started')?.turnId||'';
}
function updateMessageEditNotice(){
  const record=readMessageEdit(state.threadId);let notice=$('messageEditNotice');
  if(!record){if(notice)notice.hidden=true;return;}
  if(!notice){notice=el('div','message-edit-notice');notice.id='messageEditNotice';$('composer').before(notice);}
  notice.hidden=false;
  const key=record.requestId+':'+record.state;
  if(notice.dataset.key===key)return;
  notice.dataset.key=key;
  notice.replaceChildren(el('span',null,record.state==='failed'?'消息修改未提交':'消息修改待确认'),button('查看结果',()=>showMessageEdit(record.message),'button secondary compact'),button('复制内容',()=>copy(record.text),'button secondary compact'));
}
async function checkMessageEdit(record,{wait=false}={}){
  const generation=state.generation,key=generation+':'+record.requestId;
  if(messageEditChecks.has(key))return messageEditChecks.get(key);
  const checking=(async()=>{
    const deadline=performance.now()+(wait?15000:0);
    while(true){
      let result;
      try{result=(await api('/api/local-tasks/'+encodeURIComponent(record.requestId),{timeout:5000})).request;}
      catch(error){if(error.status!==404)throw error;result={state:'missing'};}
      if(generation!==state.generation)throw Error('连接已改变，请重新查看修改结果');
      if(!['starting','accepted','failed','uncertain','missing'].includes(result?.state))throw Error('电脑未返回修改状态，请重新查看结果');
      if(readMessageEdit(record.message.threadId,{fresh:true})?.requestId!==record.requestId)return result;
      record={...record,state:result.state,error:result.error||'',retryAllowed:result.retryAllowed===true,replacementApplied:Boolean(result.replacement)};
      storeMessageEdit(record,result.state==='accepted');
      if(!wait||!['starting','missing'].includes(result.state)||performance.now()>=deadline||document.hidden)return result;
      await new Promise(resolve=>setTimeout(resolve,750));
    }
  })();
  messageEditChecks.set(key,checking);
  try{return await checking;}finally{if(messageEditChecks.get(key)===checking)messageEditChecks.delete(key);}
}
function showMessageEdit(message){
  if(messageEditDialog?.open){messageEditDialog.focus();return;}
  const generation=state.generation,id=message.threadId;
  let saved=readMessageEdit(id),saving=false;
  if(!saved&&!messageEditTurn(message)){toast('这条消息已不是可编辑的最后一条，请刷新会话后再试',true);return;}
  const dialog=el('dialog','modal message-edit-dialog'),form=el('form','message-edit-form'),heading=el('div','usage-heading'),input=el('textarea'),feedback=el('p','message-edit-feedback'),actions=el('div','button-row');
  const save=el('button','button','保存并重发');save.type='submit';
  const close=button('关闭',()=>dialog.close(),'button secondary compact');
  heading.append(el('h2',null,'编辑消息'),close);input.value=saved?.text||message.text||'';input.rows=8;input.maxLength=200000;input.required=true;input.setAttribute('aria-label','编辑消息');
  feedback.setAttribute('role','status');
  actions.append(button('复制内容',()=>copy(input.value),'button secondary compact'),save);
  form.append(heading,el('p','muted','替换这条消息并重新生成回复'),input,feedback,actions);dialog.append(form);document.body.append(dialog);
  messageEditDialog=dialog;
  dialog.addEventListener('close',()=>{if(messageEditDialog===dialog)messageEditDialog=null;dialog.remove();},{once:true});dialog.showModal();
  function sync(result){
    saved=readMessageEdit(id);
    input.readOnly=Boolean(saved);save.disabled=saving;
    save.textContent=saving?'正在确认…':!saved?'保存并重发':['missing','failed'].includes(saved.state)?'重试修改':'查看结果';
    if(result?.state==='uncertain')feedback.textContent='提交结果待确认，请查看会话或稍后再次查看结果';
    else if(result?.state==='starting')feedback.textContent='修改仍在提交中，稍后可再次查看结果';
    else if(result?.state==='missing')feedback.textContent='尚未找到提交记录，可按原内容重试';
    else if(result?.state==='failed')feedback.textContent=result.error||'修改未提交';
  }
  async function finish(result){
    if(result.state==='accepted'){
      if(dialog.open)dialog.close();
      if(generation===state.generation&&state.threadId===id)run(()=>loadThread(id,{refresh:true}));
      return true;
    }
    if(result.state==='failed'&&!result.retryAllowed&&!result.replacement){const record=readMessageEdit(id);if(record)storeMessageEdit(record,true);}
    if(dialog.open)sync(result);
    return false;
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    saving=true;sync();feedback.textContent='正在确认修改…';
    try{
      if(generation!==state.generation)throw Error('连接已改变，请复制内容后重新打开编辑');
      if(!state.connected)throw Error('连接尚未就绪，内容已保留');
      let record=readMessageEdit(id);
      if(record){
        const result=await checkMessageEdit(record);
        if(result.state==='accepted'){await finish(result);return;}
        if(!((result.state==='failed'&&result.retryAllowed)||result.state==='missing')){await finish(result);return;}
        // Keep the exact payload and request ID: the backend records any rollback.
        record=readMessageEdit(id);input.value=record.text;
      }else{
        if(readPendingSubmission())throw Error('请先确认上一条消息的提交结果');
        const turnId=messageEditTurn(message),text=input.value.trim();
        if(!text)throw Error('请输入内容');
        if(!turnId)throw Error('这条消息已不是可编辑的最后一条，请刷新后再试');
        const command={type:'turn.start',requestId:requestId(),threadId:id,replaceTurnId:turnId,text,model:$('chatModel').value.trim(),effort:$('chatEffort').value||undefined,permission:safeRead('cmc.permission')||'full',...slashOptions()};
        record={requestId:command.requestId,text,message:{...message,turnId},command,state:'starting'};
        storeMessageEdit(record);
      }
      try{sendCommand(record.command);}catch(error){if(!saved)storeMessageEdit(record,true);throw error;}
      sync();await finish(await checkMessageEdit(record,{wait:true}));
    }catch(error){if(dialog.open)feedback.textContent=errorMessage(error);}
    finally{saving=false;if(dialog.open)sync();}
  };
  sync();input.focus({preventScroll:true});
}
function messageTurnText(message){
  if(message.type!=='message.delta'||!message.eventId)return message.text||'';
  const blocks=conversationBlocks(state.events.get(message.threadId)||[],message.threadId,{showWarnings:false});
  const index=blocks.findIndex(event=>event.type==='message.delta'&&event.eventId===message.eventId);
  if(index<0)return message.text||'';
  const boundary=event=>['user.message','turn.started','turn.completed'].includes(event.type);
  let start=index,end=index+1;
  while(start>0&&!boundary(blocks[start-1]))start--;
  while(end<blocks.length&&!boundary(blocks[end]))end++;
  return blocks.slice(start,end).filter(event=>event.type==='message.delta').map(event=>event.text).filter(Boolean).join('\n\n');
}
function showMessageSelection(text,title='选择文本',source=null){
  const previous=source||document.activeElement;
  const dialog=el('dialog','modal text-selection-dialog'),heading=el('div','usage-heading'),content=el('div','text-selection-content',text);
  dialog.setAttribute('aria-label',title);content.tabIndex=0;
  heading.append(el('h2',null,title),button('复制全文',()=>copy(text),'button secondary compact'),button('关闭',()=>dialog.close(),'button secondary compact'));
  dialog.append(heading,content);document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});},{once:true});dialog.showModal();
  content.focus({preventScroll:true});
}
function mountConversationMessageMenu(){
  const host=$('events');let press=null,suppressed=null,suppressedUntil=0;
  const hasSelection=()=>Boolean(window.getSelection()?.toString());
  const target=event=>{
    if(event.target.closest('a,button,input,textarea,select,summary,video,audio,[contenteditable="true"]'))return null;
    const node=event.target.closest('article.message');
    return node&&host.contains(node)&&messageContent.get(node)?.threadId===state.threadId?node:null;
  };
  const cancel=()=>{if(press)clearTimeout(press.timer);press=null;};
  const open=(node,position)=>{
    const message=messageContent.get(node);if(!message||hasSelection())return false;
    if(menuAnchor===node&&!$('actionMenu').hidden)return true;
    const text=message.text||'',items=[['复制',()=>copy(text)],['选择文本',()=>showMessageSelection(text,'选择文本',node)]];
    if(messageEditTurn(message))items.push(['编辑消息',()=>showMessageEdit(message)]);
    if(message.type==='message.delta'){
      const round=messageTurnText(message);
      if(round&&round!==text)items.push(['选择本轮回复',()=>showMessageSelection(round,'本轮回复',node)]);
    }
    const ended=runEndLabel(message.endedAt);
    showMenu(node,items,ended?'结束于 '+ended:'',position);return true;
  };
  host.addEventListener('contextmenu',event=>{const node=target(event);cancel();if(node&&hasSelection()){if(menuAnchor===node)hideMenu();return;}if(node&&open(node,{x:event.clientX,y:event.clientY}))event.preventDefault();});
  host.addEventListener('keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.key==='F10'&&event.shiftKey))return;
    const node=target(event);if(node&&open(node)){event.preventDefault();event.stopPropagation();}
  });
  host.addEventListener('pointerdown',event=>{
    cancel();suppressed=null;
    if(event.pointerType==='mouse'||!event.isPrimary||event.button!==0||hasSelection())return;
    const node=target(event);if(!node)return;
    const data=messageContent.get(node),owner={node,data,x:event.clientX,y:event.clientY,generation:state.generation};
    press=owner;owner.timer=setTimeout(()=>{
      if(press!==owner||owner.generation!==state.generation||owner.data.threadId!==state.threadId)return;
      let current=owner.node;
      if(!current.isConnected)current=[...host.querySelectorAll('article.message')].find(candidate=>{const data=messageContent.get(candidate);return data?.threadId===owner.data.threadId&&data?.eventId&&data.eventId===owner.data.eventId;});
      if(current&&open(current,{x:owner.x,y:owner.y})){suppressed=current;suppressedUntil=performance.now()+900;}
      cancel();
    },520);
  },{passive:true});
  host.addEventListener('pointermove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>8)cancel();},{passive:true});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(type,cancel,{passive:true});
  $('conversationScroll').addEventListener('scroll',cancel,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  host.addEventListener('click',event=>{if(performance.now()<suppressedUntil&&event.target.closest('article.message')===suppressed){event.preventDefault();event.stopImmediatePropagation();suppressed=null;}},true);
}
async function copy(text,notify=true) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = el("textarea");
    field.value = text;
    field.style.cssText = "position:fixed;opacity:0";
    const previous=document.activeElement;
    const host=previous?.closest?.('dialog[open]')||document.querySelector('dialog[open]')||document.body;
    const selection=typeof previous?.selectionStart==='number'?{start:previous.selectionStart,end:previous.selectionEnd,direction:previous.selectionDirection}:null;
    let ok=false;
    try{
      host.append(field);field.focus({preventScroll:true});field.select();
      ok=document.execCommand('copy');
    }catch{ok=false;}
    finally{
      field.remove();
      if(previous?.isConnected){previous.focus({preventScroll:true});if(selection)previous.setSelectionRange(selection.start,selection.end,selection.direction);}
    }
    if (!ok) throw new Error("复制失败，请手动选择文本复制。");
  }
  if(notify)toast("已复制");
}
let approvalRefreshTicket=0;
async function refreshApprovals() {
  const threadId=state.threadId,generation=state.generation,ticket=++approvalRefreshTicket;
  const current=()=>ticket===approvalRefreshTicket&&threadId===state.threadId&&generation===state.generation;
  try{
    const { approvals } = await api("/api/approvals"+(threadId?"?threadId="+encodeURIComponent(threadId):""));
    if(!current())return;
    state.approvals = approvals || [];
    queueRender();
  }catch(error){if(current())throw error;}
}
async function resolveApproval(id, decision, threadId=state.threadId) {
  const key=approvalKey({threadId,approvalId:id});
  const prior=state.approvals.find(a=>a.id===id);
  if(threadId!==state.threadId||approvalFeedback.get(key)?.pending||(prior&&prior.status!=='pending'))return;
  const generation=state.generation,current=()=>threadId===state.threadId&&generation===state.generation;
  approvalFeedback.set(key,{pending:true,decision,error:''});queueRender();
  try{await api(`/api/approvals/${encodeURIComponent(id)}/resolve`,{method:'POST',body:{decision}});}
  catch(error){approvalFeedback.set(key,{pending:false,error:error.message||'提交失败，请重试'});if(current())queueRender();return;}
  approvalFeedback.delete(key);
  if(!current())return;
  applyApprovalResult(id,threadId,decision==='accept'?'accepted':'declined');
  try{await refreshApprovals();}catch(error){if(current())toast('决定已提交，状态刷新失败：'+error.message);}
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
let filePreviewRead=null;
let fileDetailRead=null;
function cancelFilePreview(){
  filePreviewRead?.controller.abort();filePreviewRead=null;
  // Detached frames stop running; PDF observers also dispose their loading/render work.
  $('filePreview').replaceChildren();
}
function resetFile() {
  fileDetailRead?.abort();fileDetailRead=null;
  cancelFilePreview();
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
let fileListRead=null;
async function loadFiles(path = state.filePath) {
  fileListRead?.abort();fileListRead=null;
  const generation=state.generation;
  const serial = ++state.listRequest;
  state.fileListError='';
  state.fileListLoading=false;
  if (!state.fileProject) {
    state.files = [];
    state.diffFiles = [];
    renderFiles();
    return;
  }
  const project = state.fileProject;
  state.filePath = path;
  const controller=new AbortController();fileListRead=controller;
  state.fileListLoading=true;
  renderFiles();
  try {
    if (state.fileMode === "diff") {
      const data = await api(`/api/projects/${project}/diff/files`,{signal:controller.signal});
      if (serial !== state.listRequest||generation!==state.generation) return;
      state.diffFiles = data.files || [];
    } else {
      const data = await api(
        `/api/projects/${project}/files?path=${encodeURIComponent(path)}`,
        {signal:controller.signal},
      );
      if (serial !== state.listRequest||generation!==state.generation) return;
      state.files = data.files || [];
    }
    state.fileListLoading=false;
    renderFiles();
  } catch (error) {
    if (serial === state.listRequest&&generation===state.generation) {
      state.fileListLoading=false;
      state.fileListError=errorMessage(error);
      renderFiles();
    }
    if(serial===state.listRequest&&generation===state.generation)throw error;
  } finally {
    if(fileListRead===controller)fileListRead=null;
  }
}
function renderFiles() {
  const diff = state.fileMode === "diff";
  const query = $("fileSearch").value.toLowerCase();
  $("filePathLabel").textContent = diff
    ? "Git 改动"
    : state.filePath || "项目根目录";
  $("upBtn").disabled = diff || !state.filePath;
  $("diffCount").textContent = state.fileListLoading||state.fileListError?"":state.diffFiles.length || "";
  if(state.fileListLoading){
    $("files").replaceChildren(el("div","sidebar-empty","正在读取…"));
    return;
  }
  if(state.fileListError){
    const error=el('div','diff-empty',state.fileListError);
    error.setAttribute('role','status');
    $("files").replaceChildren(error,button('重试',()=>loadFiles(),'button secondary compact'));
    return;
  }
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
  const generation=state.generation;
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
      const controller=new AbortController();fileDetailRead=controller;
      const data = await api(
        `/api/projects/${project}/file?path=${encodeURIComponent(file.path)}`,
        {signal:controller.signal},
      ).finally(()=>{if(fileDetailRead===controller)fileDetailRead=null;});
      if (serial !== state.fileRequest||generation!==state.generation) return;
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
    if(serial!==state.fileRequest||generation!==state.generation)return;
    renderFiles();
    updateControls();
  } catch (error) {
    if (serial === state.fileRequest&&generation===state.generation) {
      $("fileEmpty").hidden = false;
      $("fileEmpty").querySelector("h2").textContent = "无法打开文件";
      $("fileEmpty").querySelector("p").textContent = errorMessage(error);
    }
    if(serial===state.fileRequest&&generation===state.generation)throw error;
  }
}
async function previewFile() {
  const opened = state.opened;
  const generation=state.generation;
  cancelFilePreview();
  if (!opened) return;
  const owner={controller:new AbortController()};filePreviewRead=owner;
  const current=()=>filePreviewRead===owner&&!owner.controller.signal.aborted&&state.opened===opened&&generation===state.generation;
  const target = $("filePreview");
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
    const loading=el('div','pane-empty','正在加载图片…');
    const showing=()=>current()&&target.contains(image);
    image.alt = opened.path;
    image.hidden=true;
    image.onload=()=>{if(showing()){loading.remove();image.hidden=false;}};
    image.onerror=()=>{
      if(!showing())return;
      const message=el('div','pane-empty','图片加载失败，请检查连接后重试。');
      message.setAttribute('role','status');
      target.replaceChildren(message,button('重试',()=>previewFile(),'button secondary compact'));
    };
    target.append(loading,image);
    image.src = `/raw/projects/${opened.project}/file?path=${encodeURIComponent(opened.path)}&token=${encodeURIComponent(state.token)}`;
  } else if (opened.kind === "web" || /\.pdf$/i.test(opened.path)) {
    const grant = await api("/api/preview/file", {
      method: "POST",
      body: { projectId: opened.project, path: opened.path },
      signal:owner.controller.signal,
    }).catch(error=>{if(current())throw error;return null;});
    if (!grant||!current()) return;
    if(/\.pdf$/i.test(opened.path)) {await renderPdf(target,grant.url,current).catch(error=>{if(current())throw error;});return;}
    const frame = el("iframe");
    frame.title = opened.path;
    frame.sandbox = "allow-scripts";
    frame.src = grant.url;
    target.append(frame);
  } else {
    target.append(el("div", "pane-empty", "此文件不支持文本编辑。"));
  }
}
const fileSaves=new Map();
async function saveFile() {
  const opened = state.opened;
  const generation=state.generation;
  if (!opened?.editable) return;
  const content = $("editor").value;
  const key=JSON.stringify([opened.project,opened.path]),previous=fileSaves.get(key);
  if(previous&&previous.generation===generation&&previous.content===content)return previous.promise;
  const save={generation,content,promise:null};
  save.promise=(async()=>{
    if(previous)await previous.promise.catch(()=>{});
    if(generation!==state.generation)return;
    await api(
      `/api/projects/${opened.project}/file?path=${encodeURIComponent(opened.path)}`,
      { method: "PUT", body: { content } },
    ).catch(error=>{if(state.opened===opened&&generation===state.generation)throw error;});
    if (state.opened !== opened||generation!==state.generation)return;
    opened.original = content;
    toast($("editor").value===content?"文件已保存":"已保存提交的版本，后续修改尚未保存");
    updateControls();
  })();
  fileSaves.set(key,save);
  try{await save.promise;}finally{if(fileSaves.get(key)===save)fileSaves.delete(key);}
}
function diffCode(text) {
  const node = el("pre", "diff-code");
  if(text.length>262144||text.split('\n').length>5001||text.split('\n').some(line=>line.length>10000)){node.textContent='改动过大或包含超长行，暂不直接展示。';return node;}
  const rows=patchLines(text);
  const append=(parent,row)=>{
    const line=el('span',`diff-line ${row.kind}`);
    line.append(el('span','diff-number',`${row.oldLine??''} ${row.newLine??''}`),el('span','diff-source',row.text||' '));parent.append(line);
  };
  for(let i=0;i<rows.length;){
    const start=i;
    if(rows[i].kind==='context')while(i<rows.length&&rows[i].kind==='context')i++;else i++;
    if(i-start>8){
      rows.slice(start,start+3).forEach(row=>append(node,row));
      const fold=el('details','diff-context');fold.append(el('summary',null,`${i-start-6} 行未修改`));rows.slice(start+3,i-3).forEach(row=>append(fold,row));node.append(fold);
      rows.slice(i-3,i).forEach(row=>append(node,row));
    }else rows.slice(start,i).forEach(row=>append(node,row));
  }
  return node;
}
async function openDiff(file) {
  if (!(await allowFileLeave())) return;
  resetFile();
  const serial = ++state.fileRequest;
  const generation=state.generation;
  const project = state.fileProject;
  $("openedFileName").textContent = file.path;
  $("fileWorkbench").classList.add("show-detail");
  $('fileEmpty').querySelector('h2').textContent='正在读取改动…';
  $('fileEmpty').querySelector('p').textContent=file.path;
  const controller=new AbortController();fileDetailRead=controller;
  const result = await Promise.all([
    api(
      `/api/projects/${project}/diff/file?path=${encodeURIComponent(file.path)}`,
      {signal:controller.signal},
    ),
    api(
      `/api/projects/${project}/diff/file/hunks?path=${encodeURIComponent(file.path)}`,
      {signal:controller.signal},
    ),
  ]).catch(error=>{
    const stale=serial!==state.fileRequest||generation!==state.generation;
    controller.abort();
    if(stale)return null;
    $('fileEmpty').hidden=true;
    const view=$('diffView'),message=el('div','diff-empty','无法读取改动：'+errorMessage(error));
    message.setAttribute('role','status');
    view.hidden=false;
    view.replaceChildren(message,button('重试',()=>openDiff(file),'button secondary compact'));
    return null;
  }).finally(()=>{if(fileDetailRead===controller)fileDetailRead=null;});
  if(!result)return;
  const [data,hunks]=result;
  if (serial !== state.fileRequest||generation!==state.generation) return;
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
  accept.dataset.unavailable=String(accept.disabled);
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
  updateDiffControls();
  renderFiles();
  updateControls();
}
const diffWrites=new Set();
function diffWriteKey(project,path){return JSON.stringify([state.generation,project,path]);}
function updateDiffControls(){
  const busy=diffWrites.has(diffWriteKey(state.fileProject,state.diffSelected?.path));
  for(const control of $('diffView').querySelectorAll('button')){
    control.disabled=busy||control.dataset.unavailable==='true';
    control.setAttribute('aria-busy',String(busy));
  }
}
async function applyDiff(action, file, hunk) {
  const project=state.fileProject,generation=state.generation,serial=state.fileRequest;
  const key=diffWriteKey(project,file.path);
  if(diffWrites.has(key))return;
  diffWrites.add(key);updateDiffControls();
  try{
  if (
    action === "revert" &&
    !(await confirmAction(
      hunk?.source === "staged" ? "取消暂存？" : "撤销改动？",
      `${file.path}${hunk ? " 的选定片段" : ""}。${hunk?.source === "staged" ? "工作区内容会保留。" : "未提交的修改将被丢弃，无法自动恢复。"}`,
    ))
  )
    return;
  if(project!==state.fileProject||generation!==state.generation||serial!==state.fileRequest)return;
  await api(
    `/api/projects/${project}/diff/file/${hunk ? "hunk/" : ""}${action}?path=${encodeURIComponent(file.path)}`,
    {
      method: "POST",
      body: hunk ? { source: hunk.source, index: hunk.index } : {},
    },
  );
  if(project!==state.fileProject||generation!==state.generation||state.diffSelected?.path!==file.path)return;
  const message=action==='accept'?'已暂存':hunk?.source==='staged'?'已取消暂存':'改动已撤销';
  toast(message);
  resetFile();
  const reloadSerial=state.fileRequest;
  try{await loadFiles();}
  catch(error){if(project===state.fileProject&&generation===state.generation)toast(message+'，列表刷新失败：'+errorMessage(error),true);return;}
  if(project!==state.fileProject||generation!==state.generation||reloadSerial!==state.fileRequest)return;
  const current = state.diffFiles.find((f) => f.path === file.path);
  if (current) await openDiff(current);
  }finally{diffWrites.delete(key);updateDiffControls();}
}

function isInteractive(record) {
  return Boolean(
    record?.interactive || record?.command?.includes("交互式会话"),
  );
}
async function refreshTerminals({quiet=false}={}) {
  const request=++state.terminalRequest,generation=state.generation;
  const data = await api("/api/terminal/commands?includeOutput=false&previewChars=0&limit=100").catch(error=>{
    if(request===state.terminalRequest&&generation===state.generation){if(quiet){if(state.page==='terminal'&&!document.hidden)$('terminalStatus').textContent='终端记录更新失败：'+errorMessage(error);}else throw error;}
    return null;
  });
  if(!data||request!==state.terminalRequest||generation!==state.generation)return;
  const previous=state.terminalCommands.find(record=>record.commandId===state.activeTerminal);
  state.terminalCommands = data.commands || [];
  const selected=state.terminalCommands.find(record=>record.commandId===state.activeTerminal);
  if(state.terminalBuffer?.id===state.activeTerminal&&Number.isFinite(previous?.outputLength)&&Number.isFinite(selected?.outputLength)&&selected.outputLength<previous.outputLength){state.terminalBuffer={id:state.activeTerminal,text:'',end:0};state.terminalOutputLoading=false;state.terminalOutputError='';}
  renderTerminalList();
  if(state.activeTerminal){syncTerminalOutput();if(state.page==='terminal'&&!document.hidden)await readTerminalOutput().catch(()=>{});}
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
async function readTerminalOutput(){
  const id=state.activeTerminal,generation=state.generation,record=state.terminalCommands.find(row=>row.commandId===id);
  if(!id||!record||state.page!=='terminal'||document.hidden)return;
  const buffer=state.terminalBuffer?.id===id?state.terminalBuffer:(state.terminalBuffer={id,text:'',end:0});
  const current=()=>generation===state.generation&&state.activeTerminal===id&&state.terminalBuffer===buffer;
  const previous=state.terminalOutputRead;if(previous?.buffer===buffer&&previous.generation===generation)return previous.promise;
  if(Number.isFinite(record.outputLength)&&buffer.end>=record.outputLength){syncTerminalOutput();return;}
  const read={buffer,generation,promise:null};state.terminalOutputLoading=true;state.terminalOutputError='';syncTerminalOutput();
  read.promise=(async()=>{
    try{
      let more=true;
      while(current()&&state.page==='terminal'&&!document.hidden&&more){
        const {output}=await api(`/api/terminal/commands/${encodeURIComponent(id)}/output?offset=${buffer.end}&limit=100000&stream=combined`);
        if(!current())return;
        if(output.offset!==buffer.end){buffer.text='';buffer.end=0;syncTerminalOutput();if(output.offset!==0)continue;}
        if(output.end<output.offset||output.hasMoreAfter&&output.end===output.offset)throw Error('终端输出位置未推进，请重试读取');
        buffer.text+=output.text;buffer.end=output.end;syncTerminalOutput();
        const latest=state.terminalCommands.find(row=>row.commandId===id);more=output.hasMoreAfter||output.end>output.offset&&Number.isFinite(latest?.outputLength)&&buffer.end<latest.outputLength;
      }
    }catch(error){if(current()){state.terminalOutputError=errorMessage(error);throw error;}}
    finally{if(state.terminalOutputRead===read)state.terminalOutputRead=null;if(current()){state.terminalOutputLoading=false;syncTerminalOutput();}}
  })();
  state.terminalOutputRead=read;return read.promise;
}
async function selectTerminal(id) {
  state.activeTerminal = id;
  state.terminalOutput = "";
  state.terminalBuffer={id,text:'',end:0};state.terminalOutputError='';state.terminalOutputLoading=false;
  ensureTerminal();
  state.terminal.reset();
  $("terminalEmpty").hidden = true;
  renderTerminalList();
  syncTerminalOutput();
  fitTerminal();
  state.terminal.focus();
  updateControls();
  await readTerminalOutput();
}
function syncTerminalOutput() {
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (!record || !state.terminal) return;
  let text = state.terminalBuffer?.id===record.commandId?state.terminalBuffer.text:record.output||'';
  if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
  if (text.startsWith(state.terminalOutput)) {
    if(text.length>state.terminalOutput.length)state.terminal.write(text.slice(state.terminalOutput.length));
  } else {
    state.terminal.reset();
    if(text)state.terminal.write(text);
  }
  state.terminalOutput = text;
  $("terminalTitle").textContent = record.command || "终端";
  $("terminalStatus").textContent =
    `${statusLabel(record.status)} · ${record.cwd || ""}${state.terminalOutputError?' · 输出读取失败：'+state.terminalOutputError:state.terminalOutputLoading?' · 正在读取输出':''}`;
}
async function newTerminal() {
  if (!onlineRequired() || !state.terminalProject || state.terminalSubmitting) return;
  const project = state.terminalProject,generation=state.generation,selected=state.activeTerminal;
  state.terminalSubmitting=true;updateControls();
  try{
  const result = await api(`/api/projects/${project}/terminal/session`, {
    method: "POST",
    body: { cols: 100, rows: 30 },
  });
  if(generation!==state.generation)return;
  try{await refreshTerminals();}
  catch(error){toast('终端已创建，列表刷新失败：'+errorMessage(error),true);return;}
  if (generation===state.generation&&state.terminalProject === project&&state.activeTerminal===selected)await selectTerminal(result.sessionId);
  }finally{state.terminalSubmitting=false;updateControls();}
}
async function runTerminalCommand() {
  const command = $("commandInput").value;
  if (!command.trim() || !onlineRequired() || !state.terminalProject || state.terminalSubmitting) return;
  const project=state.terminalProject,generation=state.generation,selected=state.activeTerminal;
  const current=()=>generation===state.generation&&project===state.terminalProject&&selected===state.activeTerminal;
  const active = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  state.terminalSubmitting=true;updateControls();
  try{
  let commandId;
  if (isInteractive(active) && active.status === "running")
    await api(
      `/api/terminal/sessions/${encodeURIComponent(active.commandId)}/input`,
      { method: "POST", body: { text: command, appendNewline: true } },
    );
  else {
    const result = await api(
      `/api/projects/${project}/terminal/run`,
      { method: "POST", body: { command } },
    );
    commandId=result.commandId;
  }
  if(current()&&$("commandInput").value===command)$("commandInput").value='';
  if(commandId&&generation===state.generation){
    try{await refreshTerminals();}
    catch(error){toast('命令已提交，列表刷新失败：'+errorMessage(error),true);return;}
    if(current())await selectTerminal(commandId);
  }
  }finally{state.terminalSubmitting=false;updateControls();}
}
const terminalStops=new Set();
function terminalStopKey(id){return JSON.stringify([state.generation,id]);}
function updateTerminalStopControl(){
  const record=state.terminalCommands.find(row=>row.commandId===state.activeTerminal);
  const busy=terminalStops.has(terminalStopKey(state.activeTerminal)),control=$('stopTerminalBtn');
  control.disabled=!state.connected||record?.status!=='running'||busy;
  control.setAttribute('aria-busy',String(busy));
  control.setAttribute('aria-label',busy?'正在请求停止终端':'停止终端');
  control.title=busy?'正在请求停止终端':'停止终端';
}
async function stopTerminal() {
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal,
  );
  if (!state.connected||record?.status!=='running') return;
  const generation=state.generation,key=terminalStopKey(record.commandId);
  if(terminalStops.has(key))return;
  terminalStops.add(key);updateTerminalStopControl();
  try{
  await api(
    isInteractive(record)
      ? `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/stop`
      : `/api/terminal/${encodeURIComponent(record.commandId)}/stop`,
    { method: "POST", body: {} },
  );
  if(generation!==state.generation)return;
  try{await refreshTerminals();}
  catch(error){if(generation===state.generation)toast('停止请求已提交，列表刷新失败：'+errorMessage(error),true);}
  }catch(error){if(generation===state.generation)throw error;}
  finally{terminalStops.delete(key);updateTerminalStopControl();}
}

const {loadSettings} = createSettingsController({
  state,$,api,run,safeRead,loadModels,fillModelChoices,fillChatEfforts,updateControls,refreshCodex:()=>refreshCodex(),toast,errorMessage,
});

async function loadModels() {
  clearTimeout(state.modelsTimer);
  const generation=state.generation,request=state.modelsRequest=(state.modelsRequest||0)+1;
  const current=()=>generation===state.generation&&request===state.modelsRequest;
  async function read(){
    if(!current())return;
    try {
    const result=await api('/api/models?agents=all&partial=1',{timeout:10000});
    if(!current())return;
    const pending=Array.isArray(result.pending)?result.pending:[];
    const models=Array.isArray(result.models)?result.models:[];
    if(!models.length&&!pending.length)throw new Error('暂未获取到可选模型，请重试读取设置');
    const ids=new Set(models.map(model=>model.model));
    state.models=[...models,...state.models.filter(model=>pending.includes(modelHarness(model))&&!ids.has(model.model))];
    state.modelPending=pending;
    state.modelLoadFailed=false;
    state.backends=Array.isArray(result.backends)?result.backends.map(backend=>pending.includes(backend.agent)?state.backends.find(previous=>previous.agent===backend.agent)||backend:backend):[];
    fillModelChoices();
    syncDesktopModelSettings(state.threadId);
    updateControls();
    if(pending.length)state.modelsTimer=setTimeout(()=>{read().catch(()=>{});},600);
    } catch(error) {
      if(!current())return;
      clearTimeout(state.modelsTimer);state.modelsTimer=null;
      state.modelPending=[];state.modelLoadFailed=true;
      if(!state.models.length)state.backends=[];
      renderModelChoices({state,$,safeRead,Option,fillEfforts,fillChatEfforts,updateBackendNotice,preserveAvailable:true});
      updateControls();
      throw error;
    }
  }
  await read();
}
function fillModelChoices(rememberedModel='') {
  return renderModelChoices({state,$,safeRead,Option,fillEfforts,fillChatEfforts,updateBackendNotice},rememberedModel);
}
function fillChatEfforts(){
  return renderModelEfforts({state,$,safeRead,Option});
}
$('chatModel').addEventListener('change',()=>{state.chatModelRevision++;safeWrite('cmc.model.'+state.harness,$('chatModel').value);if(state.threadId)safeWrite('cmc.threadModel.'+state.threadId,$('chatModel').value);fillChatEfforts();updateControls();});
$('chatEffort').addEventListener('change',()=>{state.chatModelRevision++;safeWrite('cmc.effort.'+$('chatModel').value,$('chatEffort').value);});
function fillEfforts() {
  const model=state.models.find(m=>m.model===$('settingModel').value);
  const current=$('settingEffort').value;
  $('settingEffort').replaceChildren(...(model?.supportedReasoningEfforts || []).map(e=>new Option(e.reasoningEffort,e.reasoningEffort)));
  $('settingEffort').value=[...$('settingEffort').options].some(o=>o.value===current)?current:model?.defaultReasoningEffort || '';
}
$('settingModel').addEventListener('change',fillEfforts);
const {renderCodexStatus, refreshCodex, renderRoots, updateUpgradeControl} = createManagementController({
  state,$,api,run,el,button,confirmAction,errorMessage,comparablePath,renderProjects,refreshProjects,toast,onlineRequired,
});

let localPreviewTicket=0,localPreviewPending=null;
async function previewLocal() {
  if (!onlineRequired()) return;
  const target = validatePreview($("previewUrl").value.trim());
  const generation=state.generation;
  if(localPreviewPending?.target===target&&localPreviewPending.generation===generation)return;
  const request=++localPreviewTicket,control=$('previewForm').querySelector('button');
  localPreviewPending={target,generation};
  control.textContent='正在打开…';control.setAttribute('aria-busy','true');
  if($('preview').hidden){
    $('previewEmpty').querySelector('h2').textContent='正在打开预览…';
    $('previewEmpty').querySelector('p').textContent=target;
  }
  try{
  const result = await api("/api/preview", {
    method: "POST",
    body: { url: target },
  });
  if(request!==localPreviewTicket||generation!==state.generation)return;
  $("preview").src = result.url;
  $("preview").hidden = false;
  $("previewEmpty").hidden = true;
  }catch(error){
    if(request!==localPreviewTicket||generation!==state.generation)return;
    if($('preview').hidden){
      $('previewEmpty').querySelector('h2').textContent='无法打开预览';
      $('previewEmpty').querySelector('p').textContent=errorMessage(error);
    }
    throw error;
  }finally{
    if(request===localPreviewTicket){localPreviewPending=null;control.textContent='打开预览';control.setAttribute('aria-busy','false');}
  }
}

let drawerReturnFocus;
const desktopSidebar = matchMedia('(min-width:761px)');
let sidebarExpanded = safeRead('cmc.sidebarExpanded') === 'true';
let mobileDrawerOpen = false;
function syncSidebarLayout() {
  const desktop = desktopSidebar.matches;
  const open = desktop ? sidebarExpanded : mobileDrawerOpen;
  const desktopOpen = desktop && open;
  document.body.classList.toggle('sidebar-expanded', desktopOpen);
  $('sidebar').inert=!open;
  $('sidebar').setAttribute('aria-hidden',String(!open));
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
  if(search){$('sidebarSearchBox').hidden=false;$('sidebarSearchToggle').hidden=true;}
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
let terminalUnread = 0;
function setTerminalUnread(count) {
  terminalUnread = count;
  document.title = count > 0 ? `(${count}) 新终端输出 · Codex 控制台` : "Codex 控制台";
}
window.addEventListener("focus", () => {
  if (state.page === "terminal" && terminalUnread) setTerminalUnread(0);
});
function showPage(page) {
  state.page = page;
  if (page === "terminal" && terminalUnread) setTerminalUnread(0);
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
function showMenu(anchor, items, header='',position=null) {
  const menu = $("actionMenu");
  if (!menu.hidden && menuAnchor === anchor) {hideMenu();return;}
  if(menuAnchor&&menuAnchor!==anchor)menuAnchor.setAttribute('aria-expanded','false');
  menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  menu.setAttribute('role', 'menu');
  const menuIcons = {'复制':'copy','图片或视频':'image','文件':'file','置顶':'pin','取消置顶':'pin-off','新会话':'compose','当前项目文件':'folder','再次使用上一条':'refresh','重命名':'pencil','移除会话':'trash','显示运行提示':'eye','隐藏运行提示':'eye-off','编辑消息':'pencil','改为引导':'steer','重试发送':'refresh','发送下一条':'send','取消发送':'close','复制错误详情':'copy'};
  menu.replaceChildren(
    ...items.map(([label, action]) => {
      const item = button(
        '',
        () => {
          hideMenu();
          return action();
        },
        "",
      );
      item.append(document.createTextNode(label));
      item.setAttribute('role', 'menuitem');
      if (menuIcons[label]) item.prepend(iconNode(menuIcons[label]));
      return item;
    }),
  );
  if(header)menu.prepend(el('div','action-menu-time',header));
  menu.hidden = false;
  const box = position?{left:position.x,right:position.x,top:position.y,bottom:position.y}:anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(innerWidth - menu.offsetWidth - 12, box.right - menu.offsetWidth))}px`;
  const below = box.bottom + 6;
  const openBelow=below+menu.offsetHeight<innerHeight-12;
  menu.style.setProperty('--surface-origin',openBelow?'right top':'right bottom');
  menu.style.setProperty('--surface-offset',openBelow?'6px':'-6px');
  menu.style.top = `${Math.max(12, below + menu.offsetHeight < innerHeight - 12 ? below : box.top - menu.offsetHeight - 6)}px`;
  menu.onkeydown = event => {
    const options = [...menu.querySelectorAll('button')], index = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {event.stopPropagation();hideMenu();anchor.focus();}
  };
  menu.querySelector('button')?.focus({preventScroll:true});
}
async function askText(title, value, maxLength = 160, onSave = null) {
  const generation=state.generation;
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
  const error = el("p", "error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  actions.append(cancel, save);
  form.append(heading, input, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
  return new Promise((resolve) => {
    let saving=false;
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.onclick = () => {if(!saving)finish(null);};
    dialog.oncancel = (event) => {
      event.preventDefault();
      if(!saving)finish(null);
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if(saving)return;
      const value=input.value.trim();
      if(!value){error.textContent='请输入内容';error.hidden=false;input.focus();return;}
      saving=true;input.disabled=true;save.disabled=true;cancel.disabled=true;save.textContent='保存中…';error.hidden=true;
      try{
        if(generation!==state.generation)throw new Error('连接已改变，请复制内容后重新打开窗口');
        if(onSave)await onSave(value);
        finish(value);
      }catch(reason){error.textContent=errorMessage(reason);error.hidden=false;}
      finally{
        saving=false;input.disabled=false;save.disabled=false;cancel.disabled=false;save.textContent='保存';
        if(dialog.isConnected)input.focus();
      }
    };
  });
}
async function renameThread() {
  return renameSelectedThread(activeThread());
}
async function renameSelectedThread(thread) {
  if (!thread) return;
  const generation=state.generation;
  const title = await askText("重命名会话", thread.title, 160, async title=>{
    await api(`/api/threads/${encodeURIComponent(thread.id)}`, {method:"PATCH",body:{title}});
    if(generation!==state.generation)return;
    state.threads=state.threads.map(row=>row.id===thread.id?{...row,title}:row);
    renderThreads();renderConversation();
  });
  if (!title||generation!==state.generation) return;
  try{await refreshThreads();}
  catch(error){toast('名称已保存，列表刷新失败：'+errorMessage(error),true);}
}
const archivingSubagents=new Set();
async function archiveSubagent(thread){
  if(!thread?.subagent||archivingSubagents.has(thread.id))return;
  if(subagentRunning(thread)){
    toast('子代理仍在运行，请先进入该子代理并停止，再关闭',true);return;
  }
  const generation=state.generation;
  archivingSubagents.add(thread.id);
  try{
    await api(`/api/threads/${encodeURIComponent(thread.id)}/archive`,{method:'POST',body:{}});
    if(generation!==state.generation)return;
    state.threadListRequest=(state.threadListRequest||0)+1;
    const parent=conversationParent(state.threads,thread.id);
    state.threads=state.threads.filter(row=>row.id!==thread.id);
    if(state.threadId===thread.id){
      if(parent)await openThread(parent);
      else{setConversationSelection();restoreDraft();}
    }
    renderThreads();renderConversation();updateControls();
    await refreshThreads();
  }finally{archivingSubagents.delete(thread.id);}
}
async function deleteThread() {
  return deleteSelectedThread(activeThread());
}
const deletingThreads=new Set();
async function deleteSelectedThread(thread) {
  if (!thread) return;
  const generation=state.generation,key=JSON.stringify([generation,thread.id]);
  if(deletingThreads.has(key))return;
  deletingThreads.add(key);
  try{
  if (
    !(await confirmAction(
      "移除会话？",
      `将从控制台移除「${thread.title}」及其控制台消息记录。`,
    ))
  )
    return;
  if(generation!==state.generation)return;
  await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
    method: "DELETE",
  });
  if(generation!==state.generation)return;
  state.threadListRequest=(state.threadListRequest||0)+1;
  state.events.delete(thread.id);
  state.threads=state.threads.filter(row=>row.id!==thread.id);
  if(state.threadId===thread.id){setConversationSelection();restoreDraft();renderConversation();}
  renderThreads();updateControls();
  try{await refreshThreads();}
  catch(error){if(generation===state.generation)toast('会话已移除，列表刷新失败：'+errorMessage(error),true);}
  }catch(error){if(generation===state.generation)throw error;}
  finally{deletingThreads.delete(key);}
}
const pinningThreads=new Set();
async function setThreadPinned(thread){
  const generation=state.generation,key=JSON.stringify([generation,thread.id]);
  if(pinningThreads.has(key))return;
  pinningThreads.add(key);
  const pinned=(thread.pinnedIndex??-1)<0;
  try{
    await api(`/api/threads/${encodeURIComponent(thread.id)}/pin`,{method:'POST',body:{pinned}});
    if(generation!==state.generation)return;
    state.threadListRequest=(state.threadListRequest||0)+1;
    const position=Math.max(0,...state.threads.map(row=>Number(row.pinnedIndex)||0))+1;
    state.threads=state.threads.map(row=>row.id===thread.id?{...row,pinnedIndex:pinned?(row.pinnedIndex||position):null}:row);
    renderThreads();
    try{await refreshThreads();}
    catch(error){if(generation===state.generation)toast((pinned?'已置顶':'已取消置顶')+'，列表刷新失败：'+errorMessage(error),true);}
  }catch(error){if(generation===state.generation)throw error;}
  finally{pinningThreads.delete(key);}
}
function showThreadMenu(anchor,thread){
  if(thread.source==="cloudCodex"){showMenu(anchor,[["打开会话",()=>openThread(thread)]]);return;}if(thread.readOnly){showMenu(anchor,[["打开快照",()=>openThread(thread)],["导入更新快照",showCloudSnapshotImport]]);return;}
  showMenu(anchor,threadManagementItems(thread));
}
function threadManagementItems(thread){
  if(!thread||thread.readOnly||thread.source==='cloudCodex')return [];
  return [
    ...((harnessForThread(thread.id)==='codex'||state.capabilities.includes('harness-thread-pins')) ? [[(thread.pinnedIndex??-1)>=0?'取消置顶':'置顶',()=>setThreadPinned(thread)]] : []),
    ...(harnessForThread(thread.id)==='codex' ? [['移动到项目或分区',()=>moveSelectedThread(thread)]] : []),
    ['标记未读',()=>markThreadUnread(thread)],
    ['复制会话 ID',()=>copy(thread.id)],
    ['重命名',()=>renameSelectedThread(thread)],
    [thread.subagent?'关闭子代理':'归档会话',()=>thread.subagent?archiveSubagent(thread):archiveSelectedThread(thread)],
    ['移除会话',()=>deleteSelectedThread(thread)],
  ];
}
async function markThreadUnread(thread){
  const generation=state.generation;
  unreadChanges.set(thread.id,(unreadChanges.get(thread.id)||0)+1);
  const result=await api(`/api/threads/${encodeURIComponent(thread.id)}/unread`,{method:'POST',body:{}});
  if(generation!==state.generation)return;
  state.threadListRequest=(state.threadListRequest||0)+1;
  state.threads=state.threads.map(row=>row.id===thread.id?{...row,unread:true,completedAt:result.completedAt??row.completedAt}:row);
  renderThreads();toast('已标记未读');
}
async function archiveSelectedThread(thread){
  if(thread.status==='running'||thread.goal?.status==='active'){toast('会话仍在运行，请先停止再归档',true);return;}
  const generation=state.generation;
  await api(`/api/threads/${encodeURIComponent(thread.id)}/archive`,{method:'POST',body:{}});
  if(generation!==state.generation)return;
  state.threadListRequest=(state.threadListRequest||0)+1;
  if(state.threadId===thread.id){storeDraft();setConversationSelection();restoreDraft();}
  state.threads=state.threads.filter(row=>row.id!==thread.id);
  renderThreads();renderConversation();updateControls();toast('已归档，可在已归档会话中恢复');
}
function threadManagementDialog(title){
  const dialog=el('dialog','output-modal thread-management-dialog'),heading=el('div','output-heading'),body=el('div','output-body');
  heading.append(el('h2',null,title),button('关闭',()=>dialog.close()));
  dialog.append(heading,body);document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  return {dialog,body};
}
async function moveSelectedThread(thread){
  const generation=state.generation,{dialog,body}=threadManagementDialog('移动会话');
  let moving=false;
  const move=async payload=>{
    if(moving)return;
    if(generation!==state.generation)throw new Error('连接已改变，请重新打开窗口');
    moving=true;
    try{
      await api(`/api/threads/${encodeURIComponent(thread.id)}/move`,{method:'POST',body:payload});
      if(generation!==state.generation)return;
      dialog.close();
      try{await refreshThreads();toast('会话已移动');}
      catch(error){toast('会话已移动，列表刷新失败：'+errorMessage(error),true);}
    }finally{moving=false;}
  };
  body.append(el('h3',null,'项目'));
  for(const project of state.projects)body.append(button(project.name,()=>move({projectPath:project.path}),'thread-management-choice'));
  if(!state.projects.length)body.append(el('p',null,'请先在侧栏添加项目'));
  body.append(el('h3',null,'分区'));
  const sections=el('div');body.append(sections);
  sections.textContent='正在加载分区…';
  try{
    const result=await api('/api/thread-sections');
    if(generation!==state.generation||!dialog.isConnected)return;
    sections.replaceChildren(button('默认分区',()=>move({sectionId:null}),'thread-management-choice'),...(result.sections||[]).map(section=>button(section.name,()=>move({sectionId:section.id}),'thread-management-choice')));
  }catch(error){if(dialog.isConnected)sections.textContent='无法加载分区：'+errorMessage(error);}
}
async function showArchivedThreads(){
  const generation=state.generation,{dialog,body}=threadManagementDialog('已归档会话');
  body.textContent='正在加载…';
  let threads;
  try{({threads}=await api('/api/threads/archived'));}
  catch(error){if(dialog.isConnected)body.textContent='无法加载归档会话：'+errorMessage(error);return;}
  if(generation!==state.generation||!dialog.isConnected)return;
  body.replaceChildren();
  const archived=(threads||[]).filter(thread=>harnessForThread(thread.id)===state.harness);
  if(!archived.length)body.append(el('p',null,'暂无已归档会话'));
  for(const thread of archived){
    const row=el('div','archived-thread-row'),label=el('div','archived-thread-label');
    label.append(el('strong',null,displayThreadTitle(thread.title)),el('small',null,displayPath(thread.projectPath)||thread.id));
    row.append(label,button('恢复',async()=>{
      if(generation!==state.generation)throw new Error('连接已改变，请重新打开窗口');
      await api(`/api/threads/${encodeURIComponent(thread.id)}/unarchive`,{method:'POST',body:{}});
      if(generation!==state.generation)return;
      row.remove();if(!body.children.length)body.append(el('p',null,'暂无已归档会话'));
      try{await refreshThreads();toast('会话已恢复');}
      catch(error){toast('会话已恢复，列表刷新失败：'+errorMessage(error),true);}
    }));body.append(row);
  }
}
function openProjectDialog() {
  if (!onlineRequired()) return;
  showInline("projectError", "");
  openDialog("projectDialog");
  $("projectPath").focus();
}
for (const id of ["openDrawer", "mobileDrawer"]) $(id).onclick = () => openDrawer();
$("railSearch").onclick = () => openDrawer({search:true});
$('sidebarSearchToggle').onclick=()=>openDrawer({search:true});
$('search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('search').value='';$('search').dispatchEvent(new Event('input'));$('sidebarSearchBox').hidden=true;$('sidebarSearchToggle').hidden=false;}});
$("railNewThread").onclick = () => run(newThread);
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
  queueThreadMatches();
};
let threadMatchesTimer=0,threadMatchesSeq=0;
function queueThreadMatches(){
  clearTimeout(threadMatchesTimer);
  threadMatchesSeq++;
  const query=$("search").value.trim();
  $('threadMatchesCount').textContent='';
  $('threadMatches').replaceChildren();
  if(query.length<2){
    $('threadMatchesHeading').hidden=true;
    return;
  }
  $('threadMatchesHeading').hidden=false;
  $('threadMatches').append(el('div','sidebar-empty',state.connected?'正在搜索正文…':'连接后搜索正文。'));
  if(!state.connected)return;
  threadMatchesTimer=setTimeout(()=>{loadThreadMatches(query).catch(()=>{});},250);
}
function snippetWithHits(text,needle){
  const fragment=document.createDocumentFragment();
  const target=(needle||"").trim().toLowerCase();
  const lowered=text.toLowerCase();
  if(!target){fragment.append(text);return fragment;}
  let index=0,found;
  while((found=lowered.indexOf(target,index))!==-1){
    if(found>index)fragment.append(text.slice(index,found));
    const mark=document.createElement("mark");
    mark.className="snippet-hit";
    mark.textContent=text.slice(found,found+target.length);
    fragment.append(mark);
    index=found+target.length;
  }
  if(index<text.length)fragment.append(text.slice(index));
  return fragment;
}
async function loadThreadMatches(query){
  if(!state.connected||query!==$('search').value.trim()||query.length<2)return;
  const seq=++threadMatchesSeq;
  const generation=state.generation,harness=state.harness;
  const current=()=>seq===threadMatchesSeq&&generation===state.generation&&harness===state.harness&&query===$('search').value.trim();
  $('threadMatchesHeading').hidden=false;$('threadMatchesCount').textContent='';
  $('threadMatches').replaceChildren(el('div','sidebar-empty','正在搜索正文…'));
  let data;
  try{data=await api(`/api/threads/search?q=${encodeURIComponent(query)}&agent=${encodeURIComponent(harness)}`,{timeout:8000});}
  catch(error){
    if(current()){
      const message=el('div','sidebar-empty','正文搜索失败：'+errorMessage(error));message.setAttribute('role','status');
      $('threadMatches').replaceChildren(message,button('重试',()=>loadThreadMatches(query),'button secondary compact'));
    }
    return;
  }
  if(!current())return;
  const matches=(data.matches||[]).filter((match)=>harnessForThread(match.threadId)===state.harness);
  $('threadMatchesCount').textContent=matches.length?String(matches.length):'';
  $('threadMatchesHeading').hidden=false;
  const rows=matches.slice(0,12).map((match)=>{
    const row=button(
      '',
      () => {
        threadMatchesSeq++;
        $('threadMatchesHeading').hidden=true;
        $('threadMatches').replaceChildren();
        const thread=state.threads.find((t)=>t.id===match.threadId);
        run(()=>openThread(thread||{id:match.threadId,title:match.title||'会话',projectPath:match.projectPath}));
      },
      'thread-row',
    );
    row.append(
      el('span','thread-indicator'),
      el('span','thread-title',displayThreadTitle(match.title)),
    );
    const snippet=el('div','sidebar-empty');
    snippet.style.padding='2px 0 0';
    snippet.style.fontSize='var(--text-xs)';
    snippet.append(snippetWithHits(match.snippet||'',query));
    row.append(snippet);
    return row;
  });
  $('threadMatches').replaceChildren(...rows);
  if(!rows.length)$('threadMatches').append(el('div','sidebar-empty','未找到匹配的正文。'));
}
$("refreshThreads").onclick = () => run(refreshThreads, $("refreshThreads"));
for (const id of ["addProjectBtn", "welcomeAddProject", "settingsAddProject"])
  $(id).onclick = openProjectDialog;
$('projectCreate').onchange=()=>{
  const creating=$('projectCreate').checked;
  $('projectCreateFields').hidden=!creating;
  $('projectName').required=creating;
  $('projectPath').placeholder=creating?'父目录，例如 F:\\Code':'例如 F:\\Code\\my-project';
  const parents=[...new Set(state.projects.map(p=>p.path.replaceAll('\\','/').replace(/\/[^/]+\/?$/,'')))];
  $('projectParent').replaceChildren(new Option('手动输入路径',''),...parents.map(p=>new Option(p,p)));
};
$('projectParent').onchange=()=>{if($('projectParent').value)$('projectPath').value=$('projectParent').value;};
let projectSubmitting=false;
$('projectDialog').oncancel=event=>{if(projectSubmitting)event.preventDefault();};
async function submitProject(event){
  event.preventDefault();
  if(projectSubmitting)return;
  const generation=state.generation,selection=state.selection;
  projectSubmitting=true;
  const controls=['button','input','select'].flatMap(tag=>[...$('projectForm').querySelectorAll(tag)]).map(node=>[node,node.disabled]);
  for(const [node] of controls)node.disabled=true;
  showInline("projectError", "");
  try {
    const creating=$('projectCreate').checked,name=$('projectName').value.trim();
    if(creating&&(!name||name==='.'||name==='..'||/[\\/:*?"<>|]/.test(name)))throw new Error('请输入有效的项目名称');
    const parent=$('projectPath').value.trim();
    if(!parent)throw new Error('请输入项目路径');
    const { project } = await api("/api/projects", {
      method: "POST",
      body: { path:creating?parent.replace(/[\\/]+$/,'')+'/'+name:parent,create:creating },
    });
    if(generation!==state.generation)return;
    state.projectsRequest=(state.projectsRequest||0)+1;
    state.projects=[...state.projects.filter(row=>row.id!==project.id),project];
    state.sidebarProjects=[...(state.sidebarProjects||[]).filter(row=>row.id!==project.id),project];
    renderProjects();
    closeDialog("projectDialog");
    $("projectPath").value = "";
    $('projectCreate').checked=false;
    $('projectCreate').onchange();$('projectName').value='';
    let notice='项目已添加',refreshFailed=false;
    try{await refreshProjects();}
    catch(error){notice+='，列表刷新失败：'+errorMessage(error);refreshFailed=true;}
    if(generation!==state.generation)return;
    if(selection===state.selection){
      try{await selectProject(project);}
      catch(error){toast('项目已添加，切换失败：'+errorMessage(error),true);return;}
    }
    toast(notice,refreshFailed);
  } catch (error) {
    if(generation===state.generation)showInline("projectError", errorMessage(error));
  } finally {
    projectSubmitting=false;for(const [node,disabled] of controls)node.disabled=disabled;
  }
}
$("projectForm").onsubmit=submitProject;
$("prompt").oninput = () => {
  storeDraft({edited:true});
  resizeComposer();
  updateControls();
  renderSlashCommands();
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
  if (isRunning()&&!$('prompt').value.trim()&&!(state.imageDrafts[draftKey()]||[]).length&&!(state.fileDrafts[draftKey()]||[]).length) return stopCurrentTurn();
  return sendPrompt();
});
$('stopBtn').onclick=()=>run(stopCurrentTurn);
$("chatProject").onchange = () => {
  const project = state.projects.find((p) => p.id === $("chatProject").value);
  if (project) run(() => selectProject(project));
  else { storeDraft(); state.chatProject = ''; restoreDraft(); updateControls(); }
};
$("conversationScroll").onscroll = () => {
  const gap=$('conversationScroll').scrollHeight-$('conversationScroll').scrollTop-$('conversationScroll').clientHeight;
  // A programmatic "jump to latest" animates over several frames; while it is
  // in flight the gap is still large, which must not be read as the reader
  // scrolling away (their wheel/touch handlers cancel the flag themselves).
  if(jumpScrolling){
    if(gap<8||performance.now()>jumpScrollingUntil){jumpScrolling=false;followConversation=true;readingAnchor=null;}
    else {$("jumpLatest").hidden=true;return;}
  }
  // Resizing a streamed block can emit scroll without the reader moving it.
  if(performance.now()<userScrollUntil){
    if(gap>=8)followConversation=false;
    else {followConversation=true;readingAnchor=null;}
  }
  if(!followConversation)rememberReadingAnchor();
  $("jumpLatest").hidden =
    $("welcome").hidden === false ||
    gap<8;
};
$('loadOlder').onclick=()=>run(loadOlderMessages);
$('historyRetry').onclick=()=>run(retryConversationHistory);
function beginConversationReview({keepFollowing=false}={}) {
  cancelAnimationFrame(followFrame);followFrame=0;
  if(jumpScrolling){const scroll=$('conversationScroll');scroll.scrollTo({top:scroll.scrollTop,behavior:'instant'});}
  jumpScrolling=false;jumpScrollingUntil=0;
  userScrollUntil=performance.now()+1500;
  followConversation=keepFollowing;
  if(keepFollowing)readingAnchor=null;else rememberReadingAnchor();
}
function atLatestPosition(){const scroll=$('conversationScroll');return scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<8;}
$('conversationScroll').addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
  if(event.target.closest('input,textarea,select,button,a,[contenteditable],[role="slider"]'))return;
  if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;
  if(event.key===' '&&event.target.closest('summary'))return;
  const forward=['ArrowDown','PageDown','End'].includes(event.key)||(event.key===' '&&!event.shiftKey);
  beginConversationReview({keepFollowing:forward&&atLatestPosition()});
});

$('conversationScroll').addEventListener('wheel',event=>{if(!event.deltaY)return;beginConversationReview({keepFollowing:event.deltaY>0&&atLatestPosition()});if(event.deltaY<0&&$('conversationScroll').scrollTop<100)run(loadOlderMessages);},{passive:true});
$('conversationScroll').addEventListener('pointerdown',event=>{if(event.clientX>=$('conversationScroll').getBoundingClientRect().right-24)beginConversationReview({keepFollowing:atLatestPosition()});},{passive:true});
$('events').addEventListener('click',event=>{
  const summary=event.target.closest('summary');
  if(summary&&!summary.parentElement.open){followConversation=false;rememberReadingAnchor();}
});
mountConversationMessageMenu();
let touchY=0,touchX=0;
$('conversationScroll').addEventListener('touchstart',event=>{touchY=event.touches[0]?.clientY || 0;touchX=event.touches[0]?.clientX || 0;},{passive:true});
$('conversationScroll').addEventListener('touchmove',event=>{const dx=(event.touches[0]?.clientX||0)-touchX,dy=(event.touches[0]?.clientY||0)-touchY;if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){beginConversationReview({keepFollowing:dy<0&&atLatestPosition()});if(dy>0&&$('conversationScroll').scrollTop<100)run(loadOlderMessages);}},{passive:true});
$("jumpLatest").onclick = () => {
  cancelAnimationFrame(followFrame);followFrame=0;
  followConversation=true;readingAnchor=null;userScrollUntil=0;
  jumpScrolling=true;jumpScrollingUntil=performance.now()+2500;
  $("jumpLatest").hidden=true;
  // One application-owned frame chain tracks the current height while streaming.
  // Manual input cancels it instead of racing a fixed native smooth-scroll target.
  followLatestPosition();
};
$("threadGoal").onclick = () => {
  const open=$('goalDetails').hidden;
  $('goalDetails').hidden=!open;
  $('threadGoal').setAttribute('aria-expanded',String(open));
};
$('editGoal').onclick=()=>run(async()=>{
  const thread=activeThread();if(!thread?.goal)return;
  if(changingGoals.has(thread.id))return;
  const generation=state.generation;
  await askText('编辑目标',thread.goal.objective,200000,async objective=>{
    if(objective===thread.goal.objective)return;
    if(changingGoals.has(thread.id))throw new Error('目标操作尚未完成，请稍后保存');
    changingGoals.add(thread.id);updateGoalControls();
    try{
    const result=await api(`/api/threads/${encodeURIComponent(thread.id)}/goal`,{method:'PATCH',body:{objective}});
    if(!result.goal)throw new Error('电脑未返回目标状态，输入已保留');
    if(generation!==state.generation)return;
    state.threads=state.threads.map(row=>row.id===thread.id?{...row,goal:{...row.goal,...result.goal}}:row);renderConversation();
    }finally{changingGoals.delete(thread.id);updateGoalControls();}
  });
});
async function changeGoalStatus(complete=false){
  const thread=activeThread();if(!thread?.goal)return;
  if(changingGoals.has(thread.id))return;
  const status=complete?'complete':thread.goal.status==='paused'?'active':'paused';
  if(!complete&&(!['active','paused'].includes(thread.goal.status)||status==='active'&&isRunning()))return;
  const generation=state.generation;
  changingGoals.add(thread.id);updateGoalControls();
  try{
    const result=status==='active'
      ?await api(`/api/threads/${encodeURIComponent(thread.id)}/goal/continue`,{method:'POST',body:{requestId:requestId(),model:$('chatModel').value,effort:$('chatEffort').value||undefined,permission:safeRead('cmc.permission')||'full',...slashOptions()}})
      :await api(`/api/threads/${encodeURIComponent(thread.id)}/goal`,{method:'PATCH',body:{status}});
    if(generation!==state.generation)return;
    if(status==='paused'&&!result.goal)throw new Error('电脑未返回目标状态，请刷新会话确认');
    state.threads=state.threads.map(row=>row.id===thread.id?{...row,goal:complete?null:{...row.goal,...result.goal}}:row);
    renderConversation();
    try{await refreshThreads();}
    catch(error){if(generation===state.generation)toast('目标操作已提交，列表刷新失败：'+errorMessage(error),true);}
  }catch(error){if(generation===state.generation)throw error;}
  finally{changingGoals.delete(thread.id);updateGoalControls();}
}
$('toggleGoal').onclick=()=>run(()=>changeGoalStatus());
const closeGoal=()=>run(()=>changeGoalStatus(true));
$('closeGoal').onclick=closeGoal;
async function openProjectFiles(){
  const generation=state.generation,selection=state.selection,project=state.chatProject;
  if(state.fileProject!==project){
    if(!await allowFileLeave())return;
    if(generation!==state.generation||selection!==state.selection||project!==state.chatProject)return;
    state.fileProject=project;state.filePath='';resetFile();
  }
  $('filesProject').value=state.fileProject;
  showPage('files');
}
$("threadMenuBtn").onclick = () =>
  showMenu($("threadMenuBtn"), activeThread()?.readOnly?[["导入更新快照",showCloudSnapshotImport],["新会话",newThread]]:[
    ["导入云端快照",showCloudSnapshotImport],
    ...(state.threadId?[
      ['本会话用量',showUsage],
      ['本会话定时任务',()=>showAutomations(undefined,{threadId:state.threadId})],
    ]:[]),
    ['工作区文件',openProjectFiles],
    ...threadManagementItems(activeThread()),
    ["新会话", newThread],
    [state.showWarnings ? '隐藏运行提示' : '显示运行提示', () => {
      state.showWarnings = !state.showWarnings;
      safeWrite('cmc.showWarnings', String(state.showWarnings));
      renderConversation();
    }],
  ]);
$('archivedThreadsBtn').onclick=()=>run(showArchivedThreads);
$("composerTools").onclick = () =>
  showMenu($("composerTools"), [
    ['图片或视频',()=>$('imageInput').click()],
    ['文件',()=>$('fileInput').click()],
    ["新会话", newThread],
    ["当前项目文件",openProjectFiles],
    [
      "再次使用上一条",
      () => {
        const previous = (state.events.get(state.threadId) || [])
          .filter((e) => e.type === "user.message")
          .slice(-1)[0];
        if (previous) {
          if(state.uploading){toast('文件上传完成后再使用历史消息');return;}
          const key=draftKey(),current=$('prompt').value;
          const images=[...new Map([...(previous.images||[]),...(state.imageDrafts[key]||[])].map(item=>[item.id,item])).values()];
          const files=[...new Map([...(previous.files||[]),...(state.fileDrafts[key]||[])].map(item=>[item.id,item])).values()];
          if(files.length>8){toast('文件附件已满，请先移除部分文件再使用历史消息');return;}
          const text=previous.text||'',alreadyIncluded=current.trim()===text.trim()||text.trim()&&current.startsWith(text+'\n\n');
          $('prompt').value=alreadyIncluded?current:[text,current].filter(value=>value?.trim()).join('\n\n');
          state.imageDrafts[key]=images;saveImageDrafts();renderImageDrafts();
          state.fileDrafts[key]=files;saveFileDrafts();renderFileDrafts();
          storeDraft({edited:true});
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
$('desktopNotify').checked=safeRead('cmc.desktopNotify')==='on';
$('desktopNotify').onchange=()=>{
  if($('desktopNotify').checked&&'Notification' in window&&Notification.permission==='default'){
    Notification.requestPermission().then((result)=>{
      if(result!=='granted'){$('desktopNotify').checked=false;safeWrite('cmc.desktopNotify','off');closeDesktopNotifications();}
    });
  }
  safeWrite('cmc.desktopNotify',$('desktopNotify').checked?'on':'off');
  if(!$('desktopNotify').checked)closeDesktopNotifications();
};
$("pairStartBtn").onclick = () => openManagement('access');
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
  if ((event.ctrlKey || event.metaKey) && event.key === "/") {
    event.preventDefault();
    showShortcutsHelp();
  }
  if (event.key === "?" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    showShortcutsHelp();
  }
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    event.preventDefault();
    openDrawer({search:true});
  }
});
function showShortcutsHelp() {
  const dialog = el('dialog', 'modal shortcuts-dialog');
  dialog.setAttribute('aria-label', '键盘快捷键');
  const heading = el('div', 'modal-heading');
  const close = button('', () => dialog.close(), 'icon-button');
  close.append(iconNode('close'));
  close.setAttribute('aria-label', '关闭');
  heading.replaceChildren(el('h2', null, '键盘快捷键'), close);
  const list = el('div', 'shortcut-list');
  for (const [keys, desc] of [
    ['Ctrl K', '新会话'],
    ['Ctrl S', '保存文件（文件页）'],
    ['/', '搜索项目与会话'],
    ['Esc', '关闭弹层与抽屉'],
    ['Shift /', '显示本帮助'],
  ]) {
    const row = el('div', 'shortcut-row');
    row.append(el('kbd', 'shortcut-keys', keys), el('span', null, desc));
    list.append(row);
  }
  dialog.append(heading, list);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
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
  scheduleDesktopRefresh(0);
  if(!document.hidden)closeDesktopNotifications();
  else if($('taskNotice')){$('taskNotice').hidden=true;clearTimeout(taskNoticeTimer);}
  if(!document.hidden)scheduleSessionUsage(300);else{clearTimeout(sessionUsageTimer);sessionUsageTimer=null;}
  if(!document.hidden){updateGoalRuntime();if(state.connected&&state.page==='terminal'){clearTimeout(terminalTimer);terminalTimer=null;void refreshTerminals({quiet:true});}}
});
window.addEventListener('storage',event=>{
  if(!event.key?.startsWith('cmc.messageEdit.'))return;
  messageEditRecords.delete(event.key.slice('cmc.messageEdit.'.length));updateMessageEditNotice();
});
restoreDraft();
renderProjects();
renderConversation();
updateConnection();
renderImageDrafts();
setInterval(()=>{if(!document.hidden)updateGoalRuntime();},1000);
let refreshingDesktop=false,desktopRefreshTimer=null;
function scheduleDesktopRefresh(delay=(isRunning()||state.pending||state.queueSubmitting?2500:10000)){
  clearTimeout(desktopRefreshTimer);desktopRefreshTimer=null;
  if(document.hidden||!state.connected)return;
  desktopRefreshTimer=setTimeout(refreshDesktop,delay);
}
async function refreshDesktop(){
  desktopRefreshTimer=null;
  if(document.hidden||!state.connected)return;
  if(refreshingDesktop){scheduleDesktopRefresh(2500);return;}
  refreshingDesktop=true;
  try {
    const reads=[refreshThreads({changed:false}),refreshProjects({changed:false})];
    if(state.threadId&&state.page==='chat'&&!state.historyErrors.has(state.threadId)&&!state.historyLoading.has(state.threadId))reads.push(loadThread(state.threadId));
    await Promise.allSettled(reads);
  }
  catch { /* A background refresh can be interrupted by navigation or reconnect; keep the last snapshot and retry next tick. */ }
  finally {refreshingDesktop=false;scheduleDesktopRefresh();}
}
const desktopPair=new URLSearchParams(location.hash.slice(1)).get('desktopPair');
if(desktopPair) {
  history.replaceState(null,'',location.pathname+location.search);
  run(async()=>{
    const result=await api('/api/pair/claim',{method:'POST',token:'',body:{code:desktopPair,name:'电脑控制台'}});
    await connect(result.token);
    location.assign('/manage/#access');
  });
} else if (state.token)
  connect().catch((error) => {
    toast(errorMessage(error), true);
    if (error.status !== 401) scheduleReconnect();
  });


const questionDrafts=new Map();
const approvalFeedback=new Map();
function approvalKey(event){return JSON.stringify([event.threadId||state.threadId,event.approvalId]);}
function applyApprovalResult(id,threadId,status){
  const prior=state.approvals.find(a=>a.id===id);
  state.approvals=[...state.approvals.filter(a=>a.id!==id),{...prior,id,threadId,status}];
  queueRender();
}
function approvalCard(event){
  const node=el('div','activity-block approval-block');
  const threadId=event.threadId||state.threadId,key=approvalKey(event);
  const approval=state.approvals.find(a=>a.id===event.approvalId),resolved=approval&&approval.status!=='pending';
  if(resolved)approvalFeedback.delete(key);else node.classList.add('approval-pending');
  node.append(el('h3',null,resolved?(approval.status==='accepted'?'已允许':approval.status==='expired'?'请求已失效':'已拒绝'):(event.approvalType==='desktop'?'电脑端权限请求':'需要你的确认')),el('div',null,event.title));
  if(event.detail)node.append(el('pre',null,event.detail));
  if(!resolved&&event.approvalId){
    const row=el('div','button-row'),status=el('p'),errorNode=el('p','error');
    status.setAttribute('role','status');errorNode.setAttribute('role','alert');
    const update=()=>{
      const feedback=approvalFeedback.get(key),pending=Boolean(feedback?.pending);
      const handled=state.approvals.some(a=>a.id===event.approvalId&&a.status!=='pending');
      allow.disabled=deny.disabled=pending||handled;
      status.textContent=pending?(feedback.decision==='accept'?'正在允许…':'正在拒绝…'):'';status.hidden=!pending;
      errorNode.textContent=feedback?.error||'';errorNode.hidden=!errorNode.textContent;
    };
    const act=async decision=>{const task=resolveApproval(event.approvalId,decision,threadId);update();await task;update();};
    const allow=button('允许',()=>act('accept'),'button compact'),deny=button('拒绝',()=>act('decline'),'button secondary compact');
    row.append(allow,deny);node.append(status,errorNode,row);update();
  }
  return node;
}
function questionCard(event){
  const node=el('div','activity-block question-block');
  const threadId=event.threadId||state.threadId,key=approvalKey(event);
  const approval=state.approvals.find(a=>a.id===event.approvalId);
  const resolved=approval&&approval.status!=='pending';
  node.append(el('h3',null,resolved?(['accepted','answered'].includes(approval.status)?'已回答':'问题已失效'):'需要你的回答'));
  let questions=[];try{questions=JSON.parse(event.detail||'{}').questions||[];}catch{}
  if(resolved){questionDrafts.delete(key);approvalFeedback.delete(key);for(const q of questions)node.append(el('p',null,q.question));return node;}
  const draft=questionDrafts.get(key)||{};questionDrafts.set(key,draft);
  const form=el('form','question-form'),fields=[];
  const submit=el('button','button compact','提交回答');submit.type='submit';
  const errorNode=el('p','error');errorNode.setAttribute('role','alert');
  const update=()=>{
    const feedback=approvalFeedback.get(key),pending=Boolean(feedback?.pending);
    submit.disabled=pending||!questions.length||questions.some(q=>!draft[q.id]?.trim());
    submit.textContent=pending?'提交中…':'提交回答';
    for(const field of fields)field.disabled=pending;
    errorNode.textContent=feedback?.error||'';errorNode.hidden=!errorNode.textContent;
  };
  for(const q of questions){
    const field=el('fieldset');fields.push(field);field.append(el('legend',null,q.question));
    const input=el('input');input.type=q.isSecret?'password':'text';input.autocomplete='off';input.placeholder='输入你的回答';input.setAttribute('aria-label',q.question);input.value=draft[q.id]||'';
    for(const option of q.options||[]){const choice=el('button','button secondary question-choice',option.label+(option.description?' — '+option.description:''));choice.type='button';choice.setAttribute('aria-pressed',String(draft[q.id]===option.label));choice.onclick=()=>{draft[q.id]=option.label;input.value=option.label;field.querySelectorAll('.question-choice').forEach(b=>b.setAttribute('aria-pressed',String(b===choice)));update();};field.append(choice);}
    input.oninput=()=>{draft[q.id]=input.value;field.querySelectorAll('.question-choice').forEach(b=>b.setAttribute('aria-pressed','false'));update();};field.append(input);form.append(field);
  }
  form.append(errorNode,submit);update();
  form.onsubmit=async e=>{
    e.preventDefault();
    if(state.threadId!==threadId||approvalFeedback.get(key)?.pending||!questions.length||questions.some(q=>!draft[q.id]?.trim()))return;
    const generation=state.generation,current=()=>state.threadId===threadId&&state.generation===generation;
    const answers=Object.fromEntries(questions.map(q=>[q.id,{answers:[draft[q.id]]}]));
    approvalFeedback.set(key,{pending:true,error:''});update();queueRender();
    try{await api('/api/approvals/'+encodeURIComponent(event.approvalId)+'/answer',{method:'POST',body:{threadId,answers}});}
    catch(error){approvalFeedback.set(key,{pending:false,error:error.message||'提交失败，请重试'});update();if(current())queueRender();return;}
    questionDrafts.delete(key);approvalFeedback.delete(key);
    if(!current())return;
    applyApprovalResult(event.approvalId,threadId,'accepted');
    try{await refreshApprovals();}catch(error){if(current())toast('回答已提交，状态刷新失败：'+error.message);}
  };
  node.append(form);return node;
}
