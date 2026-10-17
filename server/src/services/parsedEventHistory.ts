import type {DatabaseSync,StatementSync} from 'node:sqlite';
import type {GatewayEvent} from '../types.js';

type HistoryTable='codex_live_events'|'agent_history';
type CachedHistory={events:GatewayEvent[];bytes:number;lastSeq:number;dirty:boolean};
const maxBytes=32*1024*1024,maxThreads=24;

/** One parsed-history budget for all harnesses; SQLite remains the source of truth. */
export class ParsedEventHistory {
  private readonly reads=new Map<string,CachedHistory>();
  private readonly statements=new Map<HistoryTable,StatementSync>();
  private bytes=0;
  constructor(private readonly db:DatabaseSync){}

  markDirty(table:HistoryTable,threadId:string):void{
    const cached=this.reads.get(`${table}:${threadId}`);if(cached)cached.dirty=true;
  }
  invalidate(table:HistoryTable,threadId:string):void{this.evict(`${table}:${threadId}`);}
  private evict(key:string):void{
    const cached=this.reads.get(key);if(cached)this.bytes-=cached.bytes;
    this.reads.delete(key);
  }
  read(table:HistoryTable,threadId:string):GatewayEvent[]{
    // A transaction-local view may contain uncommitted inserts or deletes.
    // Never let a rollback leave that view in the shared parsed cache.
    const transactional=this.db.isTransaction,key=`${table}:${threadId}`;
    const cached=transactional?undefined:this.reads.get(key);
    if(cached&&!cached.dirty){this.reads.delete(key);this.reads.set(key,cached);return cached.events.slice();}
    let statement=this.statements.get(table);
    if(!statement){
      statement=this.db.prepare(`SELECT seq,payload FROM ${table} WHERE thread_id=? AND seq>? ORDER BY seq`);
      this.statements.set(table,statement);
    }
    const rows=statement.all(threadId,cached?.lastSeq??0) as {seq:number;payload:string}[];
    const additions=rows.map(row=>JSON.parse(row.payload) as GatewayEvent);
    const bytes=(cached?.bytes??0)+rows.reduce((total,row)=>total+Buffer.byteLength(row.payload),0);
    const events=cached?.events??[];
    for(const event of additions)events.push(event);
    if(cached)this.evict(key);
    if(!transactional&&bytes<=maxBytes){
      while(this.reads.size&&(this.reads.size>=maxThreads||this.bytes+bytes>maxBytes))this.evict(this.reads.keys().next().value!);
      this.reads.set(key,{events,bytes,lastSeq:rows.at(-1)?.seq??cached?.lastSeq??0,dirty:false});this.bytes+=bytes;
    }
    // Extending the private cache cannot change an earlier caller's array.
    return events.slice();
  }
}
