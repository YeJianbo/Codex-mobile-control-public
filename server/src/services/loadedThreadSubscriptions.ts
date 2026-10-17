import type {CodexConnectionState} from '../codex/appServerClient.js';
import {assertControllableThread} from './cloudSnapshots.js';
import {threadAgent} from './agentProtocol.js';

type Client={
  request(method:string,params:unknown):Promise<unknown>;
  connectionState():CodexConnectionState;
  on(event:string,listener:(...args:any[])=>void):unknown;
  off(event:string,listener:(...args:any[])=>void):unknown;
};
type Options={canSubscribe?:(threadId:string)=>boolean|Promise<boolean>;onError?:(error:unknown,threadId?:string)=>void;concurrency?:number};
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;

/** Restore observation of already-loaded desktop threads after the gateway reconnects. */
export class LoadedThreadSubscriptions{
  private enabled=false;
  private closed=false;
  private generation?:number;
  private epoch=0;
  private subscribed=new Set<string>();
  private running?:{epoch:number};
  private concurrency:number;
  private readonly ready=()=>this.start();
  private readonly disconnected=()=>{this.epoch++;this.running=undefined;};
  constructor(private codex:Client,private options:Options={}){
    this.concurrency=Math.max(1,Math.min(8,Math.floor(options.concurrency??2)||2));
    codex.on('ready',this.ready);codex.on('exit',this.disconnected);
  }
  setEnabled(enabled:boolean){
    if(this.closed||this.enabled===enabled)return;
    this.enabled=enabled;
    if(enabled)this.start();else{this.epoch++;this.running=undefined;}
  }
  status(){
    const state=this.codex.connectionState();
    return {connected:state.shared&&state.initialized,watchingThreads:this.subscribed.size,restoring:Boolean(this.running)};
  }
  close(){
    if(this.closed)return;
    this.closed=true;this.enabled=false;this.epoch++;this.running=undefined;
    this.codex.off('ready',this.ready);this.codex.off('exit',this.disconnected);
  }
  private current(epoch:number,generation:number){
    const state=this.codex.connectionState();
    return !this.closed&&this.enabled&&this.epoch===epoch&&state.shared&&state.initialized&&state.generation===generation;
  }
  private start(){
    if(!this.enabled||this.closed)return;
    const state=this.codex.connectionState();
    if(!state.shared||!state.initialized)return;
    if(this.generation!==state.generation){this.generation=state.generation;this.subscribed.clear();this.epoch++;this.running=undefined;}
    if(this.running?.epoch===this.epoch)return;
    const run={epoch:this.epoch};this.running=run;
    void Promise.resolve().then(()=>this.scan(run.epoch,state.generation)).catch(error=>{
      if(this.current(run.epoch,state.generation))this.options.onError?.(error);
    }).finally(()=>{if(this.running===run)this.running=undefined;});
  }
  private async eligible(threadId:string){
    try{assertControllableThread(threadId);}catch{return false;}
    return threadAgent(threadId)==='codex'&&(this.options.canSubscribe?await this.options.canSubscribe(threadId):true);
  }
  private async scan(epoch:number,generation:number){
    let cursor:string|null=null;
    const cursors=new Set<string>(),seen=new Set<string>();
    while(this.current(epoch,generation)){
      const page=record(await this.codex.request('thread/loaded/list',{cursor,limit:100}));
      if(!this.current(epoch,generation))return;
      if(!Array.isArray(page?.data)||!page.data.every(id=>typeof id==='string'))throw Error('共享后端未返回有效的已加载会话列表');
      const ids=(page.data as string[]).filter(id=>{if(!id||seen.has(id)||this.subscribed.has(id))return false;seen.add(id);return true;});
      let next=0;
      const worker=async()=>{
        while(this.current(epoch,generation)&&next<ids.length){
          const id=ids[next++];
          try{
            if(!await this.eligible(id)||!this.current(epoch,generation))continue;
            // A page may outlive an idle unload. Recheck immediately before rejoining.
            const result=record(await this.codex.request('thread/read',{threadId:id,includeTurns:false}));
            if(!this.current(epoch,generation))return;
            const status=record(result?.thread)?.status;
            const type=typeof status==='string'?status:record(status)?.type;
            if(!['active','idle','systemError'].includes(String(type))||!await this.eligible(id)||!this.current(epoch,generation))continue;
            await this.codex.request('thread/resume',{threadId:id,excludeTurns:true});
            if(this.current(epoch,generation))this.subscribed.add(id);
          }catch(error){if(this.current(epoch,generation))this.options.onError?.(error,id);}
        }
      };
      await Promise.all(Array.from({length:Math.min(this.concurrency,ids.length)},worker));
      if(!this.current(epoch,generation))return;
      const nextCursor=page?.nextCursor;
      if(typeof nextCursor!=='string'||!nextCursor)return;
      if(cursors.has(nextCursor))throw Error('共享后端已加载会话分页游标重复');
      cursors.add(nextCursor);cursor=nextCursor;
    }
  }
}
