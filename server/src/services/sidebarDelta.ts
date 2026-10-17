import {randomUUID} from 'node:crypto';

type Snapshot={revision:string;json:string;body:Record<string,any>};
const collectionKey=(name:string,row:any)=>name==='threads'?row.id:JSON.stringify([row.id,row.path]);

// A missed/expired revision falls back to a complete page, including deletions.
export class SidebarDeltaCache {
  private pages=new Map<string,Snapshot[]>();
  reply(scope:string,body:Record<string,any>,collections:string[],since?:string):Record<string,any>{
    const json=JSON.stringify(body);
    if(json.length>1024*1024)return body;
    let snapshots=this.pages.get(scope)||[];
    let current=snapshots.at(-1);
    const previous=snapshots.find(snapshot=>snapshot.revision===since);
    if(!current||current.json!==json){
      current={revision:randomUUID(),json,body:JSON.parse(json)};
      snapshots=[...snapshots.slice(-3),current];
    }
    this.pages.delete(scope);this.pages.set(scope,snapshots);
    while(this.pages.size>64)this.pages.delete(this.pages.keys().next().value!);
    if(!previous)return {...body,sidebarRevision:current.revision};
    const changed:Record<string,any[]>={},removed:Record<string,string[]>={},order:Record<string,string[]>={};
    const metadata={...body};
    for(const name of collections){
      delete metadata[name];
      if(previous===current)continue;
      const before:any[]=previous.body[name]||[],after:any[]=body[name]||[];
      const old=new Map(before.map(row=>[collectionKey(name,row),JSON.stringify(row)]));
      const keys=after.map(row=>collectionKey(name,row)),present=new Set(keys);
      const updates=after.filter(row=>old.get(collectionKey(name,row))!==JSON.stringify(row));
      const deletions=[...old.keys()].filter(key=>!present.has(key));
      if(updates.length)changed[name]=updates;
      if(deletions.length)removed[name]=deletions;
      if(JSON.stringify([...old.keys()])!==JSON.stringify(keys))order[name]=keys;
    }
    return {...metadata,sidebarRevision:current.revision,sidebarBase:since,sidebarDelta:true,changed,removed,order};
  }
}
