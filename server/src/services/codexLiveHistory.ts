import type {DatabaseSync,StatementSync} from 'node:sqlite';
import type {GatewayEvent} from '../types.js';
import {ParsedEventHistory} from './parsedEventHistory.js';

// The reconnect ring is bounded by notifications, not messages. Keep a separate
// disk window so one long answer (or another busy thread) cannot evict its prefix.
export class CodexLiveHistory {
  private readonly insertEvent:StatementSync;
  private readonly updateWindow:StatementSync;
  constructor(private readonly db:DatabaseSync,private readonly history=new ParsedEventHistory(db)){
    db.exec(`CREATE TABLE IF NOT EXISTS codex_live_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_codex_live_thread ON codex_live_events(thread_id,seq);
      CREATE TABLE IF NOT EXISTS codex_live_windows (
      thread_id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0,
      updated_seq INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0);`);
    this.insertEvent=db.prepare('INSERT OR IGNORE INTO codex_live_events(event_key,thread_id,type,payload) VALUES (?,?,?,?)');
    this.updateWindow=db.prepare(`INSERT INTO codex_live_windows(thread_id,active,updated_seq,bytes) VALUES (?,?,?,?)
      ON CONFLICT(thread_id) DO UPDATE SET active=COALESCE(?,active),updated_seq=excluded.updated_seq,bytes=bytes+excluded.bytes`);
  }
  seed(events:GatewayEvent[]):void {
    const existing=new Set((this.db.prepare('SELECT thread_id FROM codex_live_windows').all() as {thread_id:string}[]).map(row=>row.thread_id));
    for(const event of events)if('threadId' in event&&!existing.has(event.threadId??''))this.append(event);
  }
  append(event:GatewayEvent,encoded?:string):void {
    if(!('threadId' in event)||!event.threadId||/^(antigravity-|claude-|grok-|deepseek-|hermes-|opencode-|zcode-|pi-|acp-|terminal:|cloud[:\-])/.test(event.threadId))return;
    const payload=encoded??JSON.stringify(event),id=event.threadId;
    const inserted=this.insertEvent.run(event.eventId||payload,id,event.type,payload);
    if(!inserted.changes)return;
    // Boundaries can trim the retained prefix. Other writes only dirty the
    // cached window; read committed rows later instead of caching inside a transaction.
    if(['user.message','turn.started'].includes(event.type))this.invalidateRead(id);
    else this.history.markDirty('codex_live_events',id);
    const active=['turn.started','message.delta','reasoning.summary'].includes(event.type)?1:event.type==='turn.completed'?0:
      event.type==='thread.started'&&event.thread?.status?Number(event.thread.status==='running'):null;
    this.updateWindow.run(id,active??0,inserted.lastInsertRowid,Buffer.byteLength(payload),active);
    // Thread updates include titles, polling and idle notifications. Only real
    // turn boundaries may advance the retained conversation window.
    if(['user.message','turn.started'].includes(event.type)){
      const start=event.type==='user.message'
        ?this.db.prepare("SELECT seq FROM codex_live_events WHERE thread_id=? AND type='user.message' ORDER BY seq DESC LIMIT 1 OFFSET 1").get(id) as {seq:number}|undefined
        :this.db.prepare("SELECT seq FROM codex_live_events WHERE thread_id=? AND type='turn.started' ORDER BY seq DESC LIMIT 1 OFFSET 1").get(id) as {seq:number}|undefined;
      if(start&&event.type!=='user.message'){
        const prior=this.db.prepare("SELECT seq FROM codex_live_events WHERE thread_id=? AND type='turn.started' ORDER BY seq DESC LIMIT 1 OFFSET 2").get(id) as {seq:number}|undefined;
        const user=this.db.prepare("SELECT seq FROM codex_live_events WHERE thread_id=? AND type='user.message' AND seq<=? ORDER BY seq DESC LIMIT 1").get(id,start.seq) as {seq:number}|undefined;
        // Automatic goal turns may have no new user message. Do not pull the
        // original prompt (and every intervening turn) back into the disk window.
        if(user&&(!prior||user.seq>prior.seq))start.seq=user.seq;
      }
      if(start)this.db.prepare('DELETE FROM codex_live_events WHERE thread_id=? AND seq<?').run(id,start.seq);
      this.db.prepare('UPDATE codex_live_windows SET bytes=COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM codex_live_events WHERE thread_id=?),0) WHERE thread_id=?').run(id,id);
    }
    if(['user.message','turn.started','thread.started','turn.completed'].includes(event.type))this.prune(id);
  }
  read(threadId:string):GatewayEvent[]{
    return this.history.read('codex_live_events',threadId);
  }
  private invalidateRead(threadId:string):void {
    this.history.invalidate('codex_live_events',threadId);
  }
  remove(threadId:string):void {
    this.invalidateRead(threadId);
    this.db.prepare('DELETE FROM codex_live_events WHERE thread_id=?').run(threadId);
    this.db.prepare('DELETE FROM codex_live_windows WHERE thread_id=?').run(threadId);
  }
  private prune(protectedId:string):void {
    const rows=this.db.prepare('SELECT thread_id,active,bytes FROM codex_live_windows ORDER BY updated_seq DESC').all() as {thread_id:string;active:number;bytes:number}[];
    let bytes=rows.reduce((sum,row)=>sum+row.bytes,0),idle=rows.filter(row=>!row.active).length;
    // Prune complete idle windows, never part of a running answer. Active turns
    // can exceed this disk-cache budget until they finish; they are not RAM copies.
    for(const row of [...rows].reverse())if(!row.active&&row.thread_id!==protectedId&&(idle>64||bytes>32*1024*1024)){
      this.invalidateRead(row.thread_id);
      this.db.prepare('DELETE FROM codex_live_events WHERE thread_id=?').run(row.thread_id);
      this.db.prepare('DELETE FROM codex_live_windows WHERE thread_id=?').run(row.thread_id);
      idle--;bytes-=row.bytes;
    }
  }
}
