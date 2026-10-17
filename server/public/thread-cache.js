import {mergeEvents,retainCompleteConversationEvents} from './console-core.js';

const arrayOverhead=32;
// The active view is retained; only inactive conversation snapshots share this budget.
export class BoundedLruMap extends Map {
  constructor(maxEntries){super();this.maxEntries=maxEntries;}
  get(key){const value=super.get(key);if(super.has(key)){super.delete(key);super.set(key,value);}return value;}
  set(key,value){super.delete(key);super.set(key,value);while(this.size>this.maxEntries)super.delete(this.keys().next().value);return this;}
}
export class ThreadEventCache extends Map {
  constructor(active=()=>null,maxEntries=8,maxBytes=12*1024*1024){super();this.active=active;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.weights=new Map();this.eventIndexes=new Map();}
  get(key){const value=super.get(key);if(value!==undefined){super.delete(key);super.set(key,value);}return value;}
  set(key,value,knownBytes){this.delete(key);if(key!==this.active()){const bytes=knownBytes??this.weight(value);if(bytes>this.maxBytes)return this;this.weights.set(key,bytes);}super.set(key,value);this.prune();return this;}
  delete(key){this.weights.delete(key);this.eventIndexes.delete(key);return super.delete(key);}
  clear(){this.weights.clear();this.eventIndexes.clear();super.clear();}
  append(key,event,limit=10000){
    const previous=this.get(key)||[];
    let base=previous,index=this.eventIndexes.get(key);
    if(index?.source!==previous){
      const normalized=mergeEvents(previous,[]);
      if(normalized.length!==previous.length)base=normalized;
      index={source:base,ids:new Set(),submitted:new Set()};
      for(const row of base){
        if(row.eventId)index.ids.add(row.eventId);
        if(row.type==='user.message'&&row.requestId)index.submitted.add(`${row.threadId}:${row.requestId}`);
      }
    }
    const request=event.type==='user.message'&&event.requestId?`${event.threadId}:${event.requestId}`:undefined;
    if(event.eventId&&index.ids.has(event.eventId)||request&&index.submitted.has(request)){
      const retained=retainCompleteConversationEvents(base,limit);
      if(retained!==previous)this.set(key,retained);else this.prune();
      if(retained===base&&this.has(key))this.eventIndexes.set(key,index);
      return retained;
    }
    const next=[...base,event],retained=retainCompleteConversationEvents(next,limit);
    // Only a pure append can reuse the exact old weight. Replacements and trims
    // rebuild both weight and identity state from their current snapshot.
    const bytes=key!==this.active()&&retained===next&&base===previous&&this.weights.has(key)?
      this.weights.get(key)+this.weight([event])-arrayOverhead:undefined;
    if(event.eventId)index.ids.add(event.eventId);
    if(request)index.submitted.add(request);
    this.set(key,retained,bytes);
    if(retained===next&&this.has(key)){index.source=next;this.eventIndexes.set(key,index);}
    return retained;
  }
  weight(events){
    const pending=[events];let bytes=0;
    while(pending.length){
      const value=pending.pop();
      if(typeof value==='string')bytes+=value.length*2;
      else if(Array.isArray(value)){bytes+=arrayOverhead+value.length*8;if(bytes>this.maxBytes)return bytes;for(const item of value)pending.push(item);}
      else if(value&&typeof value==='object'){bytes+=256;for(const [key,item]of Object.entries(value)){bytes+=key.length*2+8;pending.push(item);}}
      else bytes+=8;
      if(bytes>this.maxBytes)return bytes;
    }
    return bytes;
  }
  prune(){const rows=[...this].filter(([key])=>key!==this.active()).map(([key,events])=>{let bytes=this.weights.get(key);if(bytes===undefined){bytes=this.weight(events);this.weights.set(key,bytes);}return [key,bytes];}).filter(([key,bytes])=>{if(bytes<=this.maxBytes)return true;this.delete(key);return false;});let bytes=rows.reduce((n,[,weight])=>n+weight,0),count=rows.length;
    for(const [key,weight] of rows){if(count<=this.maxEntries&&bytes<=this.maxBytes)break;this.delete(key);bytes-=weight;count--;}
  }
}
