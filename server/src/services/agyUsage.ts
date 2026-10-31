import type {execa} from 'execa';
import {agyProcess} from './agyProcess.js';

type Window={name:string;durationMins:number|null;remainingPercent:number;resetsAt:number|null;family:'gemini'|'third-party'|undefined};
type Snapshot={windows:Window[];updatedAt:string|null;source:string;stale:boolean};
export function agyQuotaWindows(record:any):Window[]{
  if(record?.status!=='SUCCESS'||record?.command?.name!=='usage'||!Array.isArray(record.command.data?.groups))throw Error('AGY 未返回有效额度');
  return record.command.data.groups.flatMap((group:any)=>{
    const description=String(group.name||'')+' '+String(group.description||'');
    const family=/gemini/i.test(description)?'gemini':/claude|gpt/i.test(description)?'third-party':undefined;
    return (Array.isArray(group.buckets)?group.buckets:[]).flatMap((bucket:any)=>{
      const fraction=bucket.remaining_fraction;
      if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1)return [];
      const interval=/^(\d+)(m|h|d|w)$/.exec(bucket.window||'');
      const durationMins=bucket.window==='weekly'?10080:interval?Number(interval[1])*({m:1,h:60,d:1440,w:10080}[interval[2]]!):null;
      const reset=typeof bucket.reset_time==='string'?Date.parse(bucket.reset_time):NaN;
      return [{name:group.name||'Antigravity',durationMins,remainingPercent:fraction*100,resetsAt:Number.isFinite(reset)?Math.floor(reset/1000):null,family}];
    });
  });
}

export class AgyUsageReader {
  private cached:Snapshot={windows:[],updatedAt:null,source:'antigravity',stale:true};
  private readAt=0;
  private pending?:Promise<void>;
  constructor(private command:()=>Promise<string>,private discover:typeof execa){}
  private refresh(){
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      try{
        // A read-only slash command: no agent turn, conversation, or quota consumption.
        const target=agyProcess(await this.command(),['-p','/usage','--output-format','json']);
        const result=await this.discover(target.command,target.args,{timeout:30000,windowsHide:true,reject:false});
        if(result.exitCode!==0)throw Error('AGY 额度读取失败');
        const windows=agyQuotaWindows(JSON.parse(result.stdout));
        this.cached={windows,updatedAt:new Date().toISOString(),source:'antigravity',stale:false};
      }catch{this.cached={...this.cached,stale:true};}
      finally{this.readAt=Date.now();this.pending=undefined;}
    })();return this.pending;
  }
  warm(){void this.refresh();}
  async read(model?:string){
    const expired=Date.now()-this.readAt>(this.cached.stale?30000:60000);
    if(expired){
      const pending=this.refresh();
      // Never hold the phone's usage request behind slow CLI startup.
      if(!this.cached.updatedAt){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([pending,new Promise<void>(resolve=>{timer=setTimeout(resolve,1500);})]).finally(()=>clearTimeout(timer));}
    }
    const family=/^(antigravity::)?gemini[.-]/i.test(model||'')?'gemini':/^(antigravity::)?(?:claude[.-]|gpt[.-])/i.test(model||'')?'third-party':undefined;
    const matching=family?this.cached.windows.filter(w=>w.family===family):[];
    const windows=(matching.length?matching:this.cached.windows).map(({family,...window})=>window);
    return {...this.cached,windows,stale:this.cached.stale||Date.now()-this.readAt>60000};
  }
}
