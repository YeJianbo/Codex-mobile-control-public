export function requestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
export function comparablePath(value = "") {
  return value.replace(/\\/g, "/").replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '').replace(/\/+$/, "").toLowerCase();
}
export function parentPath(value = "") {
  const clean = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.slice(0, Math.max(0, clean.lastIndexOf("/")));
}
export function statusLabel(status) {
  return (
    {
      running: "运行中",
      idle: "就绪",
      completed: "已完成",
      interrupted: "已停止",
      stopped: "已停止",
      error: "失败",
      timeout: "超时",
      accepted: "已暂存",
    }[status] ?? "就绪"
  );
}
export function formatSize(size = 0) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`;
}
export function previewKind(file) {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(file)) return "image";
  if (/\.(html?|svg)$/i.test(file)) return "web";
  if (
    /\.(pdf|zip|gz|7z|exe|dll|jar|woff2?|ttf|mp[34]|mov|sqlite|db)$/i.test(file)
  )
    return "binary";
  return "text";
}
export function validatePreview(input) {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("请输入电脑本机的 localhost 或 127.0.0.1 地址。");
  if (url.username || url.password)
    throw new Error("预览地址不能包含账号密码。");
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
export function conversationBlocks(events, threadId, {showWarnings = false} = {}) {
  const blocks = [];
  for (const incoming of events) {
    let event = incoming;
    if (event.threadId !== threadId) continue;
    if (event.type === 'warning' && !showWarnings) continue;
    if (event.type === 'user.message' && event.eventId?.startsWith('history:')) {
      const ambient=stripAmbientBrowserContext(event.text);
      const text = event.userVisible ? ambient : legacyHistoryUserText(ambient);
      if (!text) continue;
      event = {...event, text};
    }
    if (
      [
        "connected",
        "thread.started",
        "codex.status",
        "turn.completed",
        "turn.started",
        "approval.resolved",
      ].includes(event.type)
    ) {
      if (event.type === "turn.completed")
        blocks.push({ ...event, invisible: true });
      continue;
    }
    if (event.type === "terminal.output") continue;
    const previous = blocks[blocks.length - 1];
    if (
      (event.type === "message.delta" || event.type === 'reasoning.summary') &&
      previous?.type === event.type &&
      previous.itemId === event.itemId &&
      previous.turnId === event.turnId
    ) {
      previous.text += event.text;
    } else if (
      event.type === "tool.output" &&
      previous?.type === event.type &&
      previous.itemId === event.itemId
    ) {
      previous.text += event.text;
    } else blocks.push({ ...event });
  }
  return blocks.filter((block) => !block.invisible);
}

function stripAmbientBrowserContext(input) {
  let removed=false;
  let text=String(input||'').replace(/<in-app-browser-context source="ambient-ui-state">([\s\S]*?)<\/in-app-browser-context>\s*/gi,(whole,body)=>{
    if(!body.includes('This block is automatically supplied ambient UI state'))return whole;
    removed=true;return '';
  }).trim();
  if(removed)text=text.replace(/^## My request(?: for Codex)?:\s*/i,'');
  if(/^<turn_aborted>\s*The user interrupted the previous turn on purpose\.[\s\S]*?<\/turn_aborted>\s*$/i.test(text))return '';
  return text.trim();
}

function legacyHistoryUserText(input) {
  let text = input.trim(), removed = false;
  // Older Gateways omit content provenance. Newer imports mark userVisible so
  // deliberately quoted instructions remain visible without this fallback.
  const tags = ['recommended_plugins','environment_context','codex_internal_context',
    'app-context','collaboration_mode','skills_instructions','plugins_instructions',
    'in-app-browser-context','multi_agent_role','multi_agent_mode'];
  for (;;) {
    const agents = /^# AGENTS\.md instructions[^\n]*\r?\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i.exec(text);
    const context = new RegExp('^<(' + tags.join('|') + ')(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>\\s*', 'i').exec(text);
    const permissions = /^<permissions instructions>[\s\S]*?<\/permissions instructions>\s*/i.exec(text);
    const match = agents ?? context ?? permissions;
    if (!match) break;
    removed = true;
    text = text.slice(match[0].length).trimStart();
  }
  if (removed) text = text.replace(/^## My request:\s*/i, '');
  if (text.includes('<codex_internal_context') || /^# AGENTS\.md instructions/i.test(text) ||
      new RegExp('^<(?:' + tags.join('|') + ')\\b', 'i').test(text)) return '';
  return text.trim();
}
export function compactError(value) {
  let text=String(value || '');
  try { const parsed=JSON.parse(text); text=parsed.message || parsed.error?.message || text; } catch {}
  if (/thread not found/i.test(text)) return '会话连接已失效，消息已保留，请重试';
  if (/active writer|桌面版仍持有/i.test(text)) return '等待桌面会话连接，消息已保留';
  if (/timeout|超时/i.test(text)) return '连接超时，消息已保留，请重试';
  return text;
}

const activityTypes=new Set(['tool.started','tool.output','tool.completed','reasoning.summary','context.compaction','file.changed','diff.updated','plan.updated']);

export function cleanActivityLabel(value='') {
  return String(value).trim().split('\n')[0].trim()
    .replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^__(.*?)__$/, '$1').replace(/^`(.*?)`$/, '$1').trim();
}

export function activityEntries(activities) {
  const entries=[],positions=new Map();
  activities.forEach((activity,index)=>{
    const type=activity.type;
    const reasoning=type==='reasoning.summary';
    const tool=type.startsWith('tool.');
    const raw=activity.text||activity.diff||activity.files?.join('\n')||activity.detail||activity.command||'';
    const title=reasoning?cleanActivityLabel(raw)||'思考摘要':
      type==='context.compaction'?'压缩上下文':type==='file.changed'?'编辑文件':
      type==='diff.updated'?'查看改动':type==='plan.updated'?'更新计划':
      /view_image|imageview/i.test(activity.title||'')?'查看图片':
      /apply_patch|edit_file|write_file|fileChange/i.test(activity.title||'')?'编辑文件':
      cleanActivityLabel(activity.title||'').replace(/^exec$/i,'')||'运行命令';
    const key=reasoning?`reasoning:${title.toLowerCase()}`:
      type==='plan.updated'?'plan:current':
      `${tool?'tool':type}:${activity.itemId||activity.commandId||activity.eventId||index}`;
    const previous=positions.get(key);
    if(previous===undefined){
      positions.set(key,entries.length);
      entries.push({type,title,text:raw,status:activity.status||''});
    }else{
      const entry=entries[previous];
      if(reasoning){if(raw.length>entry.text.length)entry.text=raw;}
      else if(raw && !entry.text.includes(raw))entry.text=[entry.text,raw].filter(Boolean).join('\n');
      if(type==='tool.completed'&&activity.status)entry.status=activity.status;
      if(entry.title==='运行命令'&&title!=='运行命令')entry.title=title;
    }
  });
  return entries;
}

export function groupToolActivity(blocks,{running=false}={}) {
  const result=[],segment=[];
  let turnId='';
  const flush=(active=false)=>{
    if(!segment.length)return;
    const activities=segment.filter(block=>activityTypes.has(block.type));
    const messages=segment.filter(block=>!activityTypes.has(block.type));
    if(!activities.length)result.push(...messages);
    else {
      const lastMessage=messages.findLastIndex(block=>block.type==='message.delta');
      const insertion=active||lastMessage<0?messages.length:lastMessage;
      result.push(...messages.slice(0,insertion),{...activities[0],type:'activity.group',activities},...messages.slice(insertion));
    }
    segment.length=0;turnId='';
  };
  for(const block of blocks){
    if(['user.message','approval.requested','error'].includes(block.type)){
      flush();result.push(block);continue;
    }
    if(block.turnId&&turnId&&block.turnId!==turnId)flush();
    if(block.turnId)turnId=block.turnId;
    segment.push(block);
  }
  flush(running);
  return result;
}

export function errorMessage(error) {
  if (error.name === "AbortError" || error.name === "TimeoutError")
    return "请求超时，请检查电脑连接后重试。";
  if (error instanceof TypeError && /fetch/i.test(error.message))
    return "无法连接电脑，请检查 Gateway 是否正在运行。";
  return error.message || "操作未完成，请重试。";
}

