import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GatewayEvent, PendingApproval, ThreadRecord } from "../types.js";
import {desktopSidebar} from './desktopSidebar.js';

type CodexSessionIndexEntry = {
  id?: string;
  thread_name?: string;
  updated_at?: string;
};

type CodexSessionMeta = {
  id?: string;
  timestamp?: string;
  cwd?: string;
};

const MAX_INDEXED_THREADS = 300;

export async function listThreadsWithCodexHistory(storedThreads: ThreadRecord[], refresh = false, activeIds:string[]=[]): Promise<ThreadRecord[]> {
  if (refresh) fileInventories.delete(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'));
  const indexedThreads = await listCodexIndexedThreads();
  const desktop=await desktopSidebar();
  const merged = new Map<string, ThreadRecord>();

  for (const thread of indexedThreads) {
    merged.set(thread.id, thread);
  }
  for (const thread of storedThreads) {
    const indexed = merged.get(thread.id);
    merged.set(thread.id, {
      ...thread,
      projectPath: thread.projectPath || indexed?.projectPath,
      title: meaningfulStoredTitle(thread.title) ? thread.title : indexed?.title ?? thread.title,
      createdAt: thread.createdAt || indexed?.createdAt || thread.updatedAt,
      updatedAt: latestIso(thread.updatedAt, indexed?.updatedAt),
    });
  }
  for(const row of desktop.threads) {
    const existing=merged.get(row.id);
    const recency=Number(row.recency_at_ms||row.updated_at_ms||row.created_at_ms);
    merged.set(row.id,{
      id:row.id,title:row.name || indexedThreads.find(t=>t.id===row.id)?.title || (desktop.pinned.includes(row.id)?row.id:row.title?.slice(0,160)) || '未命名会话',
      projectPath:row.cwd,status:existing?.status||'idle',
      createdAt:new Date(Number(row.created_at_ms)||recency).toISOString(),updatedAt:new Date(recency).toISOString(),
      pinnedIndex:desktop.pinned.includes(row.id)?desktop.pinned.indexOf(row.id)+1:row.is_pinned?desktop.pinned.length+Number(row.section_position||0)+1:undefined,
    });
  }
  for(const [id,thread] of merged)if(desktop.pinned.includes(id))thread.pinnedIndex=desktop.pinned.indexOf(id)+1;
  for(const id of desktop.archived)merged.delete(id);
  if(desktop.threadsLoaded){
    const present=new Set(desktop.threads.map(row=>row.id));
    for(const [id,thread] of merged){
      // The desktop database is authoritative once read successfully. Allow a
      // new turn time to reach the index, but never revive a deleted old row.
      if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)&&!present.has(id)&&!activeIds.includes(id)&&Date.now()-Date.parse(thread.createdAt||thread.updatedAt)>120000)merged.delete(id);
    }
  }

  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listCodexSessionProjectPaths(): Promise<string[]> {
  const threads = await listCodexIndexedThreads();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const thread of threads) {
    const projectPath = thread.projectPath?.trim();
    if (!projectPath) {
      continue;
    }
    const key = path.resolve(projectPath).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path.resolve(projectPath));
    }
  }
  return result;
}

