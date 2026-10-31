import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

/** Retain native metering off the HTTP thread; repeated refreshes share its caches. */
export class ExternalUsageIndexer{
  constructor(directory){this.directory=directory;this.worker=null;this.pending=null;this.progress={running:false};this.requests=new Map();this.nextRequest=0;this.closed=false;}
  ensureWorker(){
    if(this.closed)throw Error('用量扫描线程已关闭');
    if(!this.worker){
      const worker=new Worker(new URL(import.meta.url),{workerData:{directory:this.directory},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:192}});
      this.worker=worker;
      worker.on('message',message=>{
        if(message.type==='summary'){
          const request=this.requests.get(message.id);if(!request)return;
          this.requests.delete(message.id);
          if(message.error)request.reject(Error(message.error));else request.resolve(message.result);
          return;
        }
        const result=message.result;
        this.progress={...result,running:false};this.resolve?.(result);this.clear();
      });
      const failed=error=>{
        if(this.worker!==worker)return;
        this.worker=null;this.progress={running:false,error:error.message};
        this.reject?.(error);this.clear();
        for(const request of this.requests.values())request.reject(error);
        this.requests.clear();
      };
      worker.on('error',failed);
      worker.on('exit',code=>failed(Error('原生用量扫描线程已退出 ('+code+')')));
    }
    return this.worker;
  }
  start(){
    if(this.pending)return this.pending;
    const worker=this.ensureWorker();
    this.progress={running:true};
    this.pending=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    worker.postMessage('refresh');return this.pending;
  }
  summary(source,range='week',bounds={}){
    const worker=this.ensureWorker(),id=++this.nextRequest;
    return new Promise((resolve,reject)=>{
      this.requests.set(id,{resolve,reject});
      try{worker.postMessage({type:'summary',id,source,range,bounds});}
      catch(error){this.requests.delete(id);reject(error);}
    });
  }
  clear(){this.pending=null;this.resolve=null;this.reject=null;}
  close(){this.closed=true;this.worker?.terminate();}
}

if(!isMainThread&&workerData?.directory){
  const {ExternalUsage}=await import('./external-usage.mjs');
  const usage=new ExternalUsage(undefined,{dir:workerData.directory,refreshMs:60000});
  const reading=new Map();
  function summary(source,range,bounds){
    // Refresh jobs and HTTP queries share the same source cache. Serialize only
    // the same source so simultaneous cold reads cannot scan it twice.
    const previous=reading.get(source)||Promise.resolve();
    const result=previous.catch(()=>{}).then(()=>usage.summary(source,range,bounds));
    reading.set(source,result);
    result.finally(()=>{if(reading.get(source)===result)reading.delete(source);}).catch(()=>{});
    return result;
  }
  parentPort.on('message',async command=>{
    if(command?.type==='summary'){
      try{parentPort.postMessage({type:'summary',id:command.id,result:await summary(command.source,command.range,command.bounds)});}
      catch(error){parentPort.postMessage({type:'summary',id:command.id,error:error.message});}
      return;
    }
    if(command!=='refresh')return;
    const sources={};
    for(const source of ['claude','zcode','grok','hermes','deepseek','opencode','pi','research']){
      try{await summary(source,'year');sources[source]=true;}catch{sources[source]=false;}
    }
    parentPort.postMessage({type:'refresh',result:{sources,at:Date.now()}});
  });
}
