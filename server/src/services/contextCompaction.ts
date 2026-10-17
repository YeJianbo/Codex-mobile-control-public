import type {GatewayEvent} from '../types.js';
import {canonicalCompactionText,reconcileCompactionRecords} from '../../public/compaction-events.js';
export {canonicalCompactionText} from '../../public/compaction-events.js';

const handoffPrefix='Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:';

export function compactionSummary(message:unknown):string {
  if(typeof message!=='string')return '';
  const text=message.trim();
  return (text.startsWith(handoffPrefix)?text.slice(handoffPrefix.length):text).trim();
}

export function foldCompactionSummaries(events:GatewayEvent[]):GatewayEvent[] {
  const hidden=new Set<GatewayEvent>();
  const restored=new Map<GatewayEvent,GatewayEvent>();
  for(let i=0;i<events.length;i++){
    const compact=events[i];
    if(compact.type!=='context.compaction'||!compact.text)continue;
    const summary=canonicalCompactionText(compact.text);
    for(let j=i-1;j>=0;j--){
      const event=events[j];
      if('threadId' in event&&event.threadId!==compact.threadId)continue;
      if(['user.message','turn.started','context.compaction'].includes(event.type))break;
      if(event.type!=='message.delta')continue;
      const fragments=[event];
      let start=j;
      if(!event.textComplete&&event.itemId)while(start>0){
        const prior=events[start-1];
        if(prior.type!=='message.delta'||prior.threadId!==event.threadId||prior.itemId!==event.itemId||prior.textComplete)break;
        fragments.unshift(prior);start--;
      }
      const original=fragments.map(row=>row.text).join('');
      if(canonicalCompactionText(original)===summary){
        fragments.forEach(row=>hidden.add(row));
        // Native compaction also truncates at an unclosed citation token used
        // literally in the summary. Keep the complete source inside the fold;
        // older mobile clients can then match and hide their live copy too.
        if(original.includes('<oai-mem-citation>')&&!original.includes('</oai-mem-citation>')&&original.trim().startsWith(compact.text.trim()))
          restored.set(compact,{...compact,text:original});
      }
      // Only the last assistant output can be the generated handoff.
      break;
    }
  }
  return reconcileCompactionRecords(hidden.size?events.filter(event=>!hidden.has(event)).map(event=>restored.get(event)??event):events);
}
