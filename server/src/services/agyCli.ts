import {execa} from 'execa';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

type Turn={stdout:PassThrough;stderr:PassThrough;done:Promise<{exitCode:number}>;resolve:(value:{exitCode:number})=>void;terminal:boolean;usageBase?:Record<string,number>;seal?:ReturnType<typeof setImmediate>};
class AgyConnection {
  readonly child:any;
  private current?:Turn;
  private drained=false;
  private exit?:{exitCode:number};
  private ended=false;
  private closing?:Promise<void>;
  private stderr='';
  private idleTimer?:ReturnType<typeof setTimeout>;
  private usage?:Record<string,number>;
  idleAt=0;
  constructor(readonly signature:string,command:string,args:string[],cwd:string|undefined,launch:typeof execa,private terminate:typeof execa,private removed:()=>void){
    const worker=fileURLToPath(new URL('./agyCliWorker.js',import.meta.url));
    this.child=launch(process.execPath,[worker,command,...args],{cwd,windowsHide:true,reject:false,buffer:false,stdin:'pipe',ipc:true});
    this.child.stdin?.on('error',()=>{});
    this.child.stderr?.on('data',(chunk:Buffer)=>{this.stderr=(this.stderr+chunk.toString()).slice(-6000);this.current?.stderr.write(chunk);});
    const reader=createInterface({input:this.child.stdout});
    reader.on('line',line=>{
      const turn=this.current;if(!turn)return;
      let record;try{record=JSON.parse(line);}catch{turn.stdout.write(line+'\n');return;}
      if(record.event==='result'&&record.result?.usage){
        // AGY totals accumulate across turns in the same stream-json process.
        // Expose only this turn's delta; repeated terminal snapshots use the same base.
        const raw=record.result.usage,usage={...raw};
        const keys=['input_tokens','output_tokens','thinking_tokens','cache_read_tokens','cache_read_input_tokens','total_tokens'];
        let valid=true;
        for(const key of keys)if(typeof raw[key]==='number'){
          const delta=raw[key]-(turn.usageBase?.[key]||0);
          if(!Number.isFinite(delta)||delta<0)valid=false;
          usage[key]=delta;
        }
        this.usage={...raw};record.result.usage=valid?usage:undefined;
      }
      turn.stdout.write(JSON.stringify(record)+'\n');
      if(record.event==='result'&&!turn.terminal){
        turn.terminal=true;
        // Drain any already-buffered duplicate result or final suffix into this turn.
        turn.seal=setImmediate(()=>this.finish(0));
      }
    });
    reader.on('close',()=>{this.drained=true;this.finishExit();});
    void Promise.resolve(this.child).then(result=>{this.exit={exitCode:result.exitCode??1};this.finishExit();},error=>{this.stderr=(this.stderr+'\n'+error.message).slice(-6000);this.exit={exitCode:1};this.finishExit();});
  }
  get usable(){return !this.ended&&!this.closing&&!this.drained&&this.child.stdin?.writable===true;}
  private finishExit(){
    if(!this.exit||!this.drained)return;
    this.ended=true;clearTimeout(this.idleTimer);this.removed();
    if(this.current&&this.stderr)this.current.stderr.write(this.stderr);
    this.finish(this.exit.exitCode);
  }
  private finish(exitCode:number){
    const turn=this.current;if(!turn)return;
    clearImmediate(turn.seal);this.current=undefined;
    turn.stdout.end();turn.stderr.end();turn.resolve({exitCode});
  }
  run(input:string){
    if(!this.usable||this.current)throw Error('AGY 进程已退出或仍有任务，保留消息后重试');
    clearTimeout(this.idleTimer);this.idleAt=0;this.stderr='';
    let resolve!:Turn['resolve'];const done=new Promise<{exitCode:number}>(r=>{resolve=r;});
    const turn:Turn={stdout:new PassThrough(),stderr:new PassThrough(),done,resolve,terminal:false,usageBase:this.usage};this.current=turn;
    this.child.stdin.write(input);
    return {pid:this.child.pid,stdout:turn.stdout,stderr:turn.stderr,then:done.then.bind(done),interrupt:()=>this.close(true)};
  }
  idle(timeout:number,onExpired:()=>void){
    if(!this.usable)return;
    this.idleAt=Date.now();this.idleTimer=setTimeout(onExpired,timeout);this.idleTimer.unref();
  }
  close(force=false):Promise<void>{
    if(this.closing)return this.closing;
    clearTimeout(this.idleTimer);this.idleAt=0;
    this.closing=(async()=>{
      if(this.ended)return;
      if(!force)this.child.stdin?.end();
      const exited=async(timeout:number)=>{let timer:ReturnType<typeof setTimeout>|undefined;return Promise.race([Promise.resolve(this.child).then(()=>true,()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),timeout);})]).finally(()=>clearTimeout(timer));};
      if(force||!await exited(1500)){
        if(process.platform==='win32'&&this.child.pid){
          const result=await this.terminate('taskkill.exe',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,reject:false});
          if(result.exitCode!==0&&!await exited(1000))throw Error('停止失败：AGY 后台进程仍在运行，请重试');
        }else if(this.child.kill()===false&&!await exited(1000))throw Error('停止失败：AGY 后台进程仍在运行，请重试');
      }
      await Promise.resolve(this.child).catch(()=>{});
      this.removed();
    })().catch(error=>{this.closing=undefined;throw error;});
    return this.closing;
  }
}

export class AgyCliPool {
  private connections=new Map<string,AgyConnection>();
  constructor(private launch:typeof execa=execa,private terminate:typeof execa=execa,private idleMs=300000,private maxIdle=4){}
  async run(id:string,command:string,args:string[],cwd:string|undefined,input:string){
    // --conversation is only needed for a newly spawned process; a live process owns that session.
    const stableArgs=args.filter((arg,index)=>arg!=='--conversation'&&args[index-1]!=='--conversation');
    const signature=JSON.stringify([command,cwd,stableArgs]);
    let connection=this.connections.get(id);
    if(connection&&(!connection.usable||connection.signature!==signature)){await connection.close();connection=undefined;}
    if(!connection){
      const created=new AgyConnection(signature,command,args,cwd,this.launch,this.terminate,()=>{if(this.connections.get(id)===created)this.connections.delete(id);});
      connection=created;this.connections.set(id,connection);
    }
    // Wrap the thenable turn handle so async return does not wait for its completion.
    return {process:connection.run(input)};
  }
  release(id:string){
    const connection=this.connections.get(id);if(!connection)return;
    connection.idle(this.idleMs,()=>{void connection.close().catch(()=>{});});
    const idle=[...this.connections.values()].filter(c=>c.idleAt).sort((a,b)=>b.idleAt-a.idleAt);
    for(const retired of idle.slice(this.maxIdle))void retired.close().catch(()=>{});
  }
  async forget(id:string){await this.connections.get(id)?.close(true);}
  async close(){await Promise.all([...this.connections.values()].map(c=>c.close(true)));}
}
