import {agentNames,modelAgent,type Agent} from './agentProtocol.js';
import type {PickerModel} from './modelCatalog.js';

type Backend={agent:string;name:string;installed:boolean;available:boolean;reason:string;[key:string]:unknown};
type OfficialCatalog={models:PickerModel[];available:boolean;reason:string};
type Loaders={
  codex:(refresh:boolean)=>Promise<PickerModel[]>;
  external:(refresh:boolean)=>Promise<{models:PickerModel[];backends:Backend[]}>;
  claude:(refresh:boolean)=>Promise<OfficialCatalog>;
  antigravity:(refresh:boolean)=>Promise<OfficialCatalog>;
};
const transports:Record<Agent,'app-server'|'acp'>={codex:'app-server',zcode:'app-server',grok:'acp',deepseek:'acp',hermes:'acp',opencode:'acp',claude:'acp',antigravity:'acp',pi:'acp',acp:'acp'};

class CatalogSource<T>{
  value?:T;
  error='';
  private settledAt?:number;
  pending?:Promise<void>;
  constructor(private load:(refresh:boolean)=>Promise<T>,private ttl:number,private now:()=>number){}
  start(refresh:boolean){
    if(this.pending||!refresh&&this.settledAt!==undefined&&this.now()-this.settledAt<this.ttl)return;
    this.pending=Promise.resolve().then(()=>this.load(refresh)).then(value=>{
      this.value=value;this.error='';
    },error=>{
      this.error=String(error instanceof Error?error.message:error).slice(0,240);
    }).finally(()=>{this.settledAt=this.now();this.pending=undefined;});
  }
}

/** Discovery sources publish independently; reading the picker never waits for a slow ACP. */
export class AssistantModelCatalog{
  private native:CatalogSource<PickerModel[]>;
  private external:CatalogSource<{models:PickerModel[];backends:Backend[]}>;
  private claude:CatalogSource<OfficialCatalog>;
  private antigravity:CatalogSource<OfficialCatalog>;
  private sources:Record<string,CatalogSource<unknown>>;
  private budgetMs:number;
  constructor(loaders:Loaders,options:{budgetMs?:number;ttlMs?:number;now?:()=>number}={}){
    const now=options.now??Date.now;
    this.budgetMs=options.budgetMs??250;
    this.native=new CatalogSource(loaders.codex,options.ttlMs??5000,now);
    this.external=new CatalogSource(loaders.external,options.ttlMs??60000,now);
    this.claude=new CatalogSource(loaders.claude,options.ttlMs??60000,now);
    this.antigravity=new CatalogSource(loaders.antigravity,options.ttlMs??60000,now);
    this.sources={codex:this.native,external:this.external,claude:this.claude,antigravity:this.antigravity};
  }
  async read(refresh=false){
    for(const source of Object.values(this.sources))source.start(refresh);
    // Warm reads return immediately, including while an expired source refreshes.
    if(!Object.values(this.sources).some(source=>source.value!==undefined)){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        await Promise.race([
          Promise.all(Object.values(this.sources).map(source=>source.pending)),
          new Promise<void>(resolve=>{timer=setTimeout(resolve,this.budgetMs);}),
        ]);
      }finally{if(timer)clearTimeout(timer);}
    }
    return this.snapshot();
  }
  private snapshot(){
    const pendingSources=Object.entries(this.sources).filter(([,source])=>source.pending).map(([name])=>name);
    const backends=(this.external.value?.backends??[]).map(backend=>({...backend,transport:transports[backend.agent as Agent],...(this.external.error?{available:false,reason:this.external.error}:{})}));
    for(const [agent,source] of [['claude',this.claude],['antigravity',this.antigravity]] as const){
      const official=source.value;
      const previous=backends.find(row=>row.agent===agent);
      const available=!source.error&&official?.available===true;
      const backend={...previous,agent,name:previous?.name??agentNames[agent],transport:transports[agent],installed:official?.available||previous?.installed||false,
        available,reason:available?'':source.error||official?.reason||(source.pending?'正在读取 ACP 模型目录':'尚未读取 ACP 模型目录')};
      if(previous)Object.assign(previous,backend);else backends.push(backend);
    }
    const models=[
      ...(this.native.value??[]),
      ...(this.external.value?.models??[]).filter(model=>!['claude','antigravity'].includes(modelAgent(model.model))),
      ...(this.claude.value?.models??[]),...(this.antigravity.value?.models??[]),
    ].map(model=>{
      const harness=modelAgent(model.model),backend=backends.find(row=>row.agent===harness);
      return {...model,harness,executor:'gateway',transport:transports[harness],available:harness==='codex'?!this.native.error:backend?.available===true,unavailableReason:harness==='codex'?this.native.error:backend?.reason||''};
    });
    const defaultModel=['gpt-6.1-sol','gpt-6-sol'].find(id=>models.some(model=>model.model===id&&model.available))||models.find(model=>model.harness==='codex'&&model.available&&/sol/i.test(model.model))?.model||null;
    return {models,backends,defaultModel,loading:pendingSources.length>0,pendingSources};
  }
}
