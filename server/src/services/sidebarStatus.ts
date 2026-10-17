import type {ThreadRecord} from '../types.js';

type Entry={source:string;sourceStatus:ThreadRecord['status'];revision:number;at:number;status:ThreadRecord['status'];pending?:Promise<void>};
export class SidebarStatusCache {
  private entries=new Map<string,Entry>();
  read(thread:Pick<ThreadRecord,'id'|'status'|'updatedAt'>,refresh:()=>Promise<string>):ThreadRecord['status']{
    const source=JSON.stringify([thread.updatedAt,thread.status]);
    let entry=this.entries.get(thread.id);
    if(!entry){entry={source,sourceStatus:thread.status,revision:0,at:0,status:thread.status};this.entries.set(thread.id,entry);}
    else if(entry.source!==source){
      if(entry.sourceStatus!==thread.status)entry.at=0;
      entry.source=source;entry.sourceStatus=thread.status;entry.revision++;entry.status=thread.status;
    }
    if(!entry.pending&&Date.now()-entry.at>=5000){
      const target=entry,revision=entry.revision;
      // Streaming timestamps invalidate stale results without restarting the
      // status-check interval. Actual lifecycle changes still recheck at once.
      target.at=Date.now();
      // Updated metadata invalidates the result, not the work already in flight.
      target.pending=Promise.resolve().then(refresh).then(status=>{if(target.revision===revision)target.status=status as ThreadRecord['status'];})
        .catch(()=>{}).finally(()=>{if(target.revision===revision)target.at=Date.now();target.pending=undefined;});
    }
    while(this.entries.size>1000)this.entries.delete(this.entries.keys().next().value!);
    return entry.status;
  }
}
