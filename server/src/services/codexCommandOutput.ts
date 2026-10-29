import type {GatewayEvent} from '../types.js';

type PendingOutput={threadId:string;itemId?:string;parts:string[];length:number};

/** Merge transport fragments before persisting/publishing, preserving tool boundaries. */
export class CodexCommandOutput {
  private pending?:PendingOutput;
  private timer?:NodeJS.Timeout;
  constructor(private readonly publish:(event:GatewayEvent)=>void,private readonly intervalMs=100){}
  append(threadId:string,itemId:string|undefined,text:string):void {
    if(!text)return;
    if(this.pending&&(this.pending.threadId!==threadId||this.pending.itemId!==itemId||this.pending.length+text.length>32768))this.flush();
    if(text.length>=32768){this.emit(threadId,itemId,text);return;}
    if(!this.pending){
      this.pending={threadId,itemId,parts:[],length:0};
      this.timer=setTimeout(()=>this.flush(),this.intervalMs);this.timer.unref();
    }
    this.pending.parts.push(text);this.pending.length+=text.length;
  }
  flush():void {
    if(this.timer){clearTimeout(this.timer);this.timer=undefined;}
    const pending=this.pending;this.pending=undefined;
    if(pending)this.emit(pending.threadId,pending.itemId,pending.parts.join(''));
  }
  private emit(threadId:string,itemId:string|undefined,text:string):void {
    this.publish({type:'terminal.output',threadId,stream:'stdout',text});
    this.publish({type:'tool.output',threadId,itemId,text});
  }
}