type HistoryCache = {file:string;size:number;mtime:number;line:number;tail:string;limit:number;events:GatewayEvent[];transcript:GatewayEvent[];fallback:GatewayEvent[];hasResponse:boolean;lifecycle?:GatewayEvent;usage?:{info:Record<string,unknown>;updatedAt:string}};
const historyCache=new Map<string,HistoryCache>();
const historyReads=new Map<string,Promise<GatewayEvent[]>>();
export async function readCodexThreadUsage(threadId:string){
  await readCodexThreadEvents(threadId);
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const files=await findSessionFiles(home,threadId);
  return files.slice().reverse().map(file=>historyCache.get(file)?.usage).find(Boolean) ?? null;
}
export function readCodexThreadEvents(threadId:string, count?:number):Promise<GatewayEvent[]> {
  const key=threadId+':'+(count??'default');
  const pending=historyReads.get(key);if(pending)return pending;
  const read=readHistory(threadId,count).finally(()=>historyReads.delete(key));historyReads.set(key,read);return read;
}
async function readHistory(threadId:string,count?:number):Promise<GatewayEvent[]> {
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const files=await findSessionFiles(home,threadId);
  const result:GatewayEvent[]=[];
  for(const file of files.slice().reverse()){
    const required=(count??0)+1;
    result.unshift(...await readHistoryFile(file,threadId,Math.max(600,2**Math.ceil(Math.log2(required)))));
    if(count===undefined?result.filter(event=>event.type==='user.message'||event.type==='message.delta').length>=200:result.length>=count+1)break;
  }
  return count===undefined?selectConversationWindow(result):result.slice(-count-1);
}

export function selectConversationWindow(events:GatewayEvent[]):GatewayEvent[] {
  const dialogue=events.filter(event=>event.type==='user.message'||event.type==='message.delta').slice(-80);
  const activity=events.filter(event=>event.type!=='user.message'&&event.type!=='message.delta'&&event.type!=='tool.output'&&event.type!=='warning').slice(-80);
  const output=events.filter(event=>event.type==='tool.output'||event.type==='warning').slice(-30);
  const attention=events.filter(event=>event.type==='approval.requested'||event.type==='error').slice(-10);
  const lifecycle=events.filter(event=>event.type==='turn.started'||event.type==='turn.completed').at(-1);
  const included=new Set([...dialogue,...activity,...output,...attention,...(lifecycle?[lifecycle]:[])]);
  return events.filter(event=>included.has(event));
}

async function readHistoryFile(file:string,threadId:string,limit:number):Promise<GatewayEvent[]> {
  const stat=await fs.stat(file).catch(()=>null);if(!stat)return [];
  let cached=historyCache.get(file);
  if(!cached||cached.file!==file||stat.size<cached.size||(stat.size===cached.size&&stat.mtimeMs!==cached.mtime)||cached.limit<limit) {
    cached={file,size:0,mtime:0,line:0,tail:'',limit,events:[],transcript:[],fallback:[],hasResponse:false};historyCache.set(file,cached);
    if(historyCache.size>24)historyCache.delete(historyCache.keys().next().value!);
  }
  if(stat.size>cached.size){
    const stream=createReadStream(file,{start:cached.size,end:stat.size-1,encoding:'utf8'});
    // Buffer only the unfinished JSON line; subsequent polls read appended bytes.
    for await(const chunk of stream){
      const lines=(cached.tail+chunk).split(/\r?\n/);cached.tail=lines.pop()||'';
      for(const line of lines){cached.line++;
        if(line.includes('"token_count"')){try{const row=JSON.parse(line);if(row.type==='event_msg'&&row.payload?.type==='token_count'&&row.payload.info)cached.usage={info:row.payload.info,updatedAt:row.timestamp};}catch{}}
        const event=eventFromCodexSessionLine(line,threadId);if(!event)continue;
        const row=JSON.parse(line);
        const identified={...event,eventId:'history:'+threadId+':'+path.basename(file)+':'+cached.line,createdAt:row.timestamp,itemId:('itemId' in event?event.itemId:undefined)??row.payload?.id??'history:'+cached.line};
        if(row.type==='response_item'&&['user.message','message.delta'].includes(event.type))cached.hasResponse=true;
        if(event.type==='turn.started'||event.type==='turn.completed')cached.lifecycle=identified;
        const isMessage=['user.message','message.delta'].includes(event.type);
        const target=isMessage?(row.type==='response_item'?cached.transcript:cached.fallback):cached.events;
        target.push(identified);if(target.length>cached.limit)target.shift();
      }
    }
    cached.size=stat.size;cached.mtime=stat.mtimeMs;
  }
  const result=[...cached.events,...(cached.hasResponse?cached.transcript:cached.fallback)].sort((a,b)=>Number(a.eventId?.split(':').pop())-Number(b.eventId?.split(':').pop()));
  // A long-running turn can produce more than the visible history window.
  if(cached.lifecycle&&!result.some(e=>e.eventId===cached.lifecycle?.eventId))result.unshift(cached.lifecycle);
  const tailEvent=eventFromCodexSessionLine(cached.tail,threadId);
  if(tailEvent){
    const row=JSON.parse(cached.tail);
    if(row.type==='response_item'||!cached.hasResponse||!['user.message','message.delta'].includes(tailEvent.type))result.push({...tailEvent,eventId:'history:'+threadId+':'+path.basename(file)+':'+(cached.line+1),createdAt:row.timestamp});
  }
  return result;
}

