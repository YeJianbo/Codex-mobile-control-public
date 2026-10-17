import type {GatewayEvent} from '../types.js';
import {summarizeFileChanges,type FileChangeSummary} from './fileChanges.js';

export const mobileDeferredActivityTypes=new Set(['tool.started','tool.output','tool.completed','reasoning.summary','file.changed','diff.updated','plan.updated']);
const liveDeferredTypes=new Set(['tool.started','tool.output','tool.completed','file.changed','diff.updated']);
export type DeferredActivityEvent={
  fileChanges?:FileChangeSummary[];
  type:'tool.started'|'tool.output'|'tool.completed'|'reasoning.summary'|'file.changed'|'diff.updated'|'plan.updated';
  threadId:string;eventId:string;createdAt?:string;itemId?:string;turnId?:string;requestId?:string;replayed?:boolean;subagent?:boolean;
  title?:string;status?:string;files?:string[];detailsDeferred:true;activityGroupId?:string;activitySummary?:string;activityCount?:number;
};
export function deferMobileActivityDetails(event:GatewayEvent):GatewayEvent|DeferredActivityEvent {
  if(!event.eventId||!mobileDeferredActivityTypes.has(event.type))return event;
  const value=event as GatewayEvent&{text?:string;detail?:string;title?:string;turnId?:string;itemId?:string};
  const title=value.title||(event.type==='reasoning.summary'?(value.text||value.detail||'').trim().split('\n')[0].slice(0,160):undefined);
  return {type:event.type as DeferredActivityEvent['type'],threadId:'threadId' in event?event.threadId!:'',eventId:event.eventId,createdAt:event.createdAt,
    itemId:value.itemId,turnId:value.turnId,requestId:event.requestId,replayed:event.replayed,subagent:event.subagent,
    title,status:'status' in event?event.status:undefined,files:event.type==='file.changed'?event.files:undefined,fileChanges:summarizeFileChanges([event]),detailsDeferred:true};
}
export function deferLiveActivityDetails(event:GatewayEvent):GatewayEvent|DeferredActivityEvent {
  return liveDeferredTypes.has(event.type)?deferMobileActivityDetails(event):event;
}
