import path from 'node:path';
import {execa} from 'execa';
import type {Agent} from './agentProtocol.js';

type HealthId=Agent|'codex-desktop';
export type ProcessHealth={state:'running'|'stopped'|'unknown';count:number|null;memoryBytes:number|null;sampledAt:string|null;error:string|null};
export type UpdateHealth={state:'not_checked'|'checking'|'current'|'available'|'unknown'|'unsupported';installedVersion:string|null;latestVersion:string|null;checkedAt:string|null;source:string|null;sourceLabel:string;url:string|null;error:string|null;updateAvailable:boolean|null};
export type HealthProcess={id:number;parent:number;name:string;path?:string;command?:string;createdAt?:string;memoryBytes:number|null};
type SystemSample={processes:HealthProcess[];desktop:{installed:boolean;version:string|null}};
type BaseHealth={agent:string;version?:string|null;installed?:boolean;[key:string]:unknown};
type UpdateSource={source:string;sourceLabel:string;url:string|null;endpoint?:string;field?:'version'|'tag_name'|'microsoft-store';unsupported?:string};
type UpdateRecord={latestVersion:string|null;checkedAt:string|null;error:string|null};
const sources:Record<HealthId,UpdateSource>={
  codex:npmSource('@openai/codex'),claude:npmSource('@anthropic-ai/claude-code'),grok:npmSource('@xai-official/grok'),
  deepseek:npmSource('@deepseek-ai/dsh'),opencode:npmSource('opencode-ai'),
  zcode:{source:'desktop',sourceLabel:'ZCode 桌面应用',url:'https://zcode.z.ai',unsupported:'CLI 随 ZCode 桌面应用更新'},
  hermes:{source:'github',sourceLabel:'GitHub · NousResearch/hermes-agent',url:'https://github.com/NousResearch/hermes-agent/releases',endpoint:'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest',field:'tag_name'},
  antigravity:{source:'github',sourceLabel:'GitHub · google-antigravity/antigravity-cli',url:'https://github.com/google-antigravity/antigravity-cli/releases',endpoint:'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest',field:'tag_name'},
  'codex-desktop':{source:'microsoft-store',sourceLabel:'Microsoft Store',url:'https://apps.microsoft.com/detail/9PLM9XGG6VKS',endpoint:'https://displaycatalog.mp.microsoft.com/v7.0/products/9PLM9XGG6VKS?market=US&languages=en-us',field:'microsoft-store'},
};
function npmSource(name:string):UpdateSource{return {source:'npm',sourceLabel:'npm · '+name,url:'https://www.npmjs.com/package/'+name,endpoint:'https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest',field:'version'};}
const unknownProcess=(error:string|null=null):ProcessHealth=>({state:'unknown',count:null,memoryBytes:null,sampledAt:null,error});
export function parseHealthVersion(raw:unknown):string|null{return typeof raw==='string'?raw.match(/(?:^|[^0-9A-Za-z])v?(\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/i)?.[1]||null:null;}
function parseInstalledHealthVersion(raw:unknown):string|null{
  if(typeof raw!=='string')return null;
  const version=parseHealthVersion(raw),gitSource=raw.search(/(?:^|[^0-9A-Za-z])v?(?:git|commit)(?:[.\s:-]|$)/i);
  // A date following a Git version identifies its build, not a comparable release.
  return version&&gitSource>=0&&raw.indexOf(version)>gitSource?null:version;
}
export function compareHealthVersions(left:string,right:string):number{
  const split=(value:string)=>{const index=value.indexOf('-');return index<0?[value,undefined] as const:[value.slice(0,index),value.slice(index+1)] as const;};
  const [a,ap]=split(left),[b,bp]=split(right),an=a.split('.').map(Number),bn=b.split('.').map(Number);
  for(let index=0;index<Math.max(an.length,bn.length);index++){const difference=(an[index]||0)-(bn[index]||0);if(difference)return difference;}
  if(!ap||!bp)return ap===bp?0:ap?-1:1;
  const av=ap.split('.'),bv=bp.split('.');
  for(let index=0;index<Math.max(av.length,bv.length);index++){
    if(av[index]===bv[index])continue;if(av[index]===undefined)return -1;if(bv[index]===undefined)return 1;
    const numericA=/^\d+$/.test(av[index]),numericB=/^\d+$/.test(bv[index]);
    if(numericA&&numericB)return Number(av[index])-Number(bv[index]);
    if(numericA!==numericB)return numericA?-1:1;return av[index]<bv[index]?-1:1;
  }return 0;
}

export function parseDesktopStoreVersion(value:unknown,architecture:string=process.arch):string|null{
  const object=(item:unknown):Record<string,unknown>|null=>item!==null&&typeof item==='object'&&!Array.isArray(item)?item as Record<string,unknown>:null;
  const product=object(object(value)?.Product),properties=object(product?.Properties);
  if(product?.ProductId!=='9PLM9XGG6VKS'||properties?.PackageIdentityName!=='OpenAI.Codex'||properties?.PackageFamilyName!=='OpenAI.Codex_2p2nqsd0c76g0')return null;
  if(!Array.isArray(product.DisplaySkuAvailabilities))return null;
  const versions:string[]=[];
  for(const entry of product.DisplaySkuAvailabilities){
    const packages=object(object(object(entry)?.Sku)?.Properties)?.Packages;
    if(!Array.isArray(packages))continue;
    for(const item of packages){
      const packageValue=object(item),fullName=packageValue?.PackageFullName;
      if(packageValue?.PackageFamilyName!=='OpenAI.Codex_2p2nqsd0c76g0'||typeof fullName!=='string')continue;
      // The numeric Version is a packed Store integer; compare the package's four-part version.
      const match=/^OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_(x64|arm64)__2p2nqsd0c76g0$/i.exec(fullName);
      if(match&&match[2].toLowerCase()===architecture)versions.push(match[1]);
    }
  }
  return versions.sort(compareHealthVersions).at(-1)||null;
}

function processSeed(process:HealthProcess):HealthId|null{
  const name=process.name.toLowerCase(),command=(process.command||'').replaceAll('\\','/').toLowerCase(),file=(process.path||'').replaceAll('\\','/').toLowerCase();
  if(desktopPackageFile(file)&&((/\/(chatgpt|codex)\.exe$/.test(file)&&!file.includes('/resources/')&&!/--type=/.test(command))||(name==='codex.exe'&&file.includes('/resources/')&&/\bapp-server\b/.test(command))))return 'codex-desktop';
  if(/^codex(?:\.exe)?$/.test(name)||/@openai\/codex(?:\/|\b)/.test(command))return 'codex';
  if(/^claude(?:\.exe)?$/.test(name)||/@anthropic-ai\/claude-code(?:\/|\b)|@agentclientprotocol\/claude-agent-acp(?:\/|\b)/.test(command))return 'claude';
  if(/^agy(?:\.exe)?$/.test(name)||/(?:^|[\s"/])agy(?:\.exe)?(?:[\s"]|$)/.test(command))return 'antigravity';
  if(/^grok(?:\.exe)?$/.test(name)||/@xai-official\/grok(?:\/|\b)/.test(command))return 'grok';
  if(/^dsh(?:\.exe)?$/.test(name)||/@deepseek-ai\/dsh(?:\/|\b)/.test(command))return 'deepseek';
  if(/^hermes(?:\.exe)?$/.test(name)||/(?:^|\s)-m\s+hermes_cli(?:\.main)?(?:\s|$)|\/hermes_cli\/(?:main|__main__)\.py/.test(command))return 'hermes';
  if(/^opencode(?:\.exe)?$/.test(name)||/\/opencode-ai\/(?:bin|node_modules)\//.test(command))return 'opencode';
  if(/^zcode(?:\.exe)?$/.test(name)||/\/glm\/zcode(?:\.mobile-native)?\.cjs\b|\/scripts\/zcode-shared-(?:backend|proxy)\.mjs\b/.test(command))return 'zcode';
  return null;
}
function desktopPackageFile(file:string){return /\/windowsapps\/openai\.codex_[^/]+\/app\//.test(file)||/\/programs\/openai\/codex\//.test(file);}

export function summarizeHealthProcesses(processes:HealthProcess[],sampledAt:string):Record<HealthId,ProcessHealth>{
  const byId=new Map(processes.map(item=>[item.id,item])),seeds=new Map(processes.map(item=>[item.id,processSeed(item)]));
  const groups=new Map<HealthId,HealthProcess[]>();
  for(const item of processes){
    let current:HealthProcess|undefined=item,agent:HealthId|null=null;const seen=new Set<number>();
    while(current&&!seen.has(current.id)){
      seen.add(current.id);const seed=seeds.get(current.id);
      // The nearest independent harness owns its descendants, even below a desktop-launched gateway.
      if(seed){agent=seed;break;}
      const parent=byId.get(current.parent);
      if(parent&&current.createdAt&&parent.createdAt&&Date.parse(current.createdAt)<Date.parse(parent.createdAt))break;
      current=parent;
    }
    // General services and builds are not desktop helpers merely because the desktop launched them.
    if(agent==='codex-desktop'&&!desktopPackageFile((item.path||'').replaceAll('\\','/').toLowerCase()))continue;
    if(agent){if(!groups.has(agent))groups.set(agent,[]);groups.get(agent)!.push(item);}
  }
  return Object.fromEntries(Object.keys(sources).map(id=>{
    const items=groups.get(id as HealthId)||[],complete=items.every(item=>typeof item.memoryBytes==='number'&&Number.isFinite(item.memoryBytes)&&item.memoryBytes>=0);
    return [id,{state:items.length?'running':'stopped',count:items.length,memoryBytes:complete?items.reduce((sum,item)=>sum+item.memoryBytes!,0):null,sampledAt,error:complete?null:'部分进程内存不可读'}];
  })) as Record<HealthId,ProcessHealth>;
}

async function sampleSystem():Promise<SystemSample>{
  if(process.platform!=='win32'){
    const result=await execa('ps',['-eo','pid=,ppid=,rss=,comm=,args='],{timeout:8000,reject:false});
    if(result.exitCode!==0)throw new Error('进程采样失败');
    const processes=result.stdout.split('\n').flatMap(line=>{const match=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);return match?[{id:Number(match[1]),parent:Number(match[2]),memoryBytes:Number(match[3])*1024,name:path.basename(match[4]),command:match[5]}]:[];});
    return {processes,desktop:{installed:false,version:null}};
  }
  const script=`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$items=@(Get-CimInstance Win32_Process|ForEach-Object{[pscustomobject]@{id=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;path=$_.ExecutablePath;command=$_.CommandLine;createdAt=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null};memoryBytes=if($null -ne $_.WorkingSetSize){[double]$_.WorkingSetSize}else{$null}}});$package=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue|Sort-Object Version -Descending|Select-Object -First 1;[pscustomobject]@{processes=$items;desktop=[pscustomobject]@{installed=[bool]$package;version=if($package){[string]$package.Version}else{$null}}}|ConvertTo-Json -Depth 4 -Compress`;
  const result=await execa(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,reject:false});
  if(result.exitCode!==0)throw new Error('进程采样失败');
  const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  if(!Array.isArray(value.processes)||!value.desktop)throw new Error('进程采样响应无效');
  return value;
}

export class AgentHealthMonitor{
  private sample:typeof sampleSystem;
  private fetchImpl:typeof fetch;
  private now:()=>number;
  private processTtlMs:number;
  private updateTtlMs:number;
  private sampleAt=0;
  private processValues:Record<HealthId,ProcessHealth>|null=null;
  private desktopValue:{installed:boolean|null;version:string|null}={installed:null,version:null};
  private sampling:Promise<void>|null=null;
  private versions=new Map<HealthId,string|null>();
  private updates=new Map<HealthId,UpdateRecord>();
  private checking:Promise<unknown>|null=null;
  private checkingIds=new Set<HealthId>();
  constructor({sample=sampleSystem,fetchImpl=fetch,now=()=>Date.now(),processTtlMs=15000,updateTtlMs=3600000}:{sample?:typeof sampleSystem;fetchImpl?:typeof fetch;now?:()=>number;processTtlMs?:number;updateTtlMs?:number}={}){this.sample=sample;this.fetchImpl=fetchImpl;this.now=now;this.processTtlMs=processTtlMs;this.updateTtlMs=updateTtlMs;}
  private async processes(){
    if(this.processValues&&this.now()-this.sampleAt<this.processTtlMs)return;
    if(!this.sampling)this.sampling=(async()=>{
      try{
        const value=await this.sample(),at=new Date(this.now()).toISOString();
        this.processValues=summarizeHealthProcesses(value.processes,at);this.desktopValue=value.desktop;
        if(this.processValues['codex-desktop'].state==='running')this.desktopValue.installed=true;
      }catch{
        this.processValues=Object.fromEntries(Object.keys(sources).map(id=>[id,this.processValues?.[id as HealthId]?{...this.processValues[id as HealthId],error:'进程采样失败'}:unknownProcess('进程采样失败')])) as Record<HealthId,ProcessHealth>;
      }finally{this.sampleAt=this.now();}
    })().finally(()=>{this.sampling=null;});
    await this.sampling;
  }
  private update(id:HealthId):UpdateHealth{
    const definition=sources[id],saved=this.updates.get(id),installedVersion=this.versions.get(id)||null;
    const base={installedVersion,latestVersion:saved?.latestVersion||null,checkedAt:saved?.checkedAt||null,source:definition.source,sourceLabel:definition.sourceLabel,url:definition.url,error:saved?.error||null,updateAvailable:null as boolean|null};
    if(definition.unsupported)return {...base,state:'unsupported',error:definition.unsupported};
    if(this.checkingIds.has(id))return {...base,state:'checking'};
    if(!saved)return {...base,state:'not_checked'};
    const left=parseHealthVersion(installedVersion),right=parseHealthVersion(saved.latestVersion);
    if(left&&right)base.updateAvailable=compareHealthVersions(left,right)<0;
    if(saved.error||!left||!right)return {...base,state:'unknown',error:saved.error||(!left?'本机版本无法与 Release 比较':'远端版本未记录')};
    return {...base,state:base.updateAvailable?'available':'current'};
  }
  async enrich<T extends BaseHealth>(input:T[]|Promise<T[]>){
    // CLI probes and system sampling are independent; neither should queue behind the other.
    const [agents]=await Promise.all([input,this.processes()]);
    for(const agent of agents)if(Object.hasOwn(sources,agent.agent))this.versions.set(agent.agent as HealthId,parseInstalledHealthVersion(agent.version));
    this.versions.set('codex-desktop',this.desktopValue.version);
    return {agents:agents.map(agent=>({...agent,process:this.processValues?.[agent.agent as HealthId]||unknownProcess(),update:Object.hasOwn(sources,agent.agent)?this.update(agent.agent as HealthId):null})),
      desktop:{id:'codex-desktop',name:'Codex 桌面端',...this.desktopValue,process:this.processValues?.['codex-desktop']||unknownProcess(),update:this.update('codex-desktop')}};
  }
  async checkUpdates(refresh=false){
    if(this.checking)return this.checking;
    this.checking=Promise.all((Object.keys(sources) as HealthId[]).map(async id=>{
      const source=sources[id],old=this.updates.get(id);
      if(!refresh&&old?.checkedAt&&this.now()-Date.parse(old.checkedAt)<this.updateTtlMs)return;
      if(source.unsupported){this.updates.set(id,{latestVersion:old?.latestVersion||null,checkedAt:new Date(this.now()).toISOString(),error:source.unsupported});return;}
      this.checkingIds.add(id);
      try{
        const response=await this.fetchImpl(source.endpoint!,{headers:{'User-Agent':'Codex-mobile-control-health','Accept':'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
        if(!response.ok)throw new Error('版本源 HTTP '+response.status);
        const value=await response.json() as Record<string,unknown>,latestVersion=source.field==='microsoft-store'?parseDesktopStoreVersion(value):parseHealthVersion(value[source.field!]);
        if(!latestVersion)throw new Error('版本源未返回有效版本');
        this.updates.set(id,{latestVersion,checkedAt:new Date(this.now()).toISOString(),error:null});
      }catch(error){
        const message=error instanceof Error&&/^版本源/.test(error.message)?error.message:'版本检查失败';
        this.updates.set(id,{latestVersion:old?.latestVersion||null,checkedAt:new Date(this.now()).toISOString(),error:message});
      }finally{this.checkingIds.delete(id);}
    })).then(()=>({checkedAt:new Date(this.now()).toISOString(),updates:Object.fromEntries((Object.keys(sources) as HealthId[]).map(id=>[id,this.update(id)]))})).finally(()=>{this.checking=null;});
    return this.checking;
  }
}
