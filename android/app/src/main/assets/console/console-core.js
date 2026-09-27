export function requestId() {
  var _a, _b;
  return ((_b = (_a = globalThis.crypto) == null ? void 0 : _a.randomUUID) == null ? void 0 : _b.call(_a)) ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export function comparablePath(value = "") {
  return value.replace(/\\/g, "/").replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();
}
export function parentPath(value = "") {
  const clean = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(0, Math.max(0, clean.lastIndexOf("/")));
}
export function statusLabel(status) {
  return {
    running: "\u8FD0\u884C\u4E2D",
    idle: "\u5C31\u7EEA",
    completed: "\u5DF2\u5B8C\u6210",
    interrupted: "\u5DF2\u505C\u6B62",
    stopped: "\u5DF2\u505C\u6B62",
    error: "\u5931\u8D25",
    timeout: "\u8D85\u65F6",
    accepted: "\u5DF2\u6682\u5B58"
  }[status] ?? "\u5C31\u7EEA";
}
export function formatSize(size = 0) {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
}
export function previewKind(file) {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file)) return "image";
  if (/\.(html?|svg)$/i.test(file)) return "web";
  if (/\.(pdf|zip|gz|7z|exe|dll|jar|woff2?|ttf|mp[34]|mov|sqlite|db)$/i.test(file))
    return "binary";
  return "text";
}
export function validatePreview(input) {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("\u8BF7\u8F93\u5165\u7535\u8111\u672C\u673A\u7684 localhost \u6216 127.0.0.1 \u5730\u5740\u3002");
  if (url.username || url.password)
    throw new Error("\u9884\u89C8\u5730\u5740\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u5BC6\u7801\u3002");
  return url.href;
}
export function mergeEvents(events, incoming) {
  const merged = [...events];
  const ids = new Set(events.map((event) => event.eventId).filter(Boolean));
  for (const event of incoming) {
    if (event.eventId && ids.has(event.eventId)) continue;
    if (event.eventId) ids.add(event.eventId);
    merged.push(event);
  }
  return merged;
}
export function conversationBlocks(events, threadId, { showWarnings = false } = {}) {
  var _a;
  const blocks = [];
  for (const incoming of events) {
    let event = incoming;
    if (event.threadId !== threadId) continue;
    if (event.type === "warning" && !showWarnings) continue;
    if (event.type === "user.message" && !event.userVisible && ((_a = event.eventId) == null ? void 0 : _a.startsWith("history:"))) {
      const text = legacyHistoryUserText(event.text);
      if (!text) continue;
      event = { ...event, text };
    }
    if ([
      "connected",
      "thread.started",
      "codex.status",
      "turn.completed",
      "approval.resolved"
    ].includes(event.type)) {
      if (event.type === "turn.completed")
        blocks.push({ ...event, invisible: true });
      continue;
    }
    if (event.type === "terminal.output") continue;
    const previous = blocks[blocks.length - 1];
    if ((event.type === "message.delta" || event.type === "reasoning.summary") && (previous == null ? void 0 : previous.type) === event.type && previous.itemId === event.itemId && previous.turnId === event.turnId) {
      previous.text += event.text;
    } else if (event.type === "tool.output" && (previous == null ? void 0 : previous.type) === event.type && previous.itemId === event.itemId) {
      previous.text += event.text;
    } else blocks.push({ ...event });
  }
  return blocks.filter((block) => !block.invisible);
}
function legacyHistoryUserText(input) {
  let text = input.trim(), removed = false;
  const tags = [
    "recommended_plugins",
    "environment_context",
    "codex_internal_context",
    "app-context",
    "collaboration_mode",
    "skills_instructions",
    "plugins_instructions",
    "in-app-browser-context",
    "multi_agent_role",
    "multi_agent_mode"
  ];
  for (; ; ) {
    const agents = /^# AGENTS\.md instructions[^\n]*\r?\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i.exec(text);
    const context = new RegExp("^<(" + tags.join("|") + ")(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>\\s*", "i").exec(text);
    const permissions = /^<permissions instructions>[\s\S]*?<\/permissions instructions>\s*/i.exec(text);
    const match = agents ?? context ?? permissions;
    if (!match) break;
    removed = true;
    text = text.slice(match[0].length).trimStart();
  }
  if (removed) text = text.replace(/^## My request:\s*/i, "");
  if (text.includes("<codex_internal_context") || /^# AGENTS\.md instructions/i.test(text) || new RegExp("^<(?:" + tags.join("|") + ")\\b", "i").test(text)) return "";
  return text.trim();
}
export function errorMessage(error) {
  if (error.name === "AbortError" || error.name === "TimeoutError")
    return "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7535\u8111\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002";
  if (error instanceof TypeError && /fetch/i.test(error.message))
    return "\u65E0\u6CD5\u8FDE\u63A5\u7535\u8111\uFF0C\u8BF7\u68C0\u67E5 Gateway \u662F\u5426\u6B63\u5728\u8FD0\u884C\u3002";
  return error.message || "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002";
}