async function listCodexIndexedThreads(): Promise<ThreadRecord[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const indexPath = path.join(codexHome, "session_index.jsonl");
  let content = "";
  try {
    content = await fs.readFile(indexPath, "utf8");
  } catch {
    return [];
  }

  const entries = latestIndexEntries(content)
    .sort((a, b) => normalizeIso(b.updated_at).localeCompare(normalizeIso(a.updated_at)))
    .slice(0, MAX_INDEXED_THREADS);
  const ids = new Set(entries.map((entry) => entry.id?.trim()).filter((id): id is string => Boolean(id)));
  const metaById = await readSessionMetadata(codexHome, ids);

  return entries
    .filter((entry): entry is CodexSessionIndexEntry & { id: string } => Boolean(entry.id))
    .map((entry) => {
      const meta = metaById.get(entry.id);
      const updatedAt = normalizeIso(entry.updated_at || meta?.timestamp);
      return {
        id: entry.id,
        projectPath: meta?.cwd,
        title: (entry.thread_name || "").trim() || "Codex 历史会话",
        status: "idle",
        createdAt: normalizeIso(meta?.timestamp || updatedAt),
        updatedAt,
      };
    });
}

function latestIndexEntries(content: string): CodexSessionIndexEntry[] {
  const byId = new Map<string, CodexSessionIndexEntry>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed) as CodexSessionIndexEntry;
      const id = entry.id?.trim();
      if (!id) {
        continue;
      }
      const existing = byId.get(id);
      if (!existing || normalizeIso(entry.updated_at).localeCompare(normalizeIso(existing.updated_at)) >= 0) {
        byId.set(id, entry);
      }
    } catch {
      // Ignore malformed rows left by partial writes.
    }
  }
  return [...byId.values()];
}

async function readSessionMetadata(codexHome: string, ids: Set<string>): Promise<Map<string, CodexSessionMeta>> {
  const result = new Map<string, CodexSessionMeta>();
  if (ids.size === 0) {
    return result;
  }
  const files = await listSessionFiles(path.join(codexHome, "sessions"));
  for (const file of files) {
    if (result.size >= ids.size) {
      break;
    }
    const id = [...ids].find((candidate) => file.includes(candidate));
    if (!id || result.has(id)) {
      continue;
    }
    const meta = await readSessionMetaLine(file);
    if (meta) {
      result.set(id, meta);
    }
  }
  return result;
}

async function findSessionFiles(codexHome: string, threadId: string): Promise<string[]> {
  const files = await listSessionFiles(path.join(codexHome, "sessions"));
  const matches = files.filter((file) => path.basename(file).includes(threadId));
  if (!matches.length) return [];
  // A resumed desktop thread can have several rollout files with the same
  // thread id. Directory traversal starts at the oldest one.
  const dated = await Promise.all(matches.map(async file => ({file, mtime:(await fs.stat(file).catch(()=>null))?.mtimeMs ?? 0})));
  return dated.sort((a,b)=>a.mtime-b.mtime).map(row=>row.file);
}

