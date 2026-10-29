import {canonicalCompactionText,identifyCompactionMarkers,sameCompaction} from './compaction-events.js';

export function displayThreadTitle(value,fallback='未命名会话'){
  const title=String(value||'').trim();
  if(/^<heartbeat\b/i.test(title))return /<instructions>\s*([^<]+)/i.exec(title)?.[1]?.trim().split('\n')[0]?.slice(0,100)||fallback;
  return title||fallback;
}
export function displayPath(value){
  const text=String(value||''),windows=text.replaceAll('/','\\');
  if(!windows.startsWith('\\\\?\\'))return text;
  const remainder=windows.slice(4);
  if(/^[a-z]:\\/i.test(remainder))return remainder;
  if(/^UNC\\/i.test(remainder))return '\\\\'+remainder.slice(4);
  return text;
}

export function formatUsageTokens(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return '—';
  if(value>=1e8)return (value/1e8).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 亿';
  if(value>=1e4)return (value/1e4).toLocaleString('zh-CN',{maximumFractionDigits:1})+' 万';
  return value.toLocaleString('zh-CN',{maximumFractionDigits:0});
}
export function sessionUsageValues(tokens){
  const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const input=number(tokens?.input),output=number(tokens?.output),cached=number(tokens?.cached);
  const total=number(tokens?.total)??(input!==null&&output!==null?input+output:null);
  const context=value=>number(value)===null?'—':(value/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})+'K';
  return {total:formatUsageTokens(total),input:formatUsageTokens(input),output:formatUsageTokens(output),cached:formatUsageTokens(cached),
    selfTotal:formatUsageTokens(tokens?.self?.total),subagentTotal:formatUsageTokens(tokens?.subagents?.total),
    subagentCount:String(tokens?.subagents?.count??0),
    cacheHit:input>0&&cached!==null&&cached<=input?(cached/input*100).toLocaleString('zh-CN',{maximumFractionDigits:1})+'%':'—',
    context:tokens?.contextState==='awaiting_usage'?'更新中':context(tokens?.context),contextWindow:context(tokens?.contextWindow),
    last:formatUsageTokens(tokens?.last),reasoning:formatUsageTokens(tokens?.reasoning)};
}
export function agentAvailability(backends,models,agent){
  const status=(backends||[]).find(row=>row.agent===agent);
  const available=status?status.available:(models||[]).some(model=>(model.model.includes('::')?model.model.split('::')[0]:'codex')===agent&&model.available!==false);
  return {available,reason:status?.reason||(!available?(agent==='codex'?'未获取可选模型':'未检测到可用 CLI'):''),installed:status?.installed};
}
export function requestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
// A history read starts only after this socket acknowledges the selected stream.
export class ThreadEventFocus {
  constructor(timeoutMs=5000){this.timeoutMs=timeoutMs;this.current=null;}
  ensure(socket,threadId){
    const previous=this.current;
    if(socket?.readyState===1&&previous?.socket===socket&&previous.threadId===threadId)return previous.promise;
    this.reset();
    if(socket?.readyState!==1)return Promise.resolve(false);
    let resolve;
    const owner={socket,threadId,id:requestId(),promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value),timer:null};
    this.current=owner;
    owner.timer=setTimeout(()=>{
      if(this.current!==owner)return;
      this.reset(socket);socket.close();
    },this.timeoutMs);
    try{socket.send(JSON.stringify({type:'thread.focus',threadId,requestId:owner.id}));}
    catch{this.reset(socket);socket.close();}
    return owner.promise;
  }
  acknowledge(socket,id,threadId){
    const owner=this.current;
    if(!owner||owner.socket!==socket||owner.id!==id||owner.threadId!==threadId)return false;
    clearTimeout(owner.timer);owner.resolve(true);return true;
  }
  reset(socket){
    const owner=this.current;
    if(!owner||socket&&owner.socket!==socket)return;
    this.current=null;clearTimeout(owner.timer);owner.resolve(false);
  }
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
  const merged = [];
  const ids = new Set(),submitted=new Set();
  for (const event of [...events,...incoming]) {
    if (event.eventId && ids.has(event.eventId)) continue;
    const request=event.type==='user.message'&&event.requestId?`${event.threadId}:${event.requestId}`:undefined;
    if(request&&submitted.has(request))continue;
    if(request)submitted.add(request);
    if (event.eventId) ids.add(event.eventId);
    merged.push(event);
  }
  return merged;
}
export function reconnectEvents(events) {
  const result=[],compactions=[],ids=new Set();let pending=null;
  const finish=title=>{if(pending!==null)result[pending]={...result[pending],title};pending=null;};
  const detail=event=>[event.title,event.detail||event.text||event.message].filter(Boolean).join('\n');
  for(const event of identifyCompactionMarkers(events)){
    if(event.eventId&&ids.has(event.eventId))continue;
    if(event.eventId)ids.add(event.eventId);
    if(event.type==='context.compaction'){
      const duplicate=compactions.findLast(index=>sameCompaction(result[index],event));
      if(duplicate!==undefined){
        const previous=result[duplicate];
        if(previous.status==='running'||event.status!=='running')result[duplicate]={...event,eventId:previous.eventId,text:event.text||previous.text,
          itemId:event.itemId&&!event.itemId.startsWith('history:')?event.itemId:previous.itemId,turnId:event.turnId||previous.turnId};
        continue;
      }
    }
    const retry=pending===null?null:result[pending];
    if(retry?.turnId&&event.turnId&&retry.turnId!==event.turnId)finish('重试记录');
    if(['user.message','turn.started'].includes(event.type))finish('重试记录');
    if(event.type==='error'&&event.willRetry){
      if(pending===null){pending=result.length;result.push({...event,title:'正在重试',detail:detail(event)});}
      else result[pending]={...result[pending],detail:result[pending].detail+'\n\n'+detail(event)};
      continue;
    }
    // An already running tool can keep producing output while sampling reconnects.
    if(['message.delta','reasoning.summary'].includes(event.type)&&event.text?.trim())finish('执行已恢复');
    if(event.type==='error'&&!event.willRetry)finish('重试未成功');
    if(event.type==='turn.completed')finish(['completed','ok','success'].includes(event.status)?'执行已恢复':['interrupted','stopped'].includes(event.status)?'重试已停止':['failed','error'].includes(event.status)?'重试未成功':'重试记录');
    result.push(event);
    if(event.type==='context.compaction')compactions.push(result.length-1);
  }
  const hidden=new Set(),canonical=canonicalCompactionText;
  result.forEach((compact,index)=>{
    if(compact.type!=='context.compaction'||!compact.text)return;
    for(let i=index-1;i>=0;i--){
      const event=result[i];if(event.threadId!==compact.threadId)continue;
      if(['user.message','turn.started','context.compaction'].includes(event.type))break;
      if(event.type!=='message.delta')continue;
      let start=i;
      if(!event.textComplete&&event.itemId)while(start>0){const prior=result[start-1];if(prior.type!=='message.delta'||prior.threadId!==event.threadId||prior.itemId!==event.itemId||prior.textComplete)break;start--;}
      if(canonical(result.slice(start,i+1).map(row=>row.text).join(''))===canonical(compact.text))for(let j=start;j<=i;j++)hidden.add(j);
      break;
    }
  });
  return result.filter((_,index)=>!hidden.has(index));
}
function orderTurnEvents(events) {
  const activities=new Set(['tool.started','tool.output','tool.completed','reasoning.summary','file.changed','diff.updated','plan.updated']);
  const starts=new Map(),ends=new Map(),owners=new Map(),items=new Map(),aliases=new Map(),replacements=new Map(),duplicate=new Set();
  let active=null,recent=null;
  events.forEach((event,index)=>{
    if(event.type==='turn.started'){
      const id=event.turnId||`start:${index}`;
      if(starts.has(id))duplicate.add(index);
      else {starts.set(id,index);active=id;recent=id;}
    }else if(event.type==='user.message'){
      if(active===null)recent=null;
    }else if(event.type==='turn.completed'){
      if(event.turnId&&active?.startsWith('start:')&&!starts.has(event.turnId))aliases.set(event.turnId,active);
      const id=aliases.get(event.turnId)||event.turnId||active||recent;
      if(id){
        const prior=ends.get(id);
        if(prior===undefined)ends.set(id,index);
        else {duplicate.add(index);if(event.eventId?.startsWith('history:')&&!events[prior].eventId?.startsWith('history:'))replacements.set(prior,event);}
        if(active===id)active=null;
      }
    }else if(activities.has(event.type)){
      const id=aliases.get(event.turnId)||event.turnId||items.get(event.itemId)||active||recent;
      if(id){owners.set(index,id);if(event.itemId)items.set(event.itemId,id);}
    }
  });
  const moved=new Set(),before=new Map();
  owners.forEach((id,index)=>{
    const end=ends.get(id);
    if(end!==undefined&&end<index){moved.add(index);if(!before.has(end))before.set(end,[]);before.get(end).push(events[index]);}
  });
  // Keep late receipts inside their original turn, even after a later turn starts.
  return events.flatMap((event,index)=>[...(before.get(index)||[]),...(!moved.has(index)&&!duplicate.has(index)?[replacements.get(index)||event]:[])]);
}
export function restoreActivityDetails(events,known) {
  let wanted;
  for(const event of events)if(event.detailsDeferred&&event.eventId)(wanted??=new Set()).add(event.eventId);
  if(!wanted||!known.length)return events;
  const complete=new Map();
  for(const event of known)if(!event.detailsDeferred&&wanted.has(event.eventId))complete.set(event.eventId,event);
  if(!complete.size)return events;
  let restored;
  for(let index=0;index<events.length;index++){
    const event=events[index];
    const previous=event.detailsDeferred?complete.get(event.eventId):undefined;
    if(previous&&previous.threadId===event.threadId&&previous.type===event.type){
      (restored??=events.slice(0,index)).push({...previous,...event,detailsDeferred:false});
    }else restored?.push(event);
  }
  return restored??events;
}
export function conversationBlocks(events, threadId, {showWarnings = false} = {}) {
  const blocks = [];
  for (const incoming of reconnectEvents(orderTurnEvents(events.filter(event=>event.threadId===threadId)))) {
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
      if (event.type === "turn.completed" || event.type === "turn.started")
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
      previous.itemId === event.itemId &&
      !event.detailsDeferred && !previous.detailsDeferred
    ) {
      previous.text += event.text;
    } else blocks.push({ ...event });
  }
  return blocks.map(block=>{
    if(block.type!=='message.delta')return block;
    const text=visibleAnswerText(block.text);
    return text===block.text?block:{...block,text};
  });
}
// Remove assistant reference metadata before Markdown strips its XML tags.
// Fenced examples remain literal; history and clipboard use the same visible text.
export function visibleAnswerText(source='') {
  if(!/<\/?(?:oai-mem-citation|citation_entries|rollout_ids)\b/i.test(source))return source;
  const output=[],prose=[];
  let marker='',length=0;
  const flush=()=>{
    output.push(prose.join('').replace(/^ {0,3}<(oai-mem-citation|citation_entries|rollout_ids)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|(?![\s\S]))/gim,'')
      .replace(/^ {0,3}<\/(?:oai-mem-citation|citation_entries|rollout_ids)\s*>[^\S\n]*(?:\n|$)/gim,''));
    prose.length=0;
  };
  for(const line of source.match(/[^\n]*\n|[^\n]+$/g)||[]){
    const fence=/^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(line);
    if(!marker&&fence){flush();marker=fence[1][0];length=fence[1].length;output.push(line);}
    else if(marker){output.push(line);if(fence&&fence[1][0]===marker&&fence[1].length>=length&&!fence[2].trim())marker='';}
    else prose.push(line);
  }
  flush();return output.join('').trimEnd();
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

