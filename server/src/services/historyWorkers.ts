import {Worker} from 'node:worker_threads';

type ReadPriority='interactive'|'background';
type Job={id:number;key:string;affinity:string;method:string;args:unknown[];env:Record<string,string|undefined>;priority:ReadPriority;waiters:number;retained:boolean;resolve:(value:any)=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout};
type Lane={worker?:Worker;current?:Job;queue:Job[];lastInteractive?:boolean};
type Assignment={lane:Lane;pending:number;revision:number};

export class HistoryWorkerPool {
private readonly lanes:Lane[]=[{queue:[]},{queue:[]}];
private readonly assignments=new Map<string,Assignment>();
private readonly pending=new Map<string,Promise<any>>();
private readonly pendingJobs=new Map<string,Job>();
private sequence=0;
private closed=false;

constructor(private readonly workerUrl=new URL(`./historyWorker.${import.meta.url.endsWith('.ts')?'ts':'js'}`,import.meta.url)){}

private laneFor(key:string):Assignment{
  const existing=this.assignments.get(key);
  if(existing){this.assignments.delete(key);this.assignments.set(key,existing);return existing;}
  // Balance new conversations by outstanding work, rather than hashing IDs.
  // Preserve affinity so reads and invalidations share the same append cursor.
  const assigned=(lane:Lane)=>[...this.assignments.values()].filter(value=>value.lane===lane).length;
  const load=(lane:Lane)=>lane.queue.length+Number(Boolean(lane.current));
  const lane=this.lanes.reduce((best,lane)=>load(lane)<load(best)||load(lane)===load(best)&&assigned(lane)<assigned(best)?lane:best);
  const assignment={lane,pending:0,revision:0};this.assignments.set(key,assignment);
  return assignment;
}
private finish(lane:Lane,error?:Error,value?:unknown){
  const job=lane.current;if(!job)return;
  clearTimeout(job.timer);lane.current=undefined;
  const assignment=this.assignments.get(job.affinity);if(assignment)assignment.pending--;
  // Keep affinities warm without retaining every conversation ever opened.
  for(const [key,value]of this.assignments){
    if(this.assignments.size<=128)break;
    if(!value.pending)this.assignments.delete(key);
  }
  error?job.reject(error):job.resolve(value);
  this.dispatch(lane);
}
private dispatch(lane:Lane){
  if(this.closed||lane.current)return;
  let next=0;
  // Alternate interactive work with the oldest queued call. A conversation's
  // own reads and invalidations must still run in their original order.
  if(!lane.lastInteractive){
    const seen=new Set<string>();
    const interactive=lane.queue.findIndex(job=>{
      if(seen.has(job.affinity))return false;
      seen.add(job.affinity);
      return job.priority==='interactive';
    });
    if(interactive>=0)next=interactive;
  }
  const job=lane.queue.splice(next,1)[0];if(!job){lane.worker?.unref();return;}
  lane.lastInteractive=job.priority==='interactive';
  if(!lane.worker){
    const worker=new Worker(this.workerUrl,{
      // Test loaders may expand execArgv with process-only V8 flags. A worker
      // needs only the TS loader in source runs, and no flags after compilation.
      execArgv:this.workerUrl.pathname.endsWith('.ts')?['--import','tsx']:[],
      resourceLimits:{maxOldGenerationSizeMb:384},
    });
    lane.worker=worker;
    worker.on('message',(message:{id:number;value?:unknown;error?:string})=>{
      if(lane.worker===worker&&lane.current?.id===message.id)this.finish(lane,message.error?new Error(message.error):undefined,message.value);
    });
    const failed=()=>{
      if(lane.worker!==worker)return;
      lane.worker=undefined;void worker.terminate();
      this.finish(lane,new Error('历史读取工作线程已退出，请重试'));
    };
    worker.on('error',failed);worker.on('exit',failed);
  }
  lane.current=job;lane.worker.ref();
  job.timer=setTimeout(()=>{
    const worker=lane.worker;lane.worker=undefined;void worker?.terminate();
    this.finish(lane,new Error('历史读取超时，请稍后重试'));
  },30000);
  lane.worker.postMessage({id:job.id,method:job.method,args:job.args,env:job.env});
}

private discardUnobserved(job:Job){
  if(job.retained||job.waiters)return;
  const assignment=this.assignments.get(job.affinity);
  const queue=assignment?.lane.queue;
  const index=queue?.indexOf(job)??-1;
  // Running work keeps its worker/cache; only an unneeded queued read is removed.
  if(index<0)return;
  queue!.splice(index,1);assignment!.pending--;
  if(this.assignments.size>128&&!assignment!.pending)this.assignments.delete(job.affinity);
  if(this.pendingJobs.get(job.key)===job){this.pending.delete(job.key);this.pendingJobs.delete(job.key);}
  job.reject(new DOMException('历史读取已取消','AbortError'));
}
private observe<T>(job:Job,result:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal){job.retained=true;return result;}
  job.waiters++;
  return new Promise<T>((resolve,reject)=>{
    let settled=false;
    const finish=(callback:(value:any)=>void,value:unknown)=>{
      if(settled)return;
      settled=true;signal.removeEventListener('abort',aborted);job.waiters--;callback(value);
    };
    const aborted=()=>{finish(reject,new DOMException('历史读取已取消','AbortError'));this.discardUnobserved(job);};
    signal.addEventListener('abort',aborted,{once:true});
    result.then(value=>finish(resolve,value),error=>finish(reject,error));
    if(signal.aborted)aborted();
  });
}
call<T>(method:string,args:unknown[],priority:ReadPriority='interactive',signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)return Promise.reject(new DOMException('历史读取已取消','AbortError'));
  if(this.closed)return Promise.reject(new Error('历史读取工作线程池已关闭'));
  const env={CODEX_HOME:process.env.CODEX_HOME,CODEX_MOBILE_CONTROL_HOME:process.env.CODEX_MOBILE_CONTROL_HOME,DSH_HOME:process.env.DSH_HOME};
  const affinity=JSON.stringify([env,String(args[0]||'')]);
  const assignment=this.laneFor(affinity),lane=assignment.lane;
  // A read requested after an invalidation must run behind it, even when an
  // identical earlier read is still pending. Keep deduplication within each revision.
  const revision=assignment.revision+Number(method==='invalidateCodexHistory');
  const key=JSON.stringify([env,method,args,revision]);
  const existing=this.pending.get(key);
  if(existing){
    if(priority==='interactive'){const job=this.pendingJobs.get(key);if(job)job.priority='interactive';}
    return this.observe(this.pendingJobs.get(key)!,existing,signal);
  }
  if(lane.queue.length>=64)return Promise.reject(new Error('历史读取请求较多，请稍后重试'));
  assignment.revision=revision;assignment.pending++;
  let job!:Job;
  const result=new Promise<T>((resolve,reject)=>{
    job={id:++this.sequence,key,affinity,method,args,env,priority,waiters:0,retained:false,resolve,reject};
    this.pendingJobs.set(key,job);lane.queue.push(job);this.dispatch(lane);
  }).finally(()=>{if(this.pendingJobs.get(key)===job){this.pending.delete(key);this.pendingJobs.delete(key);}});
  this.pending.set(key,result);return this.observe(job,result,signal);
}

async close():Promise<void>{
  this.closed=true;
  const workers:Promise<number>[]=[];
  for(const lane of this.lanes){
    if(lane.worker){workers.push(lane.worker.terminate());lane.worker=undefined;}
    if(lane.current){clearTimeout(lane.current.timer);lane.current.reject(new Error('历史读取工作线程池已关闭'));lane.current=undefined;}
    for(const job of lane.queue.splice(0))job.reject(new Error('历史读取工作线程池已关闭'));
  }
  this.assignments.clear();await Promise.all(workers);
}
}

const pool=new HistoryWorkerPool();
export function historyWorkerCall<T>(method:string,args:unknown[],priority:ReadPriority='interactive',signal?:AbortSignal):Promise<T>{return pool.call<T>(method,args,priority,signal);}