const fileInventories = new Map<string, { expires: number; result: Promise<string[]> }>();

async function listSessionFiles(root: string): Promise<string[]> {
  const cached = fileInventories.get(root);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = scanSessionFiles(root);
  fileInventories.set(root, { expires: Date.now() + 5000, result });
  return result;
}

async function scanSessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

async function readSessionMetaLine(file: string): Promise<CodexSessionMeta | null> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(512 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0];
      const parsed = JSON.parse(firstLine) as { type?: string; payload?: CodexSessionMeta };
      if (parsed.type === "session_meta" && parsed.payload) {
        return parsed.payload;
      }
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIso(value?: string): string {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
}

function latestIso(left: string, right?: string): string {
  return normalizeIso(left).localeCompare(normalizeIso(right)) >= 0 ? normalizeIso(left) : normalizeIso(right);
}

function meaningfulStoredTitle(title: string): boolean {
  const normalized = title.trim();
  return normalized !== "" && normalized !== "新对话" && !normalized.startsWith("对话 · ");
}

function eventFromCodexSessionLine(line: string, threadId: string): GatewayEvent | null {
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  const record = readRecord(row);
  const type = readString(record?.type);
  const payload = readRecord(record?.payload);
  if (!payload) {
    return null;
  }

  if (type === "event_msg" && readString(payload.type) === "user_message") {
    const reply=desktopQuestionReply(readString(payload.message)??'');
    if(reply)return {type:'user.message',threadId,text:reply.text,questionReplyId:reply.callId,userVisible:true};
    const text = visibleLegacyUserText(readString(payload.message) ?? "");
    return text ? { type: "user.message", threadId, ...splitDesktopAttachments(text), userVisible: true } : null;
  }

  if (type === "event_msg" && readString(payload.type) === "agent_message") {
    const text = readString(payload.message)?.trim();
    if (text && isInjectedContext(text)) {
      return null;
    }
    return text ? { type: "message.delta", threadId, text } : null;
  }

  if(type==='event_msg') {
    const kind=readString(payload.type);
    if(kind==='task_started') return {type:'turn.started',threadId,turnId:readString(payload.turn_id)};
    if(kind==='task_complete'||kind==='task_completed'||kind==='turn_aborted') return {type:'turn.completed',threadId,status:kind==='turn_aborted'?'interrupted':'completed'};
    if(kind==='context_compacted'||kind==='context_compaction') return {type:'context.compaction',threadId,title:'压缩上下文',status:'ok'};
    if(kind==='exec_command_begin') return {type:'tool.started',threadId,itemId:readString(payload.call_id),title:'执行命令',detail:Array.isArray(payload.command)?payload.command.join(' '):readString(payload.command)};
    if(kind==='exec_command_end') return {type:'tool.completed',threadId,itemId:readString(payload.call_id),status:payload.exit_code===0?'ok':'error',detail:readString(payload.aggregated_output)?.slice(-12000)};
  }

  if (type !== "response_item") {
    return null;
  }
  if(['function_call','custom_tool_call'].includes(String(payload.type))){
    const name=readString(payload.name)||'执行工具';
    if(name==='request_user_input_async'){
      const callId=readString(payload.call_id);
      const detail=desktopQuestionDetail(readString(payload.arguments)||readString(payload.input)||'');
      return callId&&detail?{type:'approval.requested',threadId,approvalId:`desktop-question:${callId}`,approvalType:'question',title:'需要你的回答',detail}:null;
    }
    const title=/view_image|imageview/i.test(name)?'查看图片':/apply_patch|edit_file|write_file/i.test(name)?'编辑文件':name;
    return {type:'tool.started',threadId,itemId:readString(payload.call_id),title,detail:(readString(payload.arguments)||readString(payload.input)||'').slice(0,12000)};
  }
  if(['function_call_output','custom_tool_call_output'].includes(String(payload.type)))return {type:'tool.completed',threadId,itemId:readString(payload.call_id),status:'ok',detail:(readString(payload.output)||'').slice(-12000)};
  if(readString(payload.type)==='reasoning') {
    const summary=Array.isArray(payload.summary)?payload.summary.map(item=>readString(readRecord(item)?.text)||'').join('\n'):'';
    return summary?{type:'reasoning.summary',threadId,text:summary}:null;
  }
  if (readString(payload.type) !== "message") {
    return null;
  }
  const role = readString(payload.role);
  if (role !== 'user' && role !== 'assistant') return null;
  if(readString(payload.channel)==='analysis' || readString(payload.phase)==='analysis')return null;
  const reply=role==='user'?desktopQuestionReply(contentText(payload.content)):null;
  if(reply)return {type:'user.message',threadId,text:reply.text,questionReplyId:reply.callId,userVisible:true};
  const text = role === 'user' ? visibleUserContent(payload) : contentText(payload.content).trim();
  if (!text || (role === 'assistant' && isInjectedContext(text))) return null;
  if (role === "user") {
    const request = splitDesktopAttachments(text);
    return { type: "user.message", threadId, ...request, userVisible: true };
  }
  if (role === "assistant") {
    return { type: "message.delta", threadId, text };
  }
  return null;
}

