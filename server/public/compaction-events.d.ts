type CompactionEvent = {
  type:string;threadId?:string;eventId?:string;itemId?:string;turnId?:string;
  createdAt?:string;status?:string;text?:string;detail?:string;
};
export function canonicalCompactionText(text?:string):string;
export function sameCompaction(left:CompactionEvent,right:CompactionEvent):boolean;
export function identifyCompactionMarkers<T extends CompactionEvent>(incoming:T[],previous?:T[]):T[];
export function reconcileCompactionRecords<T extends CompactionEvent>(events:T[]):T[];
