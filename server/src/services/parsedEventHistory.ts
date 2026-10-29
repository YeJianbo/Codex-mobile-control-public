import type {DatabaseSync,StatementSync} from 'node:sqlite';
import type {GatewayEvent} from '../types.js';

type HistoryTable='codex_live_events'|'agent_history';
type CachedHistory={events:GatewayEvent[];snapshots:Map<string,number>;bytes:number;lastSeq:number;dirty:boolean};
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
    // Stream database rows: a long turn can contain hundreds of MB of replaced
    // diff snapshots. Materializing every payload before parsing multiplies RAM.
    const snapshots=new Map(cached?.snapshots),positions=new Map<string,number>();
    let bytes=cached?.bytes??0,lastSeq=cached?.lastSeq??0;
    const events:(GatewayEvent|undefined)[]=cached?.events.slice()??[];
    events.forEach((event,index)=>{if(event?.type==='diff.updated'&&event.turnId)positions.set(event.turnId,index);});
    for(const row of statement.iterate(threadId,lastSeq) as Iterable<{seq:number;payload:string}>){
      const event=JSON.parse(row.payload) as GatewayEvent,size=Buffer.byteLength(row.payload);
      if(event.type==='diff.updated'&&event.turnId){
        const previous=positions.get(event.turnId);
        if(previous!==undefined){events[previous]=undefined;bytes-=snapshots.get(event.turnId)!;}
        positions.set(event.turnId,events.length);snapshots.set(event.turnId,size);
      }
      bytes+=size;events.push(event);lastSeq=row.seq;
    }
    // A diff replaces the same turn's previous snapshot. Full originals remain
    // on disk for exact event-ID reads; message and tool fragments stay intact.
    const retained=events.filter((event):event is GatewayEvent=>event!==undefined);
    if(cached)this.evict(key);
    if(!transactional&&bytes<=maxBytes){
      while(this.reads.size&&(this.reads.size>=maxThreads||this.bytes+bytes>maxBytes))this.evict(this.reads.keys().next().value!);
      this.reads.set(key,{events:retained,snapshots,bytes,lastSeq,dirty:false});this.bytes+=bytes;
    }
    // Extending the private cache cannot change an earlier caller's array.
    return retained.slice();
  }
}