function desktopQuestionDetail(input:string):string|null {
  try{
    const data=JSON.parse(input);
    if(!Array.isArray(data.questions)||data.questions.length<1||data.questions.length>3)return null;
    const questions=data.questions.map((item:unknown,index:number)=>{
      const row=readRecord(item);
      const title=readString(row?.title)||readString(row?.question);
      if(!title)return null;
      const options=Array.isArray(row?.options)?row.options.map((value:unknown)=>typeof value==='string'?{label:value}:readRecord(value)).filter(Boolean):[];
      return {id:String(index),question:title,options};
    });
    return questions.every(Boolean)?JSON.stringify({questions}):null;
  }catch{return null;}
}

function desktopQuestionReply(input:string):{callId:string;text:string}|null {
  const match=/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/i.exec(input.trim());
  if(!match)return null;
  try{
    const rows=JSON.parse(match[1]);
    if(!Array.isArray(rows)||!rows.length)return null;
    const first=readRecord(rows[0]);
    const identity=JSON.parse(readString(first?.questionItemId)||'');
    const callId=Array.isArray(identity)&&identity[0]==='request_user_input_async'?readString(identity[1]):undefined;
    const answers=rows.map((row:unknown)=>readString(readRecord(row)?.answer)).filter((answer):answer is string=>!!answer);
    return callId&&answers.length?{callId,text:answers.join('\n')}:null;
  }catch{return null;}
}

export function pendingDesktopQuestions(threadId:string,events:GatewayEvent[],storedEvents:GatewayEvent[]=[],resolvedApprovalIds:string[]=[]):PendingApproval[] {
  const resolved=new Set(resolvedApprovalIds);
  const open=new Map<string,Extract<GatewayEvent,{type:'approval.requested'}>>();
  for(const event of events){
    if(event.type==='approval.requested'&&event.approvalType==='question'&&event.approvalId?.startsWith('desktop-question:'))open.set(event.approvalId,event);
    if(event.type==='user.message'){
      if(event.questionReplyId)open.delete(`desktop-question:${event.questionReplyId}`);
      else open.clear();
    }
    if(event.type==='approval.resolved')open.delete(event.approvalId);
  }
  for(const event of storedEvents)if(event.type==='approval.resolved')resolved.add(event.approvalId);
  return [...open.values()].filter(event=>!resolved.has(event.approvalId!))
    .map(event=>({id:event.approvalId!,rpcId:event.approvalId!,method:'desktop/request_user_input_async',threadId,approvalType:'question' as const,title:event.title,detail:event.detail,status:'pending' as const,createdAt:event.createdAt||new Date().toISOString()}));
}