export function activityTitle(activity) {
  const title=cleanActivityLabel(activity.title||'');
  if(/view_image|imageview/i.test(title))return '查看图片';
  if(/apply_patch|edit_file|write_file|fileChange/i.test(title))return '编辑文件';
  if(/^(?:["']?[A-Za-z]:[\\/]|["']?\/(?:usr|bin)\/|(?:functions\.)?exec(?:_command)?$|shell(?:_command)?$|(?:powershell|pwsh|cmd|bash|sh)(?:\.exe)?\s|运行命令(?:\s|$))/i.test(title))return '运行命令';
  return title||'运行命令';
}

export function activityEntries(activities,{includeDetails=true}={}) {
  const entries=[],positions=new Map();
  activities.forEach((activity,index)=>{
    const type=activity.type;
    const reasoning=type==='reasoning.summary';
    const tool=type.startsWith('tool.');
    const raw=includeDetails||reasoning?activity.text||activity.diff||activity.files?.join('\n')||activity.detail||activity.command||'':'';
    const title=reasoning?cleanActivityLabel(raw)||'思考摘要':
      type==='context.compaction'?'压缩上下文':type==='file.changed'?'编辑文件':
      type==='diff.updated'?'查看改动':type==='plan.updated'?'更新计划':
      activityTitle(activity);
    const key=reasoning?`reasoning:${activity.itemId||title.toLowerCase()}`:
      type==='plan.updated'?'plan:current':type==='diff.updated'?'diff:current':
      `${tool?'tool':type}:${activity.itemId||activity.commandId||activity.eventId||index}`;
    const previous=positions.get(key);
    if(previous===undefined){
      positions.set(key,entries.length);
      entries.push({key,type,title,text:raw,diff:includeDetails?activity.diff||'':'',files:activity.files||[],status:activity.status||'',...(!includeDetails?{activities:[activity]}:{})});
    }else{
      const entry=entries[previous];
      if(!includeDetails)entry.activities.push(activity);
      if(reasoning){if(raw.length>entry.text.length)entry.text=raw;}
      else if(type==='diff.updated'&&raw)entry.text=raw;
      else if(raw && !entry.text.includes(raw))entry.text=[entry.text,raw].filter(Boolean).join('\n');
      if(type==='tool.completed'&&activity.status)entry.status=activity.status;
      if(entry.title==='运行命令'&&title!=='运行命令')entry.title=title;
      if(includeDetails&&activity.diff)entry.diff=activity.diff;
      if(activity.files?.length)entry.files=activity.files;
    }
  });
  return entries;
}

export function activitySummary(activities) {
  const thought=[...activities].reverse().find(event=>event.type==='reasoning.summary' && (event.text||'').trim());
  if(thought)return cleanActivityLabel(thought.text);
  const titles=[...new Set(activityEntries(activities,{includeDetails:false}).filter(entry=>entry.type!=='reasoning.summary').map(entry=>entry.title))];
  return titles.join(' · ')||'正在处理';
}
export function activeConversationTask(events) {
  const started=[],completed=new Set();
  for(let index=events.length-1;index>=0;index--){
    const event=events[index],type=event.type;
    if(type==='user.message')break;
    if(type==='tool.completed')completed.add(event.itemId);
    else if(type==='tool.started')started.push(event);
  }
  // Completion IDs can arrive out of order, so collect the whole current turn
  // before choosing its latest unfinished operation.
  return started.find(event=>!completed.has(event.itemId));
}
export function retainCompaction(previous,next) {
  const active=previous.findLast(event=>['context.compaction','turn.completed'].includes(event.type));
  if(active?.type!=='context.compaction'||active.status!=='running')return next;
  if(next.some(event=>event.eventId&&event.eventId===active.eventId))return next;
  const known=new Set(previous.map(event=>event.eventId).filter(Boolean));
  if(next.some(event=>['context.compaction','turn.completed'].includes(event.type)&&!known.has(event.eventId)&&(!event.createdAt||!active.createdAt||event.createdAt>=active.createdAt)))return next;
  const result=[...next],index=result.findIndex(event=>event.createdAt&&active.createdAt&&event.createdAt>active.createdAt);
  result.splice(index<0?result.length:index,0,active);return result;
}
export class GoalRunClock {
  reported=null; elapsedMs=0; sampledAt=0; ticking=false;
  sample(seconds,active,now){
    if(!Number.isFinite(seconds))return null;
    if(this.reported===null)this.elapsedMs=Math.max(0,seconds)*1000;
    else {
      if(this.ticking)this.elapsedMs+=Math.max(0,now-this.sampledAt);
      if(seconds!==this.reported)this.elapsedMs=Math.max(this.elapsedMs,Math.max(0,seconds)*1000);
    }
    this.reported=seconds;this.sampledAt=now;this.ticking=active;
    return Math.floor(this.elapsedMs/1000);
  }
}
export function groupToolActivity(blocks,{running=false}={}) {
  const result=[],segment=[];
  const runningCompactions=new Set();
  let turnId='';
  const flush=()=>{
    if(segment.length)result.push({...segment[0],type:'activity.group',activities:[...segment]});
    segment.length=0;turnId='';
  };
  for(const block of blocks){
    if(block.turnId&&turnId&&block.turnId!==turnId)flush();
    if(activityTypes.has(block.type)&&block.type!=='context.compaction'){
      if(block.turnId)turnId=block.turnId;
      segment.push(block);
    }else{
      flush();
      if(block.type==='turn.completed'){
        for(const index of runningCompactions)result[index]={...result[index],status:'cancelled'};
        runningCompactions.clear();
      }
      if(block.type==='context.compaction'&&block.status!=='running'){
        const active=[...runningCompactions].findLast(index=>!block.itemId||!result[index].itemId||block.itemId===result[index].itemId);
        if(active!==undefined){result[active]={...block,eventId:result[active].eventId};runningCompactions.delete(active);continue;}
      }
      const previous=result.at(-1);
      if(previous&&sameCompaction(previous,block))result[result.length-1]=block;
      else result.push(block);
      // Indices stay stable during grouping; completed turns only visit live compactions.
      if(block.type==='context.compaction'){
        if(block.status==='running')runningCompactions.add(result.length-1);
        else runningCompactions.delete(result.length-1);
      }
    }
  }
  flush();
  const folded=[],turn=[],turnChanges=[];let startedAt='',turnOpen=false,changeSummaryKey='';
  const finish=(completed,endedAt='',terminal=false)=>{
    const hasTurn=turn.length>0||Boolean(startedAt);
    turnChanges.push(...turn.flatMap(block=>block.activities||[]));
    const summaryKey=turn[0]?.eventId||turn[0]?.itemId;
    if(!changeSummaryKey&&turnChanges.length)changeSummaryKey=summaryKey;
    const summarize=terminal||!turnOpen&&!running;
    const hasChanges=summarize&&turnChanges.some(event=>['file.changed','diff.updated'].includes(event.type)||event.fileChanges?.length);
    if(hasChanges)for(let i=turn.length-1;i>=0;i--)if(turn[i].activities?.length&&turn[i].activities.every(event=>event.type==='diff.updated'&&!event.activityGroupId))turn.splice(i,1);
    const finalIndex=turn.findLastIndex(block=>block.type==='message.delta');
    if(finalIndex>=0&&terminal)turn[finalIndex]={...turn[finalIndex],endedAt};
    const ended=completed||terminal||!running;
    const collapse=ended&&finalIndex>=0;
    const collapseCommentary=completed||!terminal&&!running;
    const inside=(block,index)=>index!==finalIndex&&!['error','warning','context.compaction'].includes(block.type)&&(block.type!=='message.delta'||collapseCommentary);
    const children=collapse?turn.filter(inside):[];
    const first=children.length?turn.indexOf(children[0]):-1;
    turn.forEach((block,index)=>{
      if(index===first)folded.push({type:'process.completed',eventId:`completed:${summaryKey}`,title:processDuration(startedAt,endedAt),children});
      if(!collapse||!children.length||!inside(block,index))folded.push(block);
    });
    if(hasChanges)folded.push({type:'files.summary',eventId:'files:'+changeSummaryKey,activities:[...turnChanges]});
    if(summarize){turnChanges.length=0;changeSummaryKey='';}
    if(terminal&&hasTurn&&finalIndex<0&&endedAt)folded.push({type:'run.ended',eventId:'ended:'+(summaryKey||endedAt),endedAt});
    turn.length=0;
    if(terminal||!turnOpen)startedAt='';
    if(terminal)turnOpen=false;
  };
  for(const block of result){
    if(block.type==='turn.started'){finish(false);turnChanges.length=0;changeSummaryKey='';turnOpen=true;startedAt=block.createdAt;}
    else if(block.type==='turn.completed')finish(!['interrupted','failed','error'].includes(block.status),block.createdAt,true);
    else if(block.type==='user.message'){if(turn.length)finish(false);folded.push(block);}
    else turn.push(block);
  }
  finish(false);return folded;
}
export function processDuration(start,end){
  const seconds=Math.floor((Date.parse(end)-Date.parse(start))/1000);
  if(!Number.isFinite(seconds)||seconds<0)return '处理过程';
  return seconds<60?`用时 ${seconds}秒`:`用时 ${Math.floor(seconds/60)}分 ${seconds%60}秒`;
}
export function errorMessage(error) {
  if (error.name === "AbortError" || error.name === "TimeoutError")
    return "请求超时，请检查电脑连接后重试。";
  if (error instanceof TypeError && /fetch/i.test(error.message))
    return "无法连接电脑，请检查 Gateway 是否正在运行。";
  return error.message || "操作未完成，请重试。";
}

// Trim only complete exchanges. A single long, active reply must remain intact.
export function retainCompleteConversationEvents(events, limit = 10000) {
  if (events.length <= limit) return events;
  let start = events.length - limit;
  while (start > 0 && events[start]?.type !== 'user.message') start--;
  return start===0?events:events.slice(start);
}
