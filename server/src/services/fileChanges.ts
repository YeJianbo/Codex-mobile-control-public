export type FileChangeSummary={path:string;added?:number;removed?:number};
type EditEvent={type:string;itemId?:string;detail?:string;status?:string;fileChanges?:FileChangeSummary[]};
export function confirmedToolChanges<T extends EditEvent>(events:readonly T[]):T[]{
  const pending=new Map<string,string>();
  return events.map(event=>{
    if(event.type==='tool.started'&&event.itemId&&event.detail?.includes('*** Begin Patch'))pending.set(event.itemId,event.detail);
    const patch=event.itemId?pending.get(event.itemId):undefined;
    if(event.type!=='tool.completed'||!patch||event.status==='error'||/apply_patch verification failed|Script (?:failed|error)|Failed to find expected|"isError"\s*:\s*true/i.test(event.detail??''))return event;
    const fileChanges=summarizeFileChanges([{type:'diff.updated',diff:patch}]);
    return {...event,fileChanges};
  });
}
export function summarizeFileChanges(events:readonly {type:string;files?:unknown[];diff?:string;itemId?:string;fileChanges?:FileChangeSummary[]}[]):FileChangeSummary[]{
  const result=new Map<string,FileChangeSummary>();
  const remember=(file:FileChangeSummary)=>{
    const previous=result.get(file.path);
    result.set(file.path,{...file,added:file.added??previous?.added,removed:file.removed??previous?.removed});
  };
  for(const event of events){
    for(const file of event.fileChanges??[])remember(file);
    if(event.type!=='file.changed'&&event.type!=='diff.updated')continue;
    for(const file of event.files??[])if(typeof file==='string'&&!result.has(file))result.set(file,{path:file});
    let current:string|undefined,hunk=false;
    const parsed=new Map<string,FileChangeSummary>();
    const diff=event.diff??'';
    let lf=diff.indexOf('\n'),cr=diff.indexOf('\r');
    for(let start=0;start<diff.length;){
      const end=lf<0?(cr<0?diff.length:cr):cr<0?lf:Math.min(lf,cr);
      const offset=start;start=end+1;
      // Keep both cursors moving forward; CR-only input must not rescan each remaining suffix.
      if(lf===end)lf=diff.indexOf('\n',start);
      if(cr===end){
        cr=diff.indexOf('\r',start);
        if(lf===start){start++;lf=diff.indexOf('\n',start);}
      }
      const line=diff.startsWith('+++ ',offset)||diff.startsWith('*** ',offset)?diff.slice(offset,end):'';
      const header=line?(/^\+\+\+ (?:b\/)?(.+)$/.exec(line)||/^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line)):null;
      if(header){current=header[1];hunk=line.startsWith('*** Add File:');if(current!=='/dev/null')parsed.set(current,line.startsWith('*** Delete File:')?{path:current}:{path:current,added:0,removed:0});continue;}
      if(diff.startsWith('@@',offset)){hunk=true;continue;}
      const file=current?parsed.get(current):undefined;
      if(file&&hunk){if(diff[offset]==='+')file.added!++;else if(diff[offset]==='-')file.removed!++;}
    }
    // A diff event is a replacement snapshot, never add repeated snapshots together.
    for(const file of parsed.values())remember(file);
  }
  return [...result.values()];
}
