import {AgentHostClient} from './agentHostProtocol.js';
import type {AgentSessionPort,AgentSettings} from './agentSessions.js';
import type {GatewayEvent} from '../types.js';
import {readAgyThreadTokens} from './agySessionTokens.js';
import {modelAgent,threadAgent} from './agentProtocol.js';
import {SubmissionFailure} from './submissionErrors.js';

type ClientFactory=(events:(event:unknown)=>void,running:(ids:string[])=>void,created:(requestId:string|undefined,threadId:string)=>void,scope:string)=>AgentHostClient;
const replaceZcode=<T extends {agent:string}>(primary:T[],current:T[])=>[...primary.filter(row=>row.agent!=='zcode'),...current.filter(row=>row.agent==='zcode')];

export class RemoteAgentSessions implements AgentSessionPort {
  onThreadCreated?:(requestId:string|undefined,threadId:string)=>Promise<void>;
  private readonly client:AgentHostClient;
  private readonly zcodeClient:AgentHostClient;
  private readonly owners=new Map<AgentHostClient,Set<string>>();
  private readonly interactions=new Map<string,AgentHostClient>();
  private readonly createdReceipts=new Map<string,Promise<unknown>>();
  private readonly restartTimers=new Map<AgentHostClient,ReturnType<typeof setTimeout>>();
  constructor(private readonly publish:(event:GatewayEvent)=>void,createClient:ClientFactory=(events,running,created,scope)=>new AgentHostClient(events,running,created,undefined,scope)){
    const create=(scope:string)=>{
      const owned=new Set<string>();let client:AgentHostClient;
      client=createClient(
        event=>{const value=event as GatewayEvent;this.track(value,client,owned);this.publish(value);},
        ids=>{owned.clear();for(const id of ids)owned.add(id);},
        (requestId,threadId)=>{
          owned.add(threadId);
          const saved=Promise.resolve().then(()=>this.onThreadCreated?.(requestId,threadId)).then(()=>null,error=>error);
          if(requestId)this.createdReceipts.set(requestId,saved);
        },scope,
      );
      this.owners.set(client,owned);return client;
    };
    this.client=create('');this.zcodeClient=create('zcode');
  }
  private track(event:GatewayEvent,client=this.client,owned=this.owners.get(client)!){
    if(event.type==='approval.requested'&&event.approvalId)this.interactions.set(event.approvalId,client);
    if(event.type==='approval.resolved')this.interactions.delete(event.approvalId);
    if(!('threadId' in event)||!event.threadId)return;
    if(event.type==='turn.started')owned.add(event.threadId);
    else if(event.type==='thread.started'){
      // Opening a desktop-owned conversation does not transfer its running turn.
      // Ownership is established by turn.started or the host's active-ID snapshot.
      if(event.thread?.status!=='running')owned.delete(event.threadId);
    }
    else if(event.type==='turn.completed'){
      owned.delete(event.threadId);
      clearTimeout(this.restartTimers.get(client));
      if(client.connected){const timer=setTimeout(()=>void client.restartIfIdle().catch(()=>{}),2000);timer.unref();this.restartTimers.set(client,timer);}
    }
  }
  private forThread(id='',model='',agent?:string){
    for(const [client,owned] of this.owners)if(owned.has(id))return client;
    return (threadAgent(id)==='zcode'||modelAgent(model)==='zcode'||agent==='zcode')&&this.client.outdated?this.zcodeClient:this.client;
  }
  private async catalogHost(){
    await this.client.connect();
    // An old host can drain its tasks without blocking a newly installed harness.
    // Once the primary has upgraded, stop keeping the temporary host alive when idle.
    if(this.client.outdated)return this.zcodeClient;
    if(!this.owners.get(this.zcodeClient)?.size)this.zcodeClient.close();
    return null;
  }
  async ready(){await this.client.connect();}
  owns(id:string){return [...this.owners.values()].some(owned=>owned.has(id));}
  async models(refresh=false){
    const current=await this.catalogHost();
    const primary=this.client.request('models',[refresh]) as ReturnType<AgentSessionPort['models']>;
    if(!current)return primary;
    const [old,latest]=await Promise.all([primary,current.request('models',[refresh]) as ReturnType<AgentSessionPort['models']>]);
    return [...old.filter(row=>modelAgent(row.model)!=='zcode'),...latest.filter(row=>modelAgent(row.model)==='zcode')];
  }
  async backends(viaPublic=false){
    const current=await this.catalogHost();
    const primary=this.client.request('backends',[viaPublic]) as ReturnType<AgentSessionPort['backends']>;
    if(!current)return primary;
    const [old,latest]=await Promise.all([primary,current.request('backends',[viaPublic]) as ReturnType<AgentSessionPort['backends']>]);return replaceZcode(old,latest);
  }
  async pickerCatalog(refresh=false,viaPublic=false){
    const current=await this.catalogHost();
    const primary=this.client.request('pickerCatalog',[refresh,viaPublic]) as ReturnType<AgentSessionPort['pickerCatalog']>;
    if(!current)return primary;
    const [old,latest]=await Promise.all([primary,current.request('pickerCatalog',[refresh,viaPublic]) as ReturnType<AgentSessionPort['pickerCatalog']>]);
    return {models:[...old.models.filter(row=>modelAgent(row.model)!=='zcode'),...latest.models.filter(row=>modelAgent(row.model)==='zcode')],
      pending:[...old.pending.filter(agent=>agent!=='zcode'),...latest.pending.filter(agent=>agent==='zcode')],backends:replaceZcode(old.backends,latest.backends)};
  }
  async officialModels(agent:'claude'|'antigravity',refresh=false){return await this.client.request('officialModels',[agent,refresh]) as Awaited<ReturnType<AgentSessionPort['officialModels']>>;}
  async health(refresh=false,viaPublic=false){
    const current=await this.catalogHost();
    const primary=this.client.request('health',[refresh,viaPublic]) as ReturnType<AgentSessionPort['health']>;
    if(!current)return primary;
    const [old,latest]=await Promise.all([primary,current.request('health',[refresh,viaPublic]) as ReturnType<AgentSessionPort['health']>]);
    return replaceZcode(old,latest.map(row=>row.agent==='zcode'?{...row,activeCount:row.activeCount+(old.find(row=>row.agent==='zcode')?.activeCount||0)}:row));
  }
  async validate(model?:string,id?:string){await this.forThread(id,model).request('validate',[model,id]);}
  async usage(id:string,agent?:Parameters<AgentSessionPort['usage']>[1],model?:string){
    const usage=await this.forThread(id,model,agent).request('usage',[id,agent,model]) as Awaited<ReturnType<AgentSessionPort['usage']>>;
    const tokens=id.startsWith('antigravity-')?readAgyThreadTokens(id):null;
    return tokens?{...usage,tokens}:usage;
  }
  async steer(id:string,text:string,images:Parameters<AgentSessionPort['steer']>[2]=[],files:Parameters<AgentSessionPort['steer']>[3]=[]){await this.forThread(id).request('steer',[id,text,images,files]);}
  settings(id:string){return this.forThread(id).request('settings',[id]) as Promise<AgentSettings>;}
  async resume(id:string){await this.forThread(id).request('resume',[id]);}
  async handle(command:unknown){
    const value=command as {threadId?:string;model?:string;requestId?:string};
    try{await this.forThread(value.threadId,value.model).request('handle',[command]);}
    finally{
      const saved=value.requestId?this.createdReceipts.get(value.requestId):undefined;
      if(saved){
        const error=await saved;
        if(this.createdReceipts.get(value.requestId!)===saved)this.createdReceipts.delete(value.requestId!);
        if(error)throw new SubmissionFailure('uncertain',`会话记录保存失败，发送结果待确认：${String(error instanceof Error?error.message:error)}`);
      }
    }
  }
  async resolveApproval(id:string,decision:'accept'|'decline'){await (this.interactions.get(id)||this.client).request('resolveApproval',[id,decision]);}
  async answerQuestions(id:string,answers:Record<string,{answers:string[]}>){await (this.interactions.get(id)||this.client).request('answerQuestions',[id,answers]);}
  async forget(id:string){await this.forThread(id).request('forget',[id]);}
  async close(){for(const timer of this.restartTimers.values())clearTimeout(timer);this.client.close();this.zcodeClient.close();}
}
