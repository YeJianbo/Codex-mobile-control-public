import { marked } from "./marked.js";
import "./compat.js";
import { mathExtension, renderMath } from "./math.js";
marked.use({ extensions: [mathExtension] });
import DOMPurify from "./purify.js";
import { localFilePath, resolveFileLink, renderPdf } from "./file-links.js";
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
  errorMessage
} from "./console-core.js";
const $ = (id) => document.getElementById(id);
const icons = {
  info: "M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  compose: "M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l-1 4 4-1L22 8l-5-5-7 11Z",
  panel: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 3v18",
  copy: "M9 9h12v12H9V9ZM5 15H3V3h12v2",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  save: "M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7",
  image: "M3 3h18v18H3V3Zm0 14 6-6 5 5 3-3 4 4M15 7h.01",
  code: "m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8z",
  folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18",
  terminal: "m5 7 5 5-5 5m8 0h6",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
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
  file: "M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6",
  stop: "M6 6h12v12H6V6Z",
  shield: "m12 3 9 4v5c0 6-9 10-9 10S3 18 3 12V7l9-4Zm-4 9 3 3 5-6",
  lock: "M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4",
  devices: "M4 3h12v14H4V3Zm12 6h5v13h-8v-5M7 13h2",
  "wifi-off": "m2 2 20 20M8 16a6 6 0 0 1 8 0m-4 4h.01M4 12a12 12 0 0 1 4-2m5 0a12 12 0 0 1 7 2M1 7a19 19 0 0 1 2-1m5-2a20 20 0 0 1 15 3"
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] ?? icons.file}"/></svg>`;
}
function mountIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el2) => el2.innerHTML = icon(el2.dataset.icon));
}
mountIcons();
for (const [id, name] of Object.entries({ saveFileBtn: "save", saveSettingsBtn: "save", newTerminalBtn: "plus", stopTerminalBtn: "stop", refreshPair: "refresh", reconnectBtn: "refresh" })) {
  const node = $(id);
  if (!node) continue;
  const label = node.textContent.trim() || node.getAttribute("aria-label");
  node.title = label;
  node.setAttribute("aria-label", label);
  node.innerHTML = icon(name);
  node.classList.add("glyph-action");
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
  const symbol = { "\u590D\u5236": "copy", "\u4E0B\u8F7D": "download", "\u5173\u95ED": "close", "\u5237\u65B0": "refresh", "\u4FDD\u5B58": "save", "\u79FB\u9664": "close" }[label];
  if (symbol) {
    node.innerHTML = icon(symbol);
    node.classList.add("glyph-action");
    node.title = label;
    node.setAttribute("aria-label", label);
  }
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
  }
}
const collapsedSections = (() => {
  try {
    return JSON.parse(safeRead("cmc.sidebarCollapsed") || "{}");
  } catch {
    return {};
  }
})();
function updateSidebarScrollbar() {
  const scroller = document.querySelector(".sidebar-scroll"), rail = $("sidebarScrollbar"), thumb = $("sidebarThumb");
  const height = scroller.clientHeight, max = scroller.scrollHeight - height;
  rail.hidden = max <= 1;
  rail.style.top = scroller.offsetTop + "px";
  rail.style.height = height + "px";
  const size = Math.min(height, Math.max(28, height * height / Math.max(scroller.scrollHeight, 1)));
  thumb.style.height = size + "px";
  thumb.style.transform = `translateY(${max > 0 ? scroller.scrollTop / max * (height - size) : 0}px)`;
}
function applySidebarSections() {
  const searching = Boolean($("search").value.trim());
  document.querySelectorAll("[data-collapse]").forEach((button2) => {
    const target = $(button2.dataset.collapse), open = searching || !collapsedSections[target.id];
    target.hidden = !open;
    button2.setAttribute("aria-expanded", String(open));
    button2.querySelector(".section-count").textContent = target.querySelectorAll(".thread-row,.project-row").length || "";
  });
  requestAnimationFrame(updateSidebarScrollbar);
}
document.querySelectorAll("[data-collapse]").forEach((button2) => {
  button2.onclick = () => {
    const id = button2.dataset.collapse;
    collapsedSections[id] = !collapsedSections[id];
    safeWrite("cmc.sidebarCollapsed", JSON.stringify(collapsedSections));
    applySidebarSections();
  };
});
const sidebarScroller = document.querySelector(".sidebar-scroll");
sidebarScroller.addEventListener("scroll", updateSidebarScrollbar, { passive: true });
new ResizeObserver(updateSidebarScrollbar).observe(sidebarScroller);
let thumbDrag = null;
$("sidebarThumb").onpointerdown = (event) => {
  event.preventDefault();
  thumbDrag = { y: event.clientY, top: sidebarScroller.scrollTop };
  event.currentTarget.setPointerCapture(event.pointerId);
};
$("sidebarThumb").onpointermove = (event) => {
  if (!thumbDrag) return;
  const travel = sidebarScroller.clientHeight - $("sidebarThumb").offsetHeight;
  sidebarScroller.scrollTop = thumbDrag.top + (event.clientY - thumbDrag.y) * (sidebarScroller.scrollHeight - sidebarScroller.clientHeight) / Math.max(travel, 1);
};
$("sidebarThumb").onpointerup = $("sidebarThumb").onpointercancel = () => {
  thumbDrag = null;
};
$("sidebarScrollbar").onpointerdown = (event) => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  sidebarScroller.scrollTop = (event.clientY - rect.top) / rect.height * sidebarScroller.scrollHeight - sidebarScroller.clientHeight / 2;
};
function readDrafts() {
  try {
    return JSON.parse(safeRead("cmc.drafts") || "{}");
  } catch {
    return {};
  }
}
const state = {
  imageDrafts: (() => {
    try {
      return JSON.parse(safeRead("cmc.imageDrafts") || "{}");
    } catch {
      return {};
    }
  })(),
  uploading: 0,
  models: [],
  showWarnings: safeRead("cmc.showWarnings") === "true",
  sidebarProjects: [],
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
  events: /* @__PURE__ */ new Map(),
  hydrating: /* @__PURE__ */ new Map(),
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
  terminalRequest: 0
};
const pageNames = {
  chat: "\u5DE5\u4F5C\u533A",
  files: "\u6587\u4EF6\u4E0E\u6539\u52A8",
  terminal: "\u7EC8\u7AEF",
  preview: "\u6D4F\u89C8\u5668\u9884\u89C8",
  settings: "\u8BBE\u7F6E"
};
let toastTimer, renderQueued = false, refreshTimer, terminalTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = `toast${error ? " error" : ""}`;
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => $("toast").hidden = true,
    error ? 6500 : 3500
  );
}
async function run(fn, control) {
  if (control == null ? void 0 : control.disabled) return;
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
async function api(path, { method = "GET", body, token = state.token, timeout = 2e4, ...rest } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        ...token ? { Authorization: `Bearer ${token}` } : {},
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: controller.signal,
      ...rest
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        response.status === 401 ? "\u8BBF\u95EE\u51ED\u636E\u65E0\u6548\u6216\u5DF2\u64A4\u9500\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002" : data.error || `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`
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
  const label = state.connecting ? "\u8FDE\u63A5\u4E2D" : state.connected ? "\u5DF2\u8FDE\u63A5" : state.reconnectTimer ? "\u91CD\u8FDE\u4E2D" : "\u672A\u8FDE\u63A5";
  $("status").textContent = label;
  $("statusBtn").setAttribute("aria-label", `\u7535\u8111\u8FDE\u63A5 \xB7 ${label}`);
  $("statusBtn").dataset.tooltip = `\u7535\u8111\u8FDE\u63A5 \xB7 ${label}`;
  for (const id of ["statusDot", "sidebarStatusDot"])
    $(id).className = `status-dot ${state.connected ? "online" : state.connecting || state.reconnectTimer ? "connecting" : ""}`;
  $("computerName").textContent = state.connected ? "\u6211\u7684\u7535\u8111" : "\u8FDE\u63A5\u4F60\u7684\u7535\u8111";
  $("computerAddress").textContent = location.host;
  $("connectionBanner").hidden = state.connected || !state.token && !state.connecting || state.manualDisconnect;
  $("connectionBannerText").textContent = state.connecting ? "\u6B63\u5728\u8FDE\u63A5\u7535\u8111\u2026" : "\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u8349\u7A3F\u5DF2\u4FDD\u7559\u3002";
  $("welcomeConnect").hidden = state.connected;
  updateControls();
}
function activeThread() {
  return state.threads.find((thread) => thread.id === state.threadId);
}
function isRunning() {
  var _a;
  return ((_a = activeThread()) == null ? void 0 : _a.status) === "running";
}
function draftKey(threadId = state.threadId, project = state.chatProject) {
  return threadId ? `thread:${threadId}` : `project:${project || "none"}`;
}
function storeDraft() {
  var _a;
  if (((_a = state.pending) == null ? void 0 : _a.key) === draftKey() && !$("prompt").value) return;
  state.drafts[draftKey()] = $("prompt").value;
  safeWrite("cmc.drafts", JSON.stringify(state.drafts));
}
function restoreDraft() {
  $("prompt").value = state.drafts[draftKey()] || "";
  resizeComposer();
  updateControls();
  renderImageDrafts();
}
function attachmentUrl(image) {
  return `/api/uploads/images/${encodeURIComponent(image.id)}?token=${encodeURIComponent(state.token)}`;
}
function imageGallery(images, removable = false) {
  const gallery = el("div", "image-gallery");
  for (const image of images || []) {
    const tile = el("div", "image-tile"), preview = el("img");
    preview.src = attachmentUrl(image);
    preview.alt = image.name;
    preview.loading = "lazy";
    const view = button("", () => {
      const modal = el("dialog", "output-modal"), close = button("\u5173\u95ED", () => modal.close(), "button secondary"), body = el("div", "output-body"), full = el("img");
      full.src = attachmentUrl(image);
      full.alt = image.name;
      body.append(full);
      modal.append(close, body);
      document.body.append(modal);
      modal.onclose = () => modal.remove();
      modal.showModal();
    }, "image-open");
    view.setAttribute("aria-label", `\u67E5\u770B\u56FE\u7247 ${image.name}`);
    view.append(preview);
    tile.append(view);
    if (removable) tile.append(button("\u79FB\u9664", () => {
      state.imageDrafts[draftKey()] = (state.imageDrafts[draftKey()] || []).filter((i) => i.id !== image.id);
      saveImageDrafts();
      renderImageDrafts();
      updateControls();
    }, "image-remove"));
    gallery.append(tile);
  }
  return gallery;
}
function saveImageDrafts() {
  safeWrite("cmc.imageDrafts", JSON.stringify(state.imageDrafts));
}
function renderImageDrafts() {
  const images = state.imageDrafts[draftKey()] || [];
  $("imageDrafts").hidden = !images.length;
  $("imageDrafts").replaceChildren(...imageGallery(images, true).childNodes);
  resizeComposer();
}
async function uploadImages(files) {
  if (!onlineRequired()) return;
  const key = draftKey();
  state.uploading++;
  updateControls();
  $("uploadStatus").hidden = false;
  $("uploadStatus").textContent = "\u6B63\u5728\u4E0A\u4F20\u56FE\u7247\u2026";
  try {
    for (const file of files) {
      if ((state.imageDrafts[key] || []).length >= 8) throw new Error("\u6BCF\u6761\u6D88\u606F\u6700\u591A 8 \u5F20\u56FE\u7247");
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error("\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 5 MB \u7684 PNG\u3001JPEG\u3001GIF \u6216 WebP \u56FE\u7247");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("\u8BFB\u53D6\u56FE\u7247\u5931\u8D25"));
        reader.readAsDataURL(file);
      });
      const image = await api("/api/uploads/images", { method: "POST", body: { dataUrl, name: file.name } });
      state.imageDrafts[key] = [...state.imageDrafts[key] || [], image];
      saveImageDrafts();
      renderImageDrafts();
    }
  } finally {
    state.uploading--;
    $("uploadStatus").hidden = !state.uploading;
    updateControls();
  }
}
$("imageInput").onchange = () => {
  const files = [...$("imageInput").files];
  $("imageInput").value = "";
  run(() => uploadImages(files));
};
$("prompt").addEventListener("paste", (event) => {
  const images = [...event.clipboardData.files].filter((f) => f.type.startsWith("image/"));
  if (images.length) {
    event.preventDefault();
    run(() => uploadImages(images));
  }
});
$("composer").addEventListener("dragover", (event) => {
  event.preventDefault();
});
$("composer").addEventListener("drop", (event) => {
  event.preventDefault();
  run(() => uploadImages([...event.dataTransfer.files]));
});
function resizeComposer() {
  const text = $("prompt").value;
  $("composer").classList.toggle("expanded", text.includes("\n") || text.length > 80 || !$("imageDrafts").hidden);
  $("prompt").style.height = "auto";
  $("prompt").style.height = `${Math.max(26, Math.min(160, $("prompt").scrollHeight))}px`;
}
function updateControls() {
  const running = isRunning();
  const pending = state.pending && (state.pending.threadId === state.threadId || !state.threadId);
  $("sendBtn").innerHTML = pending ? '<span class="submit-spinner" aria-hidden="true"></span>' : icon(running ? "stop" : "arrow-up");
  $("sendBtn").classList.toggle("running", running);
  $("sendBtn").setAttribute("aria-label", running ? "\u505C\u6B62\u4EFB\u52A1" : "\u53D1\u9001\u6D88\u606F");
  $("sendBtn").title = running ? "\u505C\u6B62\u4EFB\u52A1" : "\u53D1\u9001\u6D88\u606F";
  $("sendBtn").disabled = !state.connected || !running && !state.models.length || !running && (Boolean(pending) || state.uploading || !$("prompt").value.trim() && !(state.imageDrafts[draftKey()] || []).length);
  $("chatState").textContent = pending ? "\u6B63\u5728\u63D0\u4EA4\u4EFB\u52A1\u2026" : running ? "Codex \u6B63\u5728\u5DE5\u4F5C" : "";
  $("chatState").hidden = !$("chatState").textContent;
  $("welcomeProjectArea").hidden = !state.connected || Boolean(state.threadId);
  $("saveFileBtn").disabled = !state.connected || !state.opened || !state.opened.editable || !fileDirty();
  $("dirtyIndicator").hidden = !fileDirty();
  $("saveSettingsBtn").disabled = !state.connected || !state.settingsLoaded;
  $("saveRawBtn").disabled = !state.connected || !state.settingsLoaded;
  $("newTerminalBtn").disabled = !state.connected || !state.terminalProject;
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal
  );
  $("stopTerminalBtn").disabled = !state.connected || (record == null ? void 0 : record.status) !== "running";
  $("commandInput").disabled = !state.connected || !state.terminalProject;
  $("commandForm").querySelector("button").disabled = !state.connected || !state.terminalProject;
  $("terminalShortcuts").querySelectorAll("button").forEach(
    (b) => b.disabled = !state.connected || !isInteractive(record) || record.status !== "running"
  );
}
async function connect(token = state.token) {
  var _a;
  const generation = ++state.generation;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.manualDisconnect = false;
  (_a = state.ws) == null ? void 0 : _a.close();
  state.connected = false;
  state.connecting = true;
  state.token = token.trim();
  updateConnection();
  try {
    if (!state.token) throw new Error("\u8BF7\u8F93\u5165\u8BBF\u95EE Token \u6216\u4F7F\u7528\u914D\u5BF9\u7801\u3002");
    const health = await api("/health", { token: "" });
    if (!health.ok || health.protocolVersion < 1 || health.minAndroidProtocolVersion > 1)
      throw new Error("\u5F53\u524D Gateway \u534F\u8BAE\u4E0D\u517C\u5BB9\uFF0C\u8BF7\u66F4\u65B0 Gateway\u3002");
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
      refreshDevices()
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
    wsUrl.searchParams.set("device", "Web \u63A7\u5236\u53F0");
    const ws = new WebSocket(wsUrl);
    state.ws = ws;
    let ready = false;
    const deadline = setTimeout(() => {
      ws.close();
      reject(new Error("\u5B9E\u65F6\u8FDE\u63A5\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002"));
    }, 1e4);
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
            event.code === 1008 ? "\u5B9E\u65F6\u8FDE\u63A5\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u68C0\u67E5\u8BBF\u95EE\u51ED\u636E\u3002" : "\u5B9E\u65F6\u8FDE\u63A5\u672A\u80FD\u5EFA\u7ACB\u3002"
          )
        );
      if (event.code === 1008) {
        state.manualDisconnect = true;
        toast("\u8BBF\u95EE\u51ED\u636E\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002", true);
      }
      if (state.pending) {
        restorePendingDraft();
        renderConversation();
      }
      if (!state.manualDisconnect) scheduleReconnect();
      updateConnection();
    };
    ws.onerror = () => {
    };
  });
}
function scheduleReconnect() {
  if (state.reconnectTimer || state.manualDisconnect || !state.token || !navigator.onLine)
    return;
  const delay = Math.min(1e3 * 2 ** state.reconnectAttempt++, 15e3);
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
  var _a;
  state.manualDisconnect = true;
  state.generation++;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  (_a = state.ws) == null ? void 0 : _a.close();
  state.connected = false;
  state.connecting = false;
  restorePendingDraft();
  state.token = "";
  safeWrite("cmc.token", "");
  updateConnection();
  renderConversation();
}
function sendCommand(command) {
  var _a;
  if (!state.connected || ((_a = state.ws) == null ? void 0 : _a.readyState) !== WebSocket.OPEN)
    throw new Error("\u5B9E\u65F6\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA\u3002");
  state.ws.send(JSON.stringify(command));
}
function receiveEvent(event) {
  var _a, _b, _c, _d, _e, _f, _g;
  if (event.replayed) return;
  const id = event.threadId;
  if (event.type === "error") {
    if (id) {
      state.events.set(id, mergeEvents(state.events.get(id) || [], [event]).slice(-1e4));
      (_a = state.hydrating.get(id)) == null ? void 0 : _a.push(event);
    }
    const matches = !event.requestId || event.requestId === ((_b = state.pending) == null ? void 0 : _b.requestId);
    if (matches && (!id || id === state.threadId)) {
      if (state.pending) restorePendingDraft();
      const thread = activeThread();
      if (thread) thread.status = "error";
      toast(event.message || "\u4EFB\u52A1\u6267\u884C\u5931\u8D25", true);
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
      title: ((_c = event.thread) == null ? void 0 : _c.title) || (old == null ? void 0 : old.title) || "\u65B0\u4F1A\u8BDD",
      projectPath: ((_d = event.thread) == null ? void 0 : _d.projectPath) || (old == null ? void 0 : old.projectPath) || ""
    };
    state.threads = [next, ...state.threads.filter((t) => t.id !== id)];
    if (((_e = state.pending) == null ? void 0 : _e.requestId) === event.requestId && event.requestId) {
      state.pending.threadId = id;
      if (state.selection === state.pending.selection) {
        state.threadId = id;
        state.chatProject = state.pending.project || ((_f = state.projects.find((p) => comparablePath(p.path) === comparablePath(next.projectPath))) == null ? void 0 : _f.id) || "";
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
      mergeEvents(state.events.get(id) || [], [event]).slice(-1e4)
    );
    (_g = state.hydrating.get(id)) == null ? void 0 : _g.push(event);
  }
  if (event.type === "user.message") {
    const thread = state.threads.find((t) => t.id === id);
    if (thread) thread.status = "running";
    const pending = state.pending;
    if (pending && event.text === pending.text && (pending.threadId === id || !pending.threadId)) {
      if (state.drafts[pending.key] === pending.text) {
        delete state.drafts[pending.key];
        safeWrite("cmc.drafts", JSON.stringify(state.drafts));
      }
      if (state.threadId === id && $("prompt").value.trim() === pending.text) {
        $("prompt").value = "";
        resizeComposer();
      }
      state.pending = null;
      state.imageDrafts[pending.key] = (state.imageDrafts[pending.key] || []).filter((i) => !(pending.images || []).some((p) => p.id === i.id));
      saveImageDrafts();
      renderImageDrafts();
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
  if (event.type === "terminal.output" && (id == null ? void 0 : id.startsWith("terminal:"))) {
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
  var _a;
  const { projects } = await api("/api/projects");
  state.projects = projects || [];
  if (state.threadId && !state.chatProject) state.chatProject = ((_a = state.projects.find((p) => {
    var _a2;
    return comparablePath(p.path) === comparablePath((_a2 = activeThread()) == null ? void 0 : _a2.projectPath);
  })) == null ? void 0 : _a.id) || "";
  const sidebar = await api("/api/sidebar");
  state.sidebarProjects = sidebar.projects || state.projects;
  renderProjects();
}
function renderProjects() {
  const query = $("search").value.toLowerCase();
  const visible = (state.sidebarProjects.length ? state.sidebarProjects : state.projects).filter(
    (p) => `${p.name} ${p.path}`.toLowerCase().includes(query)
  );
  $("projects").replaceChildren(
    ...visible.map((project) => {
      const row = button(
        "",
        () => {
          if (project.trusted) return selectProject(project);
          openProjectDialog();
          $("projectPath").value = project.path;
        },
        `project-row${state.chatProject === project.id ? " active" : ""}`
      );
      row.title = project.path;
      if (!project.trusted) row.title += " \xB7 \u70B9\u51FB\u63A5\u5165\u9879\u76EE";
      row.append(
        el("span", "project-letter", project.name.slice(0, 1).toUpperCase()),
        el("span", "label", project.name)
      );
      return row;
    })
  );
  if (!visible.length)
    $("projects").append(
      el(
        "div",
        "sidebar-empty",
        state.connected ? query ? "\u6CA1\u6709\u5339\u914D\u7684\u9879\u76EE" : "\u6DFB\u52A0\u4E00\u4E2A\u9879\u76EE\uFF0C\u5F00\u59CB\u5DE5\u4F5C\u3002" : "\u8FDE\u63A5\u540E\u540C\u6B65\u5DE5\u4F5C\u9879\u76EE"
      )
    );
  for (const [id, key] of [
    ["chatProject", "chatProject"],
    ["filesProject", "fileProject"],
    ["terminalProject", "terminalProject"]
  ]) {
    const select = $(id);
    select.replaceChildren(
      new Option(id === "chatProject" ? "\u9879\u76EE\uFF08\u53EF\u9009\uFF09" : "\u9009\u62E9\u9879\u76EE", ""),
      ...state.projects.map((p) => new Option(p.name, p.id))
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
  state.threads = threads || [];
  renderThreads();
  updateControls();
  if (state.threadId) {
    updateContext();
    queueRender();
  }
}
function renderThreads() {
  const query = $("search").value.toLowerCase();
  const visible = state.threads.filter(
    (t) => `${t.title} ${t.projectPath}`.toLowerCase().includes(query)
  );
  const threadNode = (thread) => {
    const row = button(
      "",
      () => openThread(thread),
      `thread-row ${thread.status || ""}${state.threadId === thread.id ? " active" : ""}`
    );
    row.title = `${thread.title}
${thread.projectPath || ""}`;
    row.append(
      el("span", "thread-indicator"),
      el("span", "thread-title", thread.title || "\u672A\u547D\u540D\u4F1A\u8BDD")
    );
    return row;
  };
  const pinned = visible.filter((t) => t.pinnedIndex).sort((a, b) => a.pinnedIndex - b.pinnedIndex);
  $("pinnedThreads").replaceChildren(...pinned.map(threadNode));
  $("pinnedHeading").hidden = !pinned.length;
  $("threads").replaceChildren(...visible.filter((t) => !t.pinnedIndex).slice(0, 100).map(threadNode));
  applySidebarSections();
  if (!visible.filter((t) => !t.pinnedIndex).length)
    $("threads").append(
      el(
        "div",
        "sidebar-empty",
        state.connected ? query ? "\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u8BDD" : "\u4F60\u7684\u4F1A\u8BDD\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC" : "\u8FDE\u63A5\u540E\u540C\u6B65\u6700\u8FD1\u4F1A\u8BDD"
      )
    );
}
async function selectProject(project) {
  if (!await allowFileLeave()) return;
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
  restoreDraft();
  showPage("chat");
  renderThreads();
  renderConversation();
  closeDrawer();
  $("prompt").focus();
}
async function openThread(thread) {
  var _a;
  storeDraft();
  state.selection++;
  state.threadId = thread.id;
  state.chatProject = ((_a = state.projects.find(
    (p) => comparablePath(p.path) === comparablePath(thread.projectPath)
  )) == null ? void 0 : _a.id) || "";
  restoreDraft();
  renderProjects();
  showPage("chat");
  closeDrawer();
  renderConversation({ followLatest: true });
  await loadThread(thread.id);
}
async function loadThread(id) {
  const pendingEvents = [];
  state.hydrating.set(id, pendingEvents);
  try {
    const { events } = await api(
      `/api/threads/${encodeURIComponent(id)}/events`
    );
    if (state.hydrating.get(id) !== pendingEvents) return;
    state.events.set(id, mergeEvents(events || [], pendingEvents));
    if (state.threadId === id) {
      renderConversation();
    }
  } finally {
    if (state.hydrating.get(id) === pendingEvents) state.hydrating.delete(id);
  }
}
async function sendPrompt() {
  var _a;
  if (isRunning()) {
    storeDraft();
    toast("\u4EFB\u52A1\u4ECD\u5728\u8FDB\u884C\uFF0C\u8349\u7A3F\u5DF2\u4FDD\u7559\u3002");
    return;
  }
  const text = $("prompt").value.trim();
  const images = state.imageDrafts[draftKey()] || [];
  if (!text && !images.length || !onlineRequired() || state.pending || state.uploading) return;
  const project = state.projects.find((p) => p.id === state.chatProject);
  storeDraft();
  const pending = {
    requestId: requestId(),
    text,
    images,
    key: draftKey(),
    project: state.chatProject,
    threadId: state.threadId,
    selection: state.selection
  };
  state.pending = pending;
  try {
    sendCommand(
      state.threadId ? {
        type: "turn.start",
        images,
        threadId: state.threadId,
        projectPath: (_a = activeThread()) == null ? void 0 : _a.projectPath,
        model: $("chatModel").value.trim(),
        effort: $("chatEffort").value || void 0,
        text,
        requestId: pending.requestId
      } : {
        type: "thread.start",
        images,
        projectPath: project == null ? void 0 : project.path,
        model: $("chatModel").value.trim(),
        effort: $("chatEffort").value || void 0,
        initialText: text,
        requestId: pending.requestId
      }
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
function restorePendingDraft() {
  const pending = state.pending;
  if (pending && state.selection === pending.selection && !$("prompt").value) {
    $("prompt").value = pending.text;
    resizeComposer();
  }
  state.pending = null;
}
function updateContext() {
  var _a, _b;
  $("pageLabel").textContent = pageNames[state.page];
  $("contextLabel").textContent = state.page === "chat" ? ((_a = activeThread()) == null ? void 0 : _a.title) || "\u65B0\u4F1A\u8BDD" : ((_b = state.projects.find(
    (p) => p.id === (state.page === "files" ? state.fileProject : state.terminalProject)
  )) == null ? void 0 : _b.name) || "\u6211\u7684\u7535\u8111";
}
const outputImageGrants = /* @__PURE__ */ new Map();
function markdownNode(text, projectId = state.chatProject, basePath = "") {
  const node = el("div", "markdown");
  const renderer = new marked.Renderer();
  renderer.image = function(token) {
    if (localFilePath(token.href) === null) return marked.Renderer.prototype.image.call(this, token);
    return `<span data-output-image="${encodeURIComponent(token.href)}"></span>`;
  };
  renderer.link = function(token) {
    const local = localFilePath(token.href);
    if (local === null) return marked.Renderer.prototype.link.call(this, token);
    const safe = encodeURIComponent(token.href);
    return `<a href="#output-file" data-output-file="${safe}">${this.parser.parseInline(token.tokens)}</a>`;
  };
  node.innerHTML = DOMPurify.sanitize(
    marked.parse(text || "", { breaks: true, renderer }),
    {
      FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
      FORBID_ATTR: ["style"]
    }
  );
  node.querySelectorAll("a").forEach((a) => {
    if (a.dataset.outputFile) {
      a.onclick = (event) => {
        event.preventDefault();
        run(() => openOutputFile(decodeURIComponent(a.dataset.outputFile), projectId, basePath));
      };
      return;
    }
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  renderMath(node);
  node.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (code) pre.append(button("\u590D\u5236", () => copy(code.textContent), "code-copy glyph-action"));
  });
  node.querySelectorAll("[data-output-image]").forEach((holder) => {
    const href = decodeURIComponent(holder.dataset.outputImage);
    try {
      const file = resolveFileLink(href, state.projects, projectId, basePath), key = JSON.stringify(file);
      let grant = outputImageGrants.get(key);
      if (!grant || grant.expires < Date.now()) {
        grant = { expires: Date.now() + 50 * 60 * 1e3, promise: api("/api/preview/file", { method: "POST", body: file }) };
        outputImageGrants.set(key, grant);
      }
      grant.promise.then((value) => {
        const image = el("img", "inline-output-image");
        image.src = value.url;
        image.alt = file.path;
        image.onclick = () => run(() => openOutputFile(href, projectId, basePath));
        holder.replaceChildren(image);
      }).catch((error) => {
        outputImageGrants.delete(key);
        holder.textContent = "\u56FE\u7247\u65E0\u6CD5\u52A0\u8F7D\uFF1A" + errorMessage(error);
      });
    } catch (error) {
      holder.textContent = errorMessage(error);
    }
  });
  return node;
}
async function openOutputFile(href, projectId, basePath = "") {
  const file = resolveFileLink(href, state.projects, projectId, basePath);
  if (!file) return;
  const modal = el("dialog", "output-modal");
  const heading = el("div", "output-heading"), title = el("h2", null, file.path.split("/").pop());
  const close = button("\u5173\u95ED", () => modal.close(), "button secondary");
  const body = el("div", "output-body", "\u6B63\u5728\u6253\u5F00\u6587\u4EF6\u2026");
  heading.append(title, close);
  modal.append(heading, body);
  document.body.append(modal);
  modal.addEventListener("close", () => modal.remove(), { once: true });
  modal.showModal();
  try {
    const grant = await api("/api/preview/file", { method: "POST", body: file });
    if (!modal.isConnected) return;
    const download = el("a", "button secondary", "\u4E0B\u8F7D");
    download.href = grant.url + "?download=1";
    download.download = title.textContent;
    download.innerHTML = icon("download");
    download.title = "\u4E0B\u8F7D";
    download.setAttribute("aria-label", "\u4E0B\u8F7D");
    heading.insertBefore(download, close);
    if (/\.pdf$/i.test(file.path)) await renderPdf(body, grant.url);
    else if (previewKind(file.path) === "image") {
      const img = el("img");
      img.alt = file.path;
      img.src = grant.url;
      body.replaceChildren(img);
    } else if (previewKind(file.path) === "web") {
      const frame = el("iframe");
      frame.sandbox = "allow-scripts";
      frame.title = file.path;
      frame.src = grant.url;
      body.replaceChildren(frame);
    } else if (previewKind(file.path) === "text") {
      const result = await api(`/api/projects/${file.projectId}/file?path=${encodeURIComponent(file.path)}`);
      body.replaceChildren(/\.(md|markdown)$/i.test(file.path) ? markdownNode(result.content, file.projectId, parentPath(file.path)) : el("pre", "output-text", result.content));
    } else body.textContent = "\u6B64\u6587\u4EF6\u53EF\u4E0B\u8F7D\u5230\u8BBE\u5907\u540E\u6253\u5F00\u3002";
  } catch (error) {
    body.textContent = "\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6\uFF1A" + errorMessage(error);
  }
}
function renderConversation({ followLatest = false } = {}) {
  var _a, _b, _c, _d, _e;
  const container = $("conversationScroll");
  const previousTop = container.scrollTop;
  const expanded = new Map([...container.querySelectorAll("details[data-activity-key]")].map((node) => [node.dataset.activityKey, node.open]));
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  const events = state.events.get(state.threadId) || [];
  let lastUser = -1;
  events.forEach((event, i) => {
    if (event.type === "user.message") lastUser = i;
  });
  const taskEvents = events.slice(lastUser + 1), completed = new Set(taskEvents.filter((e) => e.type === "tool.completed").map((e) => e.itemId));
  const active = taskEvents.filter((e) => e.type === "tool.started" && !completed.has(e.itemId)).slice(-1)[0];
  $("taskProgress").hidden = !isRunning();
  $("taskProgress").textContent = isRunning() ? `${completed.size ? `\u5DF2\u5B8C\u6210 ${completed.size} \u9879\u64CD\u4F5C \xB7 ` : ""}${(active == null ? void 0 : active.title) || "Codex \u6B63\u5728\u5904\u7406\u4EFB\u52A1\u2026"}` : "";
  const blocks = conversationBlocks(events, state.threadId, { showWarnings: state.showWarnings });
  const pending = state.pending && (state.pending.threadId === state.threadId || !state.threadId) ? state.pending : null;
  const hasConversation = blocks.length > 0 || Boolean(state.threadId) || pending;
  $("welcome").hidden = Boolean(hasConversation);
  $("chatPage").classList.toggle("is-empty", !hasConversation);
  $("chatHeader").hidden = !state.threadId;
  $("threadTitle").textContent = ((_a = activeThread()) == null ? void 0 : _a.title) || "\u65B0\u4F1A\u8BDD";
  $("threadMeta").textContent = [
    ((_b = state.projects.find((p) => p.id === state.chatProject)) == null ? void 0 : _b.name) || ((_c = activeThread()) == null ? void 0 : _c.projectPath),
    statusLabel((_d = activeThread()) == null ? void 0 : _d.status)
  ].filter(Boolean).join(" \xB7 ");
  const nodes = blocks.map((event) => {
    var _a2, _b2;
    if (event.type === "user.message") {
      const node2 = el("article", "message user");
      node2.append(el("div", "user-bubble", event.text));
      if ((_a2 = event.images) == null ? void 0 : _a2.length) node2.append(imageGallery(event.images));
      return node2;
    }
    if (event.type === "message.delta") {
      const node2 = el("article", "message assistant");
      const label = el("div", "assistant-label");
      label.append(iconNode("spark"), el("span", null, "Codex"));
      node2.append(label, markdownNode(event.text));
      const actions = el("div", "message-actions");
      actions.append(button("\u590D\u5236", () => copy(event.text)));
      node2.append(actions);
      return node2;
    }
    if (event.type === "approval.requested") {
      const node2 = el("div", "activity-block approval-block");
      const approval = state.approvals.find((a) => a.id === event.approvalId);
      const resolved = approval && approval.status !== "pending";
      node2.append(
        el(
          "h3",
          null,
          resolved ? approval.status === "accepted" ? "\u5DF2\u5141\u8BB8" : approval.status === "expired" ? "\u8BF7\u6C42\u5DF2\u5931\u6548" : "\u5DF2\u62D2\u7EDD" : "\u9700\u8981\u4F60\u7684\u786E\u8BA4"
        ),
        el("div", null, event.title)
      );
      if (event.detail) node2.append(el("pre", null, event.detail));
      if (!resolved && event.approvalId) {
        const row = el("div", "button-row");
        row.append(
          button(
            "\u5141\u8BB8",
            () => resolveApproval(event.approvalId, "accept"),
            "button compact"
          ),
          button(
            "\u62D2\u7EDD",
            () => resolveApproval(event.approvalId, "decline"),
            "button secondary compact"
          )
        );
        node2.append(row);
      }
      return node2;
    }
    const node = el("details", "activity-block");
    node.dataset.eventType = event.type;
    node.dataset.activityKey = event.eventId || `${event.type}:${event.turnId || ""}:${event.itemId || ""}`;
    if (event.type === "plan.updated" || event.type === "reasoning.summary" || event.type === "error") node.open = true;
    if (expanded.has(node.dataset.activityKey)) node.open = expanded.get(node.dataset.activityKey);
    const title = (event.type === "warning" && ["warning", "configWarning", "guardianWarning"].includes(event.title) ? "\u8FD0\u884C\u63D0\u793A" : event.title) || {
      "file.changed": "\u6587\u4EF6\u5DF2\u66F4\u65B0",
      "diff.updated": "\u4EE3\u7801\u6539\u52A8",
      "tool.started": "\u6B63\u5728\u6267\u884C",
      "tool.completed": "\u6267\u884C\u5B8C\u6210",
      "tool.output": "\u6267\u884C\u8F93\u51FA",
      "reasoning.summary": "\u63A8\u7406\u6458\u8981",
      "plan.updated": "\u4EFB\u52A1\u8BA1\u5212",
      warning: "\u63D0\u793A",
      error: "\u4EFB\u52A1\u5931\u8D25"
    }[event.type] || event.type;
    node.append(el("summary", null, title));
    const detail = event.text || event.diff || event.detail || event.message || ((_b2 = event.files) == null ? void 0 : _b2.join("\n"));
    if (detail) node.append(el("pre", null, detail));
    if (event.type === "file.changed" || event.type === "diff.updated")
      node.append(
        button("\u67E5\u770B\u6539\u52A8", async () => {
          state.fileProject = state.chatProject;
          showPage("files");
          await switchFileMode("diff");
        })
      );
    return node;
  });
  if (pending && !blocks.some((e) => e.type === "user.message" && e.text === pending.text)) {
    const node = el("article", "message user");
    node.append(
      el("div", "user-bubble", pending.text),
      el("div", "message-caption", pending.threadId ? "\u6B63\u5728\u63D0\u4EA4\u2026" : "\u6B63\u5728\u521B\u5EFA\u4EFB\u52A1\u2026")
    );
    if ((_e = pending.images) == null ? void 0 : _e.length) node.append(imageGallery(pending.images));
    nodes.push(node);
  }
  if (pending || isRunning())
    nodes.push(el("div", "running-indicator", pending ? "\u6B63\u5728\u542F\u52A8\u4EFB\u52A1\u2026" : "Codex \u6B63\u5728\u5DE5\u4F5C\u2026"));
  $("events").replaceChildren(...nodes);
  container.scrollTop = followLatest || nearBottom ? container.scrollHeight : previousTop;
  $("jumpLatest").hidden = followLatest || nearBottom || !hasConversation;
  updateContext();
  updateControls();
}
async function copy(text) {
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
    if (!ok) throw new Error("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u6587\u672C\u590D\u5236\u3002");
  }
  toast("\u5DF2\u590D\u5236");
}
async function refreshApprovals() {
  const { approvals } = await api("/api/approvals");
  state.approvals = approvals || [];
  queueRender();
}
async function resolveApproval(id, decision) {
  await api(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: { decision }
  });
  await refreshApprovals();
}
function fileDirty() {
  var _a;
  return Boolean(
    ((_a = state.opened) == null ? void 0 : _a.editable) && $("editor").value !== state.opened.original
  );
}
async function allowFileLeave() {
  return !fileDirty() || await confirmAction(
    "\u653E\u5F03\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF1F",
    "\u5F53\u524D\u6587\u4EF6\u7684\u4FEE\u6539\u5C1A\u672A\u4FDD\u5B58\u3002\u653E\u5F03\u540E\u5C06\u6253\u5F00\u6240\u9009\u5185\u5BB9\u3002"
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
  $("openedFileName").textContent = "\u6587\u4EF6\u9884\u89C8";
  $("fileEmpty").querySelector("h2").textContent = "\u6253\u5F00\u4E00\u4E2A\u6587\u4EF6";
  $("fileEmpty").querySelector("p").textContent = "\u6D4F\u89C8\u4EE3\u7801\u3001\u7F16\u8F91\u5185\u5BB9\uFF0C\u6216\u67E5\u770B\u9879\u76EE\u6539\u52A8\u3002";
  $("filePreviewBtn").hidden = true;
  updateControls();
}
async function switchFileMode(mode) {
  if (!await allowFileLeave()) return;
  state.fileMode = mode;
  resetFile();
  $("fileModeBtn").classList.toggle("selected", mode === "files");
  $("diffModeBtn").classList.toggle("selected", mode === "diff");
  $("fileSearch").placeholder = mode === "diff" ? "\u7B5B\u9009\u6539\u52A8\u6587\u4EF6" : "\u7B5B\u9009\u5F53\u524D\u76EE\u5F55";
  $("fileSearch").value = "";
  await loadFiles("");
}
async function changeFileProject(id) {
  if (!await allowFileLeave()) {
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
  $("files").replaceChildren(el("div", "sidebar-empty", "\u6B63\u5728\u8BFB\u53D6\u2026"));
  try {
    if (state.fileMode === "diff") {
      const data = await api(`/api/projects/${project}/diff/files`);
      if (serial !== state.listRequest) return;
      state.diffFiles = data.files || [];
    } else {
      const data = await api(
        `/api/projects/${project}/files?path=${encodeURIComponent(path)}`
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
  $("filePathLabel").textContent = diff ? "Git \u6539\u52A8" : state.filePath || "\u9879\u76EE\u6839\u76EE\u5F55";
  $("upBtn").disabled = diff || !state.filePath;
  $("diffCount").textContent = state.diffFiles.length || "";
  const entries = (diff ? state.diffFiles : state.files).filter(
    (file) => (file.path || file.name).toLowerCase().includes(query)
  );
  $("files").replaceChildren(
    ...entries.map((file) => {
      var _a, _b;
      const name = file.name || file.path;
      const row = button(
        "",
        () => diff ? openDiff(file) : file.kind === "directory" ? loadFiles(file.path) : openFile(file),
        "file-row"
      );
      row.classList.toggle(
        "active",
        (((_a = state.opened) == null ? void 0 : _a.path) || ((_b = state.diffSelected) == null ? void 0 : _b.path)) === file.path
      );
      row.title = file.path;
      row.append(
        iconNode(file.kind === "directory" ? "folder" : "file"),
        el("span", "label", name),
        el(
          "small",
          null,
          diff ? `+${file.additions || 0} \u2212${file.deletions || 0}` : file.kind === "directory" ? "" : formatSize(file.size)
        )
      );
      return row;
    })
  );
  if (!entries.length)
    $("files").append(
      el(
        "div",
        "diff-empty",
        !state.fileProject ? "\u9009\u62E9\u4E00\u4E2A\u9879\u76EE\u4EE5\u6D4F\u89C8\u6587\u4EF6\u3002" : query ? "\u6CA1\u6709\u5339\u914D\u7684\u6587\u4EF6\u3002" : diff ? "\u6CA1\u6709 Git \u6539\u52A8\u3002" : "\u5F53\u524D\u76EE\u5F55\u4E3A\u7A7A\u3002"
      )
    );
}
async function openFile(file) {
  if (!await allowFileLeave()) return;
  resetFile();
  const serial = ++state.fileRequest;
  const project = state.fileProject;
  const kind = previewKind(file.path);
  $("fileWorkbench").classList.add("show-detail");
  $("openedFileName").textContent = file.path;
  $("fileEmpty").querySelector("h2").textContent = "\u6B63\u5728\u6253\u5F00\u2026";
  try {
    if (kind === "image" || kind === "web" || kind === "binary") {
      state.opened = {
        project,
        path: file.path,
        kind,
        editable: false,
        original: ""
      };
      await previewFile();
    } else {
      const data = await api(
        `/api/projects/${project}/file?path=${encodeURIComponent(file.path)}`
      );
      if (serial !== state.fileRequest) return;
      state.opened = {
        project,
        path: file.path,
        kind,
        editable: true,
        original: data.content
      };
      $("editor").value = data.content;
      $("editor").hidden = false;
      $("fileEmpty").hidden = true;
      $("filePreviewBtn").hidden = !/\.(md|markdown)$/i.test(file.path);
      $("filePreviewBtn").textContent = "\u9884\u89C8";
    }
    renderFiles();
    updateControls();
  } catch (error) {
    if (serial === state.fileRequest) {
      $("fileEmpty").hidden = false;
      $("fileEmpty").querySelector("h2").textContent = "\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6";
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
    target.append(markdownNode($("editor").value, opened.project, parentPath(opened.path)));
    $("filePreviewBtn").textContent = "\u8FD4\u56DE\u7F16\u8F91";
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
      body: { projectId: opened.project, path: opened.path }
    });
    if (state.opened !== opened) return;
    if (/\.pdf$/i.test(opened.path)) {
      await renderPdf(target, grant.url);
      return;
    }
    const frame = el("iframe");
    frame.title = opened.path;
    frame.sandbox = "allow-scripts";
    frame.src = grant.url;
    target.append(frame);
  } else {
    target.append(el("div", "pane-empty", "\u6B64\u6587\u4EF6\u4E0D\u652F\u6301\u6587\u672C\u7F16\u8F91\u3002"));
  }
}
async function saveFile() {
  const opened = state.opened;
  if (!(opened == null ? void 0 : opened.editable)) return;
  const content = $("editor").value;
  await api(
    `/api/projects/${opened.project}/file?path=${encodeURIComponent(opened.path)}`,
    { method: "PUT", body: { content } }
  );
  if (state.opened === opened) opened.original = content;
  toast("\u6587\u4EF6\u5DF2\u4FDD\u5B58");
  updateControls();
}
function diffCode(text) {
  const node = el("pre", "diff-code");
  for (const line of text.split("\n")) {
    const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "";
    node.append(el("span", `diff-line ${cls}`, line || " "));
  }
  return node;
}
async function openDiff(file) {
  var _a;
  if (!await allowFileLeave()) return;
  resetFile();
  const serial = ++state.fileRequest;
  const project = state.fileProject;
  $("openedFileName").textContent = file.path;
  $("fileWorkbench").classList.add("show-detail");
  const [data, hunks] = await Promise.all([
    api(
      `/api/projects/${project}/diff/file?path=${encodeURIComponent(file.path)}`
    ),
    api(
      `/api/projects/${project}/diff/file/hunks?path=${encodeURIComponent(file.path)}`
    )
  ]);
  if (serial !== state.fileRequest) return;
  state.diffSelected = file;
  $("fileEmpty").hidden = true;
  $("diffView").hidden = false;
  const view = $("diffView");
  view.replaceChildren();
  const actions = el("div", "diff-actions");
  const accept = button(
    "\u6682\u5B58\u6587\u4EF6",
    () => applyDiff("accept", file),
    "button compact"
  );
  accept.disabled = file.status === "accepted";
  actions.append(
    accept,
    button(
      "\u64A4\u9500\u6587\u4EF6\u6539\u52A8",
      () => applyDiff("revert", file),
      "button secondary compact"
    )
  );
  view.append(actions);
  if ((_a = hunks.hunks) == null ? void 0 : _a.length) {
    for (const hunk of hunks.hunks) {
      const bar = el("div", "diff-actions");
      bar.append(
        el("span", "muted", hunk.source === "staged" ? "\u5DF2\u6682\u5B58" : "\u5DE5\u4F5C\u533A")
      );
      if (hunk.source === "worktree")
        bar.append(button("\u6682\u5B58\u6B64\u5904", () => applyDiff("accept", file, hunk)));
      bar.append(
        button(
          hunk.source === "staged" ? "\u53D6\u6D88\u6682\u5B58" : "\u64A4\u9500\u6B64\u5904",
          () => applyDiff("revert", file, hunk)
        )
      );
      view.append(bar, diffCode(hunk.text));
    }
  } else view.append(diffCode(data.diff || "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6587\u672C\u6539\u52A8\u3002"));
  renderFiles();
  updateControls();
}
async function applyDiff(action, file, hunk) {
  if (action === "revert" && !await confirmAction(
    (hunk == null ? void 0 : hunk.source) === "staged" ? "\u53D6\u6D88\u6682\u5B58\uFF1F" : "\u64A4\u9500\u6539\u52A8\uFF1F",
    `${file.path}${hunk ? " \u7684\u9009\u5B9A\u7247\u6BB5" : ""}\u3002${(hunk == null ? void 0 : hunk.source) === "staged" ? "\u5DE5\u4F5C\u533A\u5185\u5BB9\u4F1A\u4FDD\u7559\u3002" : "\u672A\u63D0\u4EA4\u7684\u4FEE\u6539\u5C06\u88AB\u4E22\u5F03\uFF0C\u65E0\u6CD5\u81EA\u52A8\u6062\u590D\u3002"}`
  ))
    return;
  const project = state.fileProject;
  await api(
    `/api/projects/${project}/diff/file/${hunk ? "hunk/" : ""}${action}?path=${encodeURIComponent(file.path)}`,
    {
      method: "POST",
      body: hunk ? { source: hunk.source, index: hunk.index } : {}
    }
  );
  toast(action === "accept" ? "\u5DF2\u6682\u5B58" : "\u6539\u52A8\u5DF2\u64A4\u9500");
  resetFile();
  await loadFiles();
  const current = state.diffFiles.find((f) => f.path === file.path);
  if (current) await openDiff(current);
}
function isInteractive(record) {
  var _a;
  return Boolean(
    (record == null ? void 0 : record.interactive) || ((_a = record == null ? void 0 : record.command) == null ? void 0 : _a.includes("\u4EA4\u4E92\u5F0F\u4F1A\u8BDD"))
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
    (r) => !project || comparablePath(r.cwd) === comparablePath(project.path)
  );
  $("terminalCount").textContent = state.terminalCommands.filter(
    (r) => r.status === "running"
  ).length;
  $("terminalCount").hidden = $("terminalCount").textContent === "0";
  $("terminalList").replaceChildren(
    ...commands.map((record) => {
      const row = button(
        "",
        () => selectTerminal(record.commandId),
        `terminal-record${state.activeTerminal === record.commandId ? " active" : ""}`
      );
      row.append(
        el(
          "strong",
          null,
          isInteractive(record) ? "PowerShell" : record.command || "\u7EC8\u7AEF"
        ),
        el("small", null, statusLabel(record.status))
      );
      return row;
    })
  );
  if (!commands.length)
    $("terminalList").append(el("div", "sidebar-empty", "\u6682\u65E0\u7EC8\u7AEF\u8BB0\u5F55"));
}
function ensureTerminal() {
  if (state.terminal) return;
  if (!window.Terminal || !window.FitAddon)
    throw new Error("\u7EC8\u7AEF\u7EC4\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u3002");
  const terminal = new window.Terminal({
    cursorBlink: true,
    screenReaderMode: true,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, monospace",
    lineHeight: 1.35,
    scrollback: 1e4,
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
      white: "#d7e2cd"
    }
  });
  const fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.open($("terminalHost"));
  state.terminal = terminal;
  state.terminalFit = fit;
  terminal.onData((text) => {
    const record = state.terminalCommands.find(
      (r) => r.commandId === state.activeTerminal
    );
    if (state.connected && isInteractive(record) && record.status === "running")
      run(
        () => api(
          `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/input`,
          { method: "POST", body: { text, appendNewline: false } }
        )
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
    (r) => r.commandId === state.activeTerminal
  );
  if (state.connected && isInteractive(record) && record.status === "running")
    run(
      () => api(
        `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/resize`,
        {
          method: "POST",
          body: {
            cols: Math.max(20, Math.min(240, state.terminal.cols)),
            rows: Math.max(5, Math.min(80, state.terminal.rows))
          }
        }
      )
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
    (r) => r.commandId === state.activeTerminal
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
  $("terminalTitle").textContent = record.command || "\u7EC8\u7AEF";
  $("terminalStatus").textContent = `${statusLabel(record.status)} \xB7 ${record.cwd || ""}`;
}
async function newTerminal() {
  if (!onlineRequired() || !state.terminalProject) return;
  const project = state.terminalProject;
  const result = await api(`/api/projects/${project}/terminal/session`, {
    method: "POST",
    body: { cols: 100, rows: 30 }
  });
  await refreshTerminals();
  if (state.terminalProject === project) selectTerminal(result.sessionId);
}
async function runTerminalCommand() {
  const command = $("commandInput").value;
  if (!command.trim() || !onlineRequired() || !state.terminalProject) return;
  const active = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal
  );
  if (isInteractive(active) && active.status === "running")
    await api(
      `/api/terminal/sessions/${encodeURIComponent(active.commandId)}/input`,
      { method: "POST", body: { text: command, appendNewline: true } }
    );
  else {
    const result = await api(
      `/api/projects/${state.terminalProject}/terminal/run`,
      { method: "POST", body: { command } }
    );
    await refreshTerminals();
    selectTerminal(result.commandId);
  }
  if ($("commandInput").value === command) $("commandInput").value = "";
}
async function stopTerminal() {
  const record = state.terminalCommands.find(
    (r) => r.commandId === state.activeTerminal
  );
  if (!record) return;
  await api(
    isInteractive(record) ? `/api/terminal/sessions/${encodeURIComponent(record.commandId)}/stop` : `/api/terminal/${encodeURIComponent(record.commandId)}/stop`,
    { method: "POST", body: {} }
  );
  await refreshTerminals();
}
async function loadSettings() {
  await loadModels();
  const [settingsResult, rawResult, summaryResult] = await Promise.allSettled([
    api("/api/settings/user"),
    api("/api/settings/user/raw"),
    api("/api/settings/approval-summary")
  ]);
  if (settingsResult.status === "fulfilled") {
    const initialSettings = !state.settingsLoaded;
    state.settings = settingsResult.value.settings || {};
    state.settingsLoaded = true;
    if (!state.settingsDirty) fillSettings();
    if (initialSettings && state.models.some((m) => m.model === state.settings.model))
      $("chatModel").value = state.settings.model || "";
    fillChatEfforts();
  }
  if (rawResult.status === "fulfilled" && !state.rawDirty) {
    $("configPath").textContent = rawResult.value.config.path;
    $("rawConfig").value = rawResult.value.config.content;
  }
  if (summaryResult.status === "fulfilled")
    $("approvalSummary").textContent = summaryResult.value.summary.summary;
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
  disableResponseStorage: "settingStorage"
};
function fillSettings() {
  for (const [key, id] of Object.entries(settingsFields)) {
    const field = $(id);
    if (field.type === "checkbox") field.checked = Boolean(state.settings[key]);
    else {
      const value = state.settings[key] || "";
      if (key !== "model" && field.tagName === "SELECT" && !Array.from(field.options).some((o) => o.value === value))
        field.add(new Option(value, value));
      field.value = value;
    }
  }
  fillModelChoices();
}
async function loadModels() {
  try {
    const result = await api("/api/models");
    state.models = result.models || [];
    if (!state.models.length) throw new Error("\u7535\u8111\u4E0A\u7684 Codex \u6CA1\u6709\u53EF\u9009\u6A21\u578B");
    fillModelChoices();
  } catch (error) {
    state.models = [];
    for (const id of ["chatModel", "settingModel"]) {
      $(id).replaceChildren(new Option("\u6A21\u578B\u5217\u8868\u52A0\u8F7D\u5931\u8D25", ""));
      $(id).disabled = true;
    }
    toast(errorMessage(error), true);
    throw error;
  }
}
function fillModelChoices() {
  var _a, _b;
  for (const id of ["chatModel", "settingModel"]) {
    const node = $(id), previous = node.value || ((_a = state.settings) == null ? void 0 : _a.model);
    node.replaceChildren(...state.models.map((m) => new Option(m.displayName, m.model)));
    node.value = state.models.some((m) => m.model === previous) ? previous : ((_b = state.models[0]) == null ? void 0 : _b.model) || "";
    node.disabled = !state.models.length;
  }
  fillEfforts();
  fillChatEfforts();
}
function fillChatEfforts() {
  var _a, _b;
  const model = state.models.find((m) => m.model === $("chatModel").value), select = $("chatEffort");
  const remembered = safeRead("cmc.effort." + ((model == null ? void 0 : model.model) || "")), choices = (model == null ? void 0 : model.supportedReasoningEfforts) || [];
  const labels = { none: "\u5173\u95ED", minimal: "\u6700\u5C11", low: "\u8F7B\u91CF", medium: "\u6807\u51C6", high: "\u6DF1\u5165", xhigh: "\u66F4\u6DF1\u5165", max: "\u6700\u9AD8", ultra: "\u6781\u81F4" };
  select.replaceChildren(...choices.map((e) => {
    const label = labels[e.reasoningEffort] || e.reasoningEffort;
    const option = new Option(`${label} \xB7 ${e.reasoningEffort}`, e.reasoningEffort);
    option.dataset.compactLabel = label;
    return option;
  }));
  const preferred = remembered || ((_a = state.settings) == null ? void 0 : _a.reasoningEffort) || (model == null ? void 0 : model.defaultReasoningEffort);
  select.value = choices.some((e) => e.reasoningEffort === preferred) ? preferred : (model == null ? void 0 : model.defaultReasoningEffort) || ((_b = choices[0]) == null ? void 0 : _b.reasoningEffort) || "";
  if (!choices.length) select.add(new Option("\u6A21\u578B\u9ED8\u8BA4", ""));
  select.disabled = !state.connected || !choices.length;
}
$("chatModel").addEventListener("change", fillChatEfforts);
$("chatEffort").addEventListener("change", () => safeWrite("cmc.effort." + $("chatModel").value, $("chatEffort").value));
function fillEfforts() {
  const model = state.models.find((m) => m.model === $("settingModel").value);
  const current = $("settingEffort").value;
  $("settingEffort").replaceChildren(...((model == null ? void 0 : model.supportedReasoningEfforts) || []).map((e) => new Option(e.reasoningEffort, e.reasoningEffort)));
  $("settingEffort").value = [...$("settingEffort").options].some((o) => o.value === current) ? current : (model == null ? void 0 : model.defaultReasoningEffort) || "";
}
$("settingModel").addEventListener("change", fillEfforts);
async function saveSettings() {
  if (!state.settingsLoaded) return;
  const settings = {};
  for (const [key, id] of Object.entries(settingsFields))
    if (key !== "modelProvider" && key !== "providerBaseUrl")
      settings[key] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
  const result = await api("/api/settings/user", {
    method: "PUT",
    body: settings
  });
  state.settings = result.settings;
  state.settingsDirty = false;
  await loadSettings();
  toast("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
}
async function refreshCodex() {
  const { codex } = await api("/api/codex/status");
  state.codex = codex;
  $("codexStatus").replaceChildren(
    el("div", null, codex.running ? "\u25CF Codex \u6B63\u5728\u8FD0\u884C" : "\u25CB Codex \u5C1A\u672A\u542F\u52A8"),
    el("div", "muted", codex.cliVersion || "\u672A\u68C0\u6D4B\u5230 Codex CLI")
  );
  if (codex.lastError)
    $("codexStatus").append(el("p", "muted", codex.lastError));
  $("codexStartBtn").disabled = codex.running;
  $("codexRestartBtn").disabled = !state.connected;
}
async function refreshDevices() {
  const { devices } = await api("/api/devices");
  $("devices").replaceChildren(
    ...(devices || []).filter((d) => !d.revokedAt).map((device) => {
      const row = el("div", "settings-row");
      const content = el("div");
      content.append(
        el("strong", null, device.name),
        el(
          "small",
          null,
          device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString("zh-CN") : "\u5DF2\u914D\u5BF9"
        )
      );
      row.append(
        content,
        button("\u64A4\u9500", async () => {
          if (!await confirmAction(
            "\u64A4\u9500\u8BBE\u5907\uFF1F",
            `${device.name} \u5C06\u65E0\u6CD5\u7EE7\u7EED\u8BBF\u95EE\u7535\u8111\u7AEF\u3002`
          ))
            return;
          await api(`/api/devices/${device.id}`, { method: "DELETE" });
          await refreshDevices();
        })
      );
      return row;
    })
  );
  if (!$("devices").childElementCount)
    $("devices").append(el("p", "muted", "\u6682\u65E0\u5DF2\u914D\u5BF9\u8BBE\u5907\u3002"));
}
function renderRoots() {
  $("projectRoots").replaceChildren(
    ...state.projects.map((project) => {
      const row = el("div", "settings-row");
      const content = el("div");
      content.append(
        el("strong", null, project.name),
        el("small", null, project.path)
      );
      row.append(
        content,
        button("\u79FB\u9664", async () => {
          if (!await confirmAction(
            "\u79FB\u9664\u9879\u76EE\uFF1F",
            `\u5C06\u79FB\u9664 ${project.name} \u7684\u8BBF\u95EE\u6743\u9650\uFF0C\u7535\u8111\u4E0A\u7684\u6587\u4EF6\u4F1A\u4FDD\u7559\u3002`
          ))
            return;
          await api(
            `/api/config/project-roots?path=${encodeURIComponent(project.path)}`,
            { method: "DELETE" }
          );
          await refreshProjects();
        })
      );
      return row;
    })
  );
  if (!state.projects.length)
    $("projectRoots").append(el("p", "muted", "\u8FD8\u6CA1\u6709\u6DFB\u52A0\u9879\u76EE\u76EE\u5F55\u3002"));
}
async function pairStart() {
  if (!onlineRequired()) return;
  const data = await api("/api/pair/start?baseUrl=" + encodeURIComponent($("pairAddress").value));
  $("pairAddress").replaceChildren(...data.addresses.map((a) => new Option(`${a.name} \xB7 ${a.url}`, a.url)));
  $("pairAddress").value = data.baseUrl;
  $("pairQr").innerHTML = DOMPurify.sanitize(data.qrSvg, {
    USE_PROFILES: { svg: true }
  });
  $("pairCode").textContent = data.code;
  $("pairWebLink").href = `${data.baseUrl}/console`;
  $("pairWebLink").textContent = `\u624B\u673A\u6D4F\u89C8\u5668\u6253\u5F00 ${data.baseUrl}`;
  $("pairExpiry").textContent = `\u914D\u5BF9\u7801\u6709\u6548\u81F3 ${new Date(data.expiresAt).toLocaleTimeString("zh-CN")}\uFF0C\u7535\u8111\u4E0E\u624B\u673A\u9700\u8981\u5728\u540C\u4E00\u7F51\u7EDC\u3002`;
  openDialog("pairDialog");
}
async function previewLocal() {
  if (!onlineRequired()) return;
  const target = validatePreview($("previewUrl").value.trim());
  const result = await api("/api/preview", {
    method: "POST",
    body: { url: target }
  });
  $("preview").src = result.url;
  $("preview").hidden = false;
  $("previewEmpty").hidden = true;
}
let drawerReturnFocus;
const desktopSidebar = matchMedia("(min-width:761px)");
let sidebarExpanded = safeRead("cmc.sidebarExpanded") === "true";
let mobileDrawerOpen = false;
function syncSidebarLayout() {
  const desktop = desktopSidebar.matches;
  const open = desktop ? sidebarExpanded : mobileDrawerOpen;
  document.body.classList.toggle("sidebar-expanded", desktop && open);
  $("sidebar").hidden = !open;
  $("sidebar").classList.toggle("open", open);
  if (desktop) {
    $("sidebar").removeAttribute("role");
    $("sidebar").removeAttribute("aria-modal");
  } else {
    $("sidebar").setAttribute("role", "dialog");
    $("sidebar").setAttribute("aria-modal", "true");
  }
  $("drawerBackdrop").hidden = desktop || !open;
  $("main").inert = !desktop && open;
  for (const id of ["openDrawer", "mobileDrawer"]) $(id).setAttribute("aria-expanded", String(open));
  requestAnimationFrame(updateSidebarScrollbar);
}
function openDrawer({ search = false } = {}) {
  hideMenu();
  drawerReturnFocus = document.activeElement;
  if (desktopSidebar.matches) {
    sidebarExpanded = true;
    safeWrite("cmc.sidebarExpanded", "true");
  } else mobileDrawerOpen = true;
  syncSidebarLayout();
  requestAnimationFrame(() => {
    (search ? $("search") : $("closeDrawer")).focus();
    updateSidebarScrollbar();
  });
}
function closeDrawer({ force = false } = {}) {
  if (desktopSidebar.matches && !force) return;
  const wasOpen = !$("sidebar").hidden;
  if (desktopSidebar.matches) {
    sidebarExpanded = false;
    safeWrite("cmc.sidebarExpanded", "false");
  } else mobileDrawerOpen = false;
  syncSidebarLayout();
  if (wasOpen) {
    const target = (drawerReturnFocus == null ? void 0 : drawerReturnFocus.isConnected) && drawerReturnFocus.getClientRects().length ? drawerReturnFocus : $(desktopSidebar.matches ? "openDrawer" : "mobileDrawer");
    target.focus({ preventScroll: true });
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
  $("backToChat").hidden = page === "chat";
  $("mobileTitle").hidden = page !== "chat";
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
  menuAnchor == null ? void 0 : menuAnchor.setAttribute("aria-expanded", "false");
}
function showMenu(anchor, items) {
  var _a;
  const menu = $("actionMenu");
  if (!menu.hidden && menuAnchor === anchor) {
    hideMenu();
    return;
  }
  menuAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  menu.setAttribute("role", "menu");
  const menuIcons = { "\u4E0A\u4F20\u56FE\u7247": "image", "\u65B0\u4F1A\u8BDD": "compose", "\u5F53\u524D\u9879\u76EE\u6587\u4EF6": "folder", "\u91CD\u8BD5\u4E0A\u4E00\u6761": "refresh", "\u91CD\u547D\u540D": "compose", "\u79FB\u9664\u4F1A\u8BDD": "close", "\u663E\u793A\u8FD0\u884C\u63D0\u793A": "info", "\u9690\u85CF\u8FD0\u884C\u63D0\u793A": "info" };
  menu.replaceChildren(
    ...items.map(([label, action]) => {
      const item = button(
        label,
        () => {
          hideMenu();
          return action();
        },
        ""
      );
      item.setAttribute("role", "menuitem");
      if (menuIcons[label]) item.prepend(iconNode(menuIcons[label]));
      return item;
    })
  );
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(innerWidth - menu.offsetWidth - 12, box.right - menu.offsetWidth))}px`;
  const below = box.bottom + 6;
  menu.style.top = `${Math.max(12, below + menu.offsetHeight < innerHeight - 12 ? below : box.top - menu.offsetHeight - 6)}px`;
  menu.onkeydown = (event) => {
    var _a2;
    const options = [...menu.querySelectorAll("button")], index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      (_a2 = options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]) == null ? void 0 : _a2.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.stopPropagation();
      hideMenu();
      anchor.focus();
    }
  };
  (_a = menu.querySelector("button")) == null ? void 0 : _a.focus({ preventScroll: true });
}
async function askText(title, value) {
  const dialog = el("dialog", "modal");
  const form = el("form");
  const heading = el("h2", null, title);
  heading.style.marginBottom = "20px";
  const input = el("input");
  input.value = value;
  input.setAttribute("aria-label", title);
  input.style.width = "100%";
  input.required = true;
  input.maxLength = 160;
  const actions = el("div", "button-row align-right");
  actions.style.marginTop = "20px";
  const cancel = el("button", "button secondary", "\u53D6\u6D88");
  cancel.type = "button";
  const save = el("button", "button", "\u4FDD\u5B58");
  actions.append(cancel, save);
  form.append(heading, input, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const finish = (value2) => {
      dialog.close();
      dialog.remove();
      resolve(value2);
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
  const thread = activeThread();
  if (!thread) return;
  const title = await askText("\u91CD\u547D\u540D\u4F1A\u8BDD", thread.title);
  if (!title) return;
  await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
    method: "PATCH",
    body: { title }
  });
  await refreshThreads();
  renderConversation();
}
async function deleteThread() {
  const thread = activeThread();
  if (!thread) return;
  if (!await confirmAction(
    "\u79FB\u9664\u4F1A\u8BDD\uFF1F",
    `\u5C06\u4ECE\u63A7\u5236\u53F0\u79FB\u9664\u300C${thread.title}\u300D\u53CA\u5176\u63A7\u5236\u53F0\u6D88\u606F\u8BB0\u5F55\u3002`
  ))
    return;
  await api(`/api/threads/${encodeURIComponent(thread.id)}`, {
    method: "DELETE"
  });
  state.events.delete(thread.id);
  state.threadId = "";
  await refreshThreads();
  restoreDraft();
  renderConversation();
}
function openProjectDialog() {
  if (!onlineRequired()) return;
  showInline("projectError", "");
  openDialog("projectDialog");
  $("projectPath").focus();
}
$("mobileTitle").onclick = () => run(newThread);
for (const id of ["openDrawer", "mobileDrawer"]) $(id).onclick = () => openDrawer();
$("railSearch").onclick = () => openDrawer({ search: true });
for (const id of ["railNewThread", "mobileNewThread"]) $(id).onclick = () => run(newThread);
$("closeDrawer").onclick = () => closeDrawer({ force: true });
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
  $("connectionHelp").textContent = method === "token" ? "Token \u4F4D\u4E8E\u7535\u8111\u7684 ~/.codex-mobile-control/server.json\u3002" : "\u5728\u53E6\u4E00\u53F0\u5DF2\u8FDE\u63A5\u8BBE\u5907\u7684\u63A7\u5236\u53F0\u4E2D\u70B9\u51FB\u300C\u624B\u673A\u914D\u5BF9\u300D\uFF0C\u83B7\u53D6\u914D\u5BF9\u7801\u3002";
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
        body: { code: $("pairCodeInput").value.trim(), name: "Web \u63A7\u5236\u53F0" }
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
  toast("\u5DF2\u65AD\u5F00\u8FDE\u63A5");
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
      body: { path: $("projectPath").value.trim() }
    });
    await refreshProjects();
    closeDialog("projectDialog");
    $("projectPath").value = "";
    await selectProject(project);
    toast("\u9879\u76EE\u5DF2\u6DFB\u52A0");
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
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && matchMedia("(pointer:fine)").matches) {
    event.preventDefault();
    if (!$("sendBtn").disabled) run(sendPrompt);
  }
};
$("sendBtn").onclick = () => run(() => {
  if (isRunning()) return sendCommand({ type: "turn.interrupt", threadId: state.threadId, requestId: requestId() });
  return sendPrompt();
});
$("chatProject").onchange = () => {
  const project = state.projects.find((p) => p.id === $("chatProject").value);
  if (project) run(() => selectProject(project));
  else {
    storeDraft();
    state.chatProject = "";
    restoreDraft();
    updateControls();
  }
};
$("conversationScroll").onscroll = () => {
  $("jumpLatest").hidden = $("welcome").hidden === false || $("conversationScroll").scrollHeight - $("conversationScroll").scrollTop - $("conversationScroll").clientHeight < 100;
};
$("jumpLatest").onclick = () => {
  $("conversationScroll").scrollTo({
    top: $("conversationScroll").scrollHeight,
    behavior: "instant"
  });
};
$("threadMenuBtn").onclick = () => showMenu($("threadMenuBtn"), [
  ["\u91CD\u547D\u540D", renameThread],
  ["\u65B0\u4F1A\u8BDD", newThread],
  [state.showWarnings ? "\u9690\u85CF\u8FD0\u884C\u63D0\u793A" : "\u663E\u793A\u8FD0\u884C\u63D0\u793A", () => {
    state.showWarnings = !state.showWarnings;
    safeWrite("cmc.showWarnings", String(state.showWarnings));
    renderConversation();
  }],
  ["\u79FB\u9664\u4F1A\u8BDD", deleteThread]
]);
$("composerTools").onclick = () => showMenu($("composerTools"), [
  ["\u4E0A\u4F20\u56FE\u7247", () => $("imageInput").click()],
  ["\u65B0\u4F1A\u8BDD", newThread],
  [
    "\u5F53\u524D\u9879\u76EE\u6587\u4EF6",
    () => {
      state.fileProject = state.chatProject;
      $("filesProject").value = state.fileProject;
      showPage("files");
    }
  ],
  [
    "\u91CD\u8BD5\u4E0A\u4E00\u6761",
    () => {
      const previous = (state.events.get(state.threadId) || []).filter((e) => e.type === "user.message").slice(-1)[0];
      if (previous) {
        $("prompt").value = previous.text;
        state.imageDrafts[draftKey()] = previous.images || [];
        saveImageDrafts();
        renderImageDrafts();
        storeDraft();
        resizeComposer();
        updateControls();
      }
    }
  ]
]);
$("fileModeBtn").onclick = () => run(() => switchFileMode("files"));
$("diffModeBtn").onclick = () => run(() => switchFileMode("diff"));
$("filesProject").onchange = () => run(() => changeFileProject($("filesProject").value));
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
    $("filePreviewBtn").textContent = "\u9884\u89C8";
  } else run(previewFile);
};
$("newTerminalBtn").onclick = () => run(newTerminal, $("newTerminalBtn"));
$("stopTerminalBtn").onclick = () => run(stopTerminal, $("stopTerminalBtn"));
$("commandForm").onsubmit = (event) => {
  event.preventDefault();
  run(runTerminalCommand);
};
$("terminalProject").onchange = () => {
  var _a;
  state.terminalProject = $("terminalProject").value;
  state.activeTerminal = "";
  state.terminalOutput = "";
  (_a = state.terminal) == null ? void 0 : _a.reset();
  $("terminalEmpty").hidden = false;
  renderTerminalList();
  updateControls();
  updateContext();
};
const keys = {
  ctrlc: "",
  tab: "	",
  esc: "\x1B",
  up: "\x1B[A",
  down: "\x1B[B",
  left: "\x1B[D",
  right: "\x1B[C",
  enter: "\r"
};
$("terminalShortcuts").querySelectorAll("[data-key]").forEach(
  (node) => node.onclick = () => run(
    () => api(
      `/api/terminal/sessions/${encodeURIComponent(state.activeTerminal)}/input`,
      {
        method: "POST",
        body: { text: keys[node.dataset.key], appendNewline: false }
      }
    )
  )
);
$("previewForm").onsubmit = (event) => {
  event.preventDefault();
  run(previewLocal);
};
for (const id of Object.values(settingsFields))
  $(id).oninput = () => state.settingsDirty = true;
$("rawConfig").oninput = () => state.rawDirty = true;
$("saveSettingsBtn").onclick = () => run(saveSettings, $("saveSettingsBtn"));
$("saveRawBtn").onclick = () => run(async () => {
  const content = $("rawConfig").value;
  await api("/api/settings/user/raw", { method: "PUT", body: { content } });
  state.settingsDirty = false;
  state.rawDirty = false;
  await loadSettings();
  toast("\u5B8C\u6574\u914D\u7F6E\u5DF2\u4FDD\u5B58");
}, $("saveRawBtn"));
$("codexStartBtn").onclick = () => run(async () => {
  await api("/api/codex/start", { method: "POST", body: {}, timeout: 65e3 });
  await refreshCodex();
}, $("codexStartBtn"));
$("codexRestartBtn").onclick = () => run(async () => {
  if (!await confirmAction("\u91CD\u542F Codex\uFF1F", "\u6B63\u5728\u6267\u884C\u7684\u4EFB\u52A1\u53EF\u80FD\u4F1A\u4E2D\u65AD\u3002"))
    return;
  await api("/api/codex/restart", {
    method: "POST",
    body: {},
    timeout: 65e3
  });
  await refreshCodex();
}, $("codexRestartBtn"));
$("checkUpgradeBtn").onclick = () => run(async () => {
  const { upgrade } = await api("/api/codex/upgrade-check");
  $("upgradeStatus").textContent = upgrade.error || (upgrade.updateAvailable ? `\u53EF\u66F4\u65B0\u5230 ${upgrade.latestVersion}\u3002${upgrade.command}` : `\u5F53\u524D\u5DF2\u662F\u6700\u65B0\u7248\u672C ${upgrade.installedVersion}`);
}, $("checkUpgradeBtn"));
$("refreshDevices").onclick = () => run(refreshDevices, $("refreshDevices"));
$("pairStartBtn").onclick = () => run(pairStart, $("pairStartBtn"));
$("settingsPairBtn").onclick = () => run(pairStart, $("settingsPairBtn"));
$("refreshPair").onclick = () => run(pairStart, $("refreshPair"));
$("pairAddress").onchange = () => run(pairStart);
$("rotateTokenBtn").onclick = () => run(async () => {
  if (!await confirmAction(
    "\u8F6E\u6362\u5F53\u524D Token\uFF1F",
    "\u4F7F\u7528\u5F53\u524D Token \u7684\u5176\u4ED6\u8FDE\u63A5\u5C06\u5931\u6548\uFF0C\u672C\u7F51\u9875\u4F1A\u4FDD\u5B58\u65B0 Token \u5E76\u91CD\u65B0\u8FDE\u63A5\u3002"
  ))
    return;
  const result = await api("/api/auth/token/rotate", {
    method: "POST",
    body: {}
  });
  safeWrite("cmc.token", result.token);
  await connect(result.token);
  toast("Token \u5DF2\u8F6E\u6362");
}, $("rotateTokenBtn"));
window.addEventListener("click", (event) => {
  if (!$("actionMenu").contains(event.target) && !$("composerTools").contains(event.target) && !$("threadMenuBtn").contains(event.target))
    hideMenu();
});
window.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Tab" && !$("sidebar").hidden && !desktopSidebar.matches) {
    const focusable = [...$("sidebar").querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter((node) => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last == null ? void 0 : last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first == null ? void 0 : first.focus();
    }
  }
  if (event.key === "Escape") {
    hideMenu();
    closeDrawer({ force: true });
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    run(newThread);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.page === "files") {
    event.preventDefault();
    if (fileDirty()) run(saveFile);
  }
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    openDrawer({ search: true });
  }
});
window.addEventListener("resize", () => requestAnimationFrame(resizeComposer));
window.addEventListener("beforeunload", (event) => {
  if (fileDirty() || state.settingsDirty || state.rawDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("offline", () => {
  var _a;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  (_a = state.ws) == null ? void 0 : _a.close();
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
renderProjects();
renderConversation();
updateConnection();
renderImageDrafts();
let refreshingDesktop = false;
setInterval(async () => {
  if (document.hidden || !state.connected || refreshingDesktop) return;
  refreshingDesktop = true;
  try {
    await Promise.allSettled([refreshThreads(), refreshProjects(), ...state.threadId && state.page === "chat" && !isRunning() ? [loadThread(state.threadId)] : []]);
  } finally {
    refreshingDesktop = false;
  }
}, 8e3);
const desktopPair = new URLSearchParams(location.hash.slice(1)).get("desktopPair");
if (desktopPair) {
  history.replaceState(null, "", location.pathname + location.search);
  run(async () => {
    const result = await api("/api/pair/claim", { method: "POST", token: "", body: { code: desktopPair, name: "\u7535\u8111\u63A7\u5236\u53F0" } });
    await connect(result.token);
    await pairStart();
  });
} else if (state.token)
  connect().catch((error) => {
    toast(errorMessage(error), true);
    if (error.status !== 401) scheduleReconnect();
  });
