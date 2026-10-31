import type {GatewayEvent} from '../types.js';
import {summarizeFileChanges} from './fileChanges.js';
import {deferMobileActivityDetails,mobileDeferredActivityTypes,type DeferredActivityEvent} from './codexSessions.js';

export class MobileActivityHistory {
  private readonly groups=new Map<string,{threadId:string;events:(GatewayEvent|DeferredActivityEvent)[]}>();
  compact(events:GatewayEvent[]):(GatewayEvent|DeferredActivityEvent)[] {
    const result:(GatewayEvent|DeferredActivityEvent)[]=[],group:GatewayEvent[]=[];
    const flush=()=>{
      if(!group.length)return;
      const first=group[0],last=group.at(-1)!;
      if(!first.eventId||!last.eventId||!('threadId' in first)||!first.threadId){result.push(...group);group.length=0;return;}
      const id=first.eventId+'|'+last.eventId;
      const operations=new Set(group.map(event=>('itemId' in event?event.itemId:undefined)||event.eventId));
      const failed=group.some(event=>'status' in event&&event.status==='error');
      const deferred=group.map(deferMobileActivityDetails);
      // The same short reasoning title is already sent when a group is opened.
      // Keep it in the compact row so showing it does not load operation bodies.
      const summary=[...deferred].reverse().find(event=>event.type==='reasoning.summary'&&'title' in event&&event.title?.trim()) as DeferredActivityEvent|undefined;
      this.groups.delete(id);
      this.groups.set(id,{threadId:first.threadId,events:deferred});
      while(this.groups.size>500)this.groups.delete(this.groups.keys().next().value!);
      // Per-event metadata already contains parsed counts; do not rescan full patches for the group.
      result.push({...deferred[0],fileChanges:summarizeFileChanges(deferred),activityGroupId:id,activitySummary:summary?.title?.trim()||`处理过程 · ${operations.size} 项操作`,activityCount:operations.size,...(failed?{status:'error'}:{})} as DeferredActivityEvent);
      group.length=0;
    };
    for(const event of events){if(mobileDeferredActivityTypes.has(event.type))group.push(event);else{flush();result.push(event);}}
    flush();return result;
  }
  group(threadId:string,id:string):(GatewayEvent|DeferredActivityEvent)[]|undefined {
    const group=this.groups.get(id);
    return group?.threadId===threadId?group.events:undefined;
  }
}