export function splitDesktopAttachments(text: string): {text:string;attachments?:{name:string;path:string}[]} {
  const wrapper=/^# Files mentioned by the user:\s*\n([\s\S]*?)\n## My request(?: for Codex)?:\s*\n([\s\S]*)$/i.exec(text);
  const attachments=wrapper?[...wrapper[1].matchAll(/^## (.+?): ([^\r\n]+)$/gm)].map(match=>({name:match[1],path:match[2]})):[];
  let message=wrapper?wrapper[2]:text;
  message=message.replace(/<image\s+name=(?:\[([^\]\r\n]+)\]|"([^"\r\n]+)")\s+path="([^"\r\n]+)"\s*>\s*(?:<\/image>)?/gi,(_whole,_bracket:string,_quoted:string,file:string)=>{
    attachments.push({name:_bracket||_quoted||path.basename(file),path:file});
    return '';
  }).trim();
  message=stripAmbientBrowserContext(message);
  const seen=new Set<string>();
  const unique=attachments.filter(file=>{const key=file.path.replace(/\\/g,'/').toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
  return unique.length?{text:message,attachments:unique}:{text:message};
}

function stripAmbientBrowserContext(input:string):string {
  let removed=false;
  let text=input.replace(/<in-app-browser-context source="ambient-ui-state">([\s\S]*?)<\/in-app-browser-context>\s*/gi,(whole,body:string)=>{
    if(!body.includes('This block is automatically supplied ambient UI state'))return whole;
    removed=true;return '';
  }).trim();
  if(removed)text=text.replace(/^## My request(?: for Codex)?:\s*/i,'');
  return text.trim();
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      const record = readRecord(item);
      return readString(record?.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function isInjectedContext(text: string): boolean {
  return text.includes("<codex_internal_context") ||
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("<app-context>") ||
    text.startsWith("<collaboration_mode>") ||
    text.startsWith("<skills_instructions>") ||
    text.startsWith("<plugins_instructions>");
}

function isInternalContentKind(kind: string): boolean {
  return kind.endsWith('.instructions') || kind === 'plugins.recommendations' ||
    kind === 'environments.environment_context';
}

function visibleUserContent(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const metadata = readRecord(payload.internal_chat_message_metadata_passthrough);
  const kinds = Array.isArray(metadata?.content_item_kinds) ? metadata.content_item_kinds : [];
  // Desktop labels each content item, including user-role instruction/context
  // items. Use that provenance before inspecting text that a user may quote.
  if (kinds.length === content.length && kinds.every(kind => typeof kind === 'string')) {
    return content.map((item, index) => {
      const kind = kinds[index] as string;
      const text = readString(readRecord(item)?.text) ?? '';
      if (isInternalContentKind(kind)) return '';
      return kind.startsWith('user.') ? visibleDesktopUserText(text) : visibleLegacyUserText(text);
    }).filter(Boolean).join('\n').trim();
  }
  if (kinds.length && kinds.every(kind => typeof kind === 'string' && isInternalContentKind(kind))) return '';
  return visibleLegacyUserText(contentText(content));
}

function visibleDesktopUserText(input: string): string {
  const text = input.trim();
  // Desktop records an interruption notice as a user-role item. It is a
  // control marker, not a message composed by the user.
  if (/^<turn_aborted>\s*The user interrupted the previous turn on purpose\.[\s\S]*?<\/turn_aborted>\s*$/i.test(text)) return '';
  return text;
}

function visibleLegacyUserText(input: string): string {
  let text = visibleDesktopUserText(input);
  let removed = false;
  // Older rollouts have no content provenance. Remove complete, known context
  // wrappers from the prefix while retaining a real request that follows them.
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
  if (isInjectedContext(text) || /^<recommended_plugins\b/i.test(text)) return '';
  return text.trim();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
