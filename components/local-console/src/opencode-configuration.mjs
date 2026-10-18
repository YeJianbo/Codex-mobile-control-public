import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {parse,modify,applyEdits} from 'jsonc-parser';

const PACKAGES=['@ai-sdk/openai-compatible','@ai-sdk/openai','@ai-sdk/anthropic'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value||{},key);
const invalidKey=key=>['__proto__','prototype','constructor'].includes(key);
const clone=value=>structuredClone(value);
function merge(a,b){const out=Object.assign(Object.create(null),a);for(const [key,value]of Object.entries(b||{})){if(invalidKey(key))throw new Error('OpenCode 配置含不支持的字段名');out[key]=object(value)&&object(out[key])?merge(out[key],value):clone(value);}return out;}
function jsonc(source){const errors=[],value=parse(source.replace(/^\uFEFF/,''),errors,{allowTrailingComma:true,disallowComments:false});if(errors.length||!object(value))throw new Error('OpenCode JSON/JSONC 配置无效，请先在电脑修复');return value;}
function read(file){if(!fs.existsSync(file))return null;const stat=fs.statSync(file);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('OpenCode 配置文件无效或过大');return fs.readFileSync(file,'utf8');}
function short(value,label,max=256){if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\0]/.test(value)||invalidKey(value))throw new Error(label+'格式无效');return value.trim();}
function providerId(value){const id=short(value,'供应商 ID',160);if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))throw new Error('供应商 ID 仅支持字母、数字、点、横线和下划线');return id;}
function baseUrl(value){if(value==='')return '';const result=short(value,'服务地址',2048);let url;try{url=new URL(result);}catch{throw new Error('OpenCode 服务地址无效');}if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol))throw new Error('OpenCode 服务地址需使用 HTTP 或 HTTPS，且不包含凭据、查询参数或片段');return result.replace(/\/+$/,'');}
function edit(source,keys,value){return applyEdits(source,modify(keys.length?source:'{}',keys,value,{formattingOptions:{insertSpaces:true,tabSize:2,eol:source.includes('\r\n')?'\r\n':'\n'}}));}
function atomic(file,content){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.local-console-'+randomUUID();try{fs.writeFileSync(temporary,content,{mode:0o600});fs.renameSync(temporary,file);}catch(error){try{fs.rmSync(temporary,{force:true});}catch{}throw error;}}
const enabled=(config,id)=>!(config.disabled_providers||[]).includes(id)&&(!Array.isArray(config.enabled_providers)||config.enabled_providers.includes(id));
const modelProvider=model=>typeof model==='string'?model.split('/')[0]:'';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hasCredential=(entry,auth)=>typeof entry?.options?.apiKey==='string'&&entry.options.apiKey.length>0||auth?.type==='api'&&!!auth.key||auth?.type==='oauth'&&!!auth.refresh;
function publicBaseUrl(value){if(typeof value!=='string'||!value)return '';try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return '';url.username='';url.password='';url.search='';url.hash='';return url.toString().replace(/\/$/,'');}catch{return '';}}

/** Edits the native global configuration; OAuth credentials are only inspected. */
export class OpenCodeConfiguration {
 constructor({home=os.homedir(),storeDir,environment=process.env}={}){this.home=home;this.environment=environment;this.storeDir=storeDir||path.join(home,'.codex','codexmate','local-console');this.plans=new Map();}
 locations(){
  const expand=value=>value?.startsWith('~/')||value?.startsWith('~\\')?path.join(this.home,value.slice(2)):path.resolve(value);
  const root=path.join(this.environment.XDG_CONFIG_HOME||path.join(this.home,'.config'),'opencode');
  const files=['config.json','opencode.json','opencode.jsonc'].map(name=>path.join(root,name));
  if(this.environment.OPENCODE_CONFIG)files.push(expand(this.environment.OPENCODE_CONFIG));
  if(this.environment.OPENCODE_CONFIG_DIR)for(const name of ['opencode.json','opencode.jsonc'])files.push(path.join(expand(this.environment.OPENCODE_CONFIG_DIR),name));
  const managedRoot=process.platform==='win32'?path.join(this.environment.ProgramData||'C:\\ProgramData','opencode'):process.platform==='darwin'?'/Library/Application Support/opencode':'/etc/opencode';
  const managed=['opencode.json','opencode.jsonc'].map(name=>path.join(managedRoot,name)).filter(file=>fs.existsSync(file));
  return {root,files:[...new Set(files)],managed,legacy:path.join(root,'config'),auth:path.join(this.environment.XDG_DATA_HOME||path.join(this.home,'.local','share'),'opencode','auth.json')};
 }
 live(){
  const locations=this.locations(),files=locations.files.map(file=>({file,content:read(file)})),managed=locations.managed.map(file=>({file,content:read(file)}));
  let config=Object.create(null);for(const item of [...files,...managed])if(item.content!==null)config=merge(config,jsonc(item.content));
  if(this.environment.OPENCODE_CONFIG_CONTENT)config=merge(config,jsonc(this.environment.OPENCODE_CONFIG_CONTENT));
  const authContent=read(locations.auth);let auth=Object.create(null);if(authContent!==null){try{auth=JSON.parse(authContent);if(!object(auth))throw new Error();}catch{throw new Error('OpenCode 账号文件无效，请先在电脑修复');}}
  if(config.provider!=null&&!object(config.provider))throw new Error('OpenCode provider 字段不是对象');
  for(const field of ['enabled_providers','disabled_providers'])if(config[field]!=null&&(!Array.isArray(config[field])||config[field].some(value=>typeof value!=='string')))throw new Error('OpenCode 供应商启停列表格式无效');
  const target=files.filter(item=>item.content!==null).at(-1)?.file||path.join(locations.root,'opencode.jsonc');
  const warnings=[];
  if(this.environment.OPENCODE_CONFIG_CONTENT)warnings.push('OPENCODE_CONFIG_CONTENT 覆盖本机配置，当前只读。');
  if(managed.length)warnings.push('存在系统管理配置，当前只读，请由管理员修改。');
  if(fs.existsSync(locations.legacy))warnings.push('存在旧版 OpenCode TOML 配置，当前只读，请先由 OpenCode 完成迁移。');
  if(config.providers)warnings.push('发现 OpenCode providers 新格式，当前只读，不自动转换配置。');
  const writable=!this.environment.OPENCODE_CONFIG_CONTENT&&!managed.length&&!fs.existsSync(locations.legacy)&&!config.providers&&/\.jsonc?$/i.test(target);
  return {locations,files,managed,config,auth,authContent,target,warnings,writable};
 }
 revision(live){return JSON.stringify([live.files.map(item=>[item.file,item.content]),live.managed.map(item=>[item.file,item.content]),live.authContent,this.environment.OPENCODE_CONFIG_CONTENT||null]);}
 installed(){
  const names=process.platform==='win32'?['opencode.exe','opencode.cmd','opencode.bat','opencode']:['opencode'];
  const roots=(this.environment.PATH||this.environment.Path||'').split(path.delimiter).filter(Boolean).map(value=>value.replace(/^"|"$/g,''));
  return !!(this.environment.CODEX_MOBILE_CONTROL_OPENCODE_BIN&&fs.existsSync(this.environment.CODEX_MOBILE_CONTROL_OPENCODE_BIN))||fs.existsSync(path.join(this.home,'.codex','tools','harnesses','opencode',process.platform==='win32'?'opencode.exe':'opencode'))||roots.some(root=>names.some(name=>fs.existsSync(path.join(root,name))))||fs.existsSync(path.join(this.home,'.opencode','bin',process.platform==='win32'?'opencode.exe':'opencode'));
 }
 state(profiles=[]){
  try{
   const live=this.live(),{config,auth}=live;
   const providers=Object.entries(config.provider||{}).map(([id,item])=>{
    if(!object(item))throw new Error('OpenCode 供应商配置无效');const configuredKey=typeof item.options?.apiKey==='string'&&!!item.options.apiKey;
    return {id,name:typeof item.name==='string'?item.name:id,npm:typeof item.npm==='string'?item.npm:'',baseUrl:publicBaseUrl(item.options?.baseURL),hasKey:!!hasCredential(item,auth[id]),keySource:configuredKey?/^\{(?:env|file):/.test(item.options.apiKey)?'reference':'config':auth[id]?.type==='api'&&auth[id].key?'auth':'none',authType:configuredKey?'api':['api','oauth'].includes(auth[id]?.type)?auth[id].type:'none',enabled:enabled(config,id),models:Object.entries(item.models||{}).map(([id,model])=>({id,name:typeof model?.name==='string'?model.name:id,...(Number.isFinite(model?.limit?.context)?{context:model.limit.context}:{}),...(Number.isFinite(model?.limit?.output)?{output:model.limit.output}:{})}))};
   });
   return {app:'opencode',installed:this.installed(),configured:providers.length>0||Object.keys(auth).length>0,model:typeof config.model==='string'?config.model:'',smallModel:typeof config.small_model==='string'?config.small_model:'',providers,
    accounts:Object.entries(auth).filter(([,value])=>['api','oauth'].includes(value?.type)).map(([providerId,value])=>({providerId,type:value.type,hasKey:value.type==='api'?!!value.key:!!value.refresh,...(Number.isFinite(value.expires)?{expiresAt:value.expires}:{})})),
    profiles:profiles.map(row=>({id:row.id,name:row.name,active:this.matchesProfile(row,live),source:row.source||'CC Switch'})),warnings:live.warnings,file:live.target,files:live.files.map(item=>({path:item.file,exists:item.content!==null})),writable:live.writable};
  }catch(error){return {app:'opencode',installed:this.installed(),configured:false,model:'',smallModel:'',providers:[],accounts:[],profiles:[],warnings:[],writable:false,error:error.message};}
 }
 assertWritable(live){if(!live.writable)throw new Error('OpenCode 当前配置为只读，请检查环境覆盖或系统管理设置');}
 providerInput(input,live,selected=[live.config.model,live.config.small_model]){
  this.assertWritable(live);const id=providerId(input.providerId),current=live.config.provider?.[id]||{},auth=live.auth[id],name=short(input.name,'供应商名称',200),npm=input.npm===''&&own(live.config.provider,id)&&!current.npm?'':short(input.npm,'SDK 包名',200),base=baseUrl(input.baseUrl);
  if(npm&&!PACKAGES.includes(npm)&&npm!==current.npm)throw new Error('新增 SDK 仅支持 OpenAI Compatible、OpenAI Responses 或 Anthropic；已有 SDK 可原样保留');
  if(!base&&current.options?.baseURL)throw new Error('请填写 OpenCode 服务地址');
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.models)||!input.models.length||input.models.length>500)throw new Error('请至少填写一个模型，并明确供应商启停状态');
  const models=input.models.map(model=>{const result={id:short(model.id,'模型 ID',256)};if(/\s/.test(result.id)||invalidKey(result.id))throw new Error('模型 ID 不能包含空白字符');if(model.name!==undefined){if(typeof model.name!=='string'||model.name.length>200||/[\r\n\0]/.test(model.name))throw new Error('模型名称格式无效');result.name=model.name.trim();}for(const field of ['context','output'])if(model[field]!==undefined){if(!Number.isInteger(model[field])||model[field]<1||model[field]>20000000)throw new Error('模型上下文与输出上限需为有效正整数');result[field]=model[field];}return result;});
  if(new Set(models.map(model=>model.id)).size!==models.length)throw new Error('模型 ID 不能重复');
  const key=input.apiKey?short(input.apiKey,'API Key',32768):null,changedBase=base!==String(current.options?.baseURL||'').replace(/\/+$/,'');
  if(key&&auth?.type&&auth.type!=='api')throw new Error('此供应商已有 OAuth 或其他授权，请使用新供应商 ID 保存 API Key，保留原授权');
  if(changedBase&&auth?.type==='oauth')throw new Error('不能将已有 OAuth 授权改接其他服务地址，请使用新的供应商 ID');
  if(changedBase&&hasCredential(current,auth)&&!key)throw new Error('服务地址改变后，请重新填写该地址的 API Key');
  if(changedBase&&Object.keys(current.options?.headers||{}).some(header=>/auth|api[-_]?key|token|secret/i.test(header)))throw new Error('供应商含自定义认证头，更换服务地址前请先在电脑编辑认证头');
  for(const choice of selected)if(modelProvider(choice)===id&&(!input.enabled||!models.some(model=>id+'/'+model.id===choice)))throw new Error('默认模型或小模型仍引用该供应商或模型，请先切换模型');
  return {providerId:id,name,npm,baseUrl:base,enabled:input.enabled,models,...(key?{apiKey:key}:{})};
 }
 modelInput(input,live){
  this.assertWritable(live);const model=short(input.model,'默认模型',500),smallModel=input.smallModel===undefined?undefined:input.smallModel===''?'':short(input.smallModel,'小模型',500);
  const validate=value=>{const split=value.indexOf('/');if(split<1||split===value.length-1)throw new Error('模型应填写 provider/model');const id=providerId(value.slice(0,split)),modelId=value.slice(split+1),provider=live.config.provider?.[id];if(!enabled(live.config,id))throw new Error('所选模型的供应商已停用');if(provider&&Object.keys(provider.models||{}).length&&!own(provider.models,modelId))throw new Error('所选模型不在本机供应商配置中');if(!provider&&!['api','oauth'].includes(live.auth[id]?.type))throw new Error('请先配置该供应商或在 OpenCode 中完成官方授权');};
  validate(model);if(smallModel)validate(smallModel);return {model,...(smallModel!==undefined?{smallModel}:{})};
 }
 selection(kind,input){
  const live=this.live(),draft=kind==='provider'?this.providerInput(input,live):this.modelInput(input,live);
  const changes=kind==='provider'?[{title:live.config.provider?.[draft.providerId]?'编辑供应商':'新增供应商',detail:draft.name+' · '+draft.providerId},{title:'服务地址',detail:draft.baseUrl||'SDK 默认地址'},{title:'模型与启停',detail:`${draft.models.length} 个模型 · ${draft.enabled?'启用':'停用'}`},...(draft.apiKey?[{title:'API Key',detail:'更新所选供应商的认证密钥，其他授权保持原值'}]:[])]:[{title:'默认模型',detail:draft.model},...(draft.smallModel!==undefined?[{title:'小模型',detail:draft.smallModel||'自动选择'}]:[])];
  return {view:{app:'opencode',canSwitch:true,message:'保存本机 OpenCode 配置，新建进程使用新设置。',changes},revision:this.revision(live),draft};
 }
 async preview(kind,input,switches){
  const key='opencode:'+kind+':'+randomUUID(),inspect=()=>this.selection(kind,input),result=await switches.preview(key,'opencode',inspect);
  for(const [id,plan]of this.plans)if(plan.expires<Date.now())this.plans.delete(id);
  if(result.canSwitch&&result.planId){if(this.plans.size>=100)this.plans.delete(this.plans.keys().next().value);this.plans.set(result.planId,{key,kind,input:clone(input),expires:Date.now()+180000});}
  return {...result,blockingCount:result.blockingThreads?.length||0};
 }
 async apply(kind,id,switches){
  const plan=this.plans.get(id);if(!plan||plan.kind!==kind||plan.expires<Date.now())throw new Error('OpenCode 预览已过期，请重新预览');this.plans.delete(id);
  return switches.apply(plan.key,'opencode',id,()=>this.selection(kind,plan.input),()=>kind==='provider'?this.writeProvider(plan.input):this.writeModels(plan.input));
 }
 changes(live){return new Map(live.files.map(item=>[item.file,item.content]));}
 set(changes,live,keys,value){let source=changes.get(live.target)??'{\n  "$schema": "https://opencode.ai/config.json"\n}\n';changes.set(live.target,edit(source,keys,value));}
 remove(changes,live,keys){for(const [file,source]of changes)if(source!==null)changes.set(file,edit(source,keys,undefined));}
 enable(changes,live,id,on){const disabled=Array.isArray(live.config.disabled_providers)?live.config.disabled_providers:[];this.set(changes,live,['disabled_providers'],on?disabled.filter(item=>item!==id):[...new Set([...disabled,id])]);if(on&&Array.isArray(live.config.enabled_providers))this.set(changes,live,['enabled_providers'],[...new Set([...live.config.enabled_providers,id])]);}
 patch(changes,live,keys,value){if(object(value)){if(!Object.keys(value).length)return;for(const [key,item]of Object.entries(value)){if(invalidKey(key))throw new Error('OpenCode 配置含不支持的字段名');this.patch(changes,live,[...keys,key],item);}}else this.set(changes,live,keys,value);}
 providerChanges(live,draft,rawPatch){
  const changes=this.changes(live),root=['provider',draft.providerId],previous=live.config.provider?.[draft.providerId]||{};
  this.set(changes,live,[...root,'name'],draft.name);if(draft.npm)this.set(changes,live,[...root,'npm'],draft.npm);
  if(draft.baseUrl)this.set(changes,live,[...root,'options','baseURL'],draft.baseUrl);
  for(const id of Object.keys(previous.models||{}))if(!draft.models.some(model=>model.id===id))this.remove(changes,live,[...root,'models',id]);
  for(const model of draft.models){const keys=[...root,'models',model.id];if(!previous.models?.[model.id])this.set(changes,live,keys,{});if(model.name!==undefined){if(model.name)this.set(changes,live,[...keys,'name'],model.name);else this.remove(changes,live,[...keys,'name']);}for(const field of ['context','output'])if(model[field]!==undefined)this.set(changes,live,[...keys,'limit',field],model[field]);}
  if(rawPatch){const clean=clone(rawPatch);if(clean.options)delete clean.options.apiKey;this.patch(changes,live,root,clean);}
  this.enable(changes,live,draft.providerId,draft.enabled);
  let authContent=live.authContent;
  if(draft.apiKey){if(rawPatch&&/^\{(?:env|file):/.test(draft.apiKey)||typeof previous.options?.apiKey==='string'&&previous.options.apiKey.length)this.set(changes,live,[...root,'options','apiKey'],draft.apiKey);else{const auth=clone(live.auth);auth[draft.providerId]={...(auth[draft.providerId]||{}),type:'api',key:draft.apiKey};authContent=JSON.stringify(auth,null,2)+'\n';}}
  return {changes,authContent};
 }
 commit(live,changes,authContent=live.authContent){
  const writes=[...changes].filter(([file,content])=>content!==null&&content!==live.files.find(item=>item.file===file)?.content);
  if(authContent!==live.authContent)writes.push([live.locations.auth,authContent]);
  if(!writes.length)return {app:'opencode',saved:true,changed:false,message:'OpenCode 配置未变化'};
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID(),directory=path.join(this.storeDir,'opencode-backups',id),saved=[];
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(const [file,content]of writes){const before=read(file),entry={file,exists:before!==null,backup:saved.length+'.bin'};if(before!==null)fs.writeFileSync(path.join(directory,entry.backup),before,{mode:0o600});saved.push(entry);if(file!==live.locations.auth)jsonc(content);else JSON.parse(content);}
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({at:new Date().toISOString(),files:saved},null,2)+'\n',{mode:0o600});
  try{for(const [file,content]of writes)atomic(file,content);}catch(error){for(const entry of saved){try{if(entry.exists)atomic(entry.file,fs.readFileSync(path.join(directory,entry.backup)));else fs.rmSync(entry.file,{force:true});}catch{}}throw new Error('OpenCode 配置写入失败，已尝试恢复原版本，请在电脑检查配置');}
  return {app:'opencode',saved:true,changed:true,backup:id,message:'OpenCode 配置已保存，新建进程使用新配置'};
 }
 writeProvider(input){const live=this.live(),draft=this.providerInput(input,live),next=this.providerChanges(live,draft);return this.commit(live,next.changes,next.authContent);}
 writeModels(input){const live=this.live(),draft=this.modelInput(input,live),changes=this.changes(live);this.set(changes,live,['model'],draft.model);if(draft.smallModel!==undefined){if(draft.smallModel)this.set(changes,live,['small_model'],draft.smallModel);else this.remove(changes,live,['small_model']);}return this.commit(live,changes);}
 profileInput(row,live){
  const settings=row.settings||JSON.parse(row.settings_config),entries=object(settings.provider)?Object.entries(settings.provider):[[row.id,settings]];
  if(entries.length!==1||!object(entries[0][1]))throw new Error('CC Switch OpenCode 配置需包含一个供应商');
  const [id,provider]=entries[0],models=Object.entries(provider.models||{}).map(([id,model])=>({id,...(typeof model?.name==='string'?{name:model.name}:{}),...(Number.isFinite(model?.limit?.context)?{context:model.limit.context}:{}),...(Number.isFinite(model?.limit?.output)?{output:model.limit.output}:{})}));
  const input={providerId:id,name:provider.name||row.name,npm:provider.npm||'@ai-sdk/openai-compatible',baseUrl:provider.options?.baseURL||'',enabled:true,models,...(provider.options?.apiKey?{apiKey:provider.options.apiKey}:{})};
  const model=object(settings.provider)&&settings.model?settings.model:id+'/'+models[0]?.id;
  if(!models.some(item=>id+'/'+item.id===model))throw new Error('CC Switch OpenCode 默认模型不在此供应商模型清单中');
  let smallModel=object(settings.provider)?settings.small_model:undefined;
  if(smallModel===undefined&&modelProvider(live.config.small_model)===id&&!models.some(item=>id+'/'+item.id===live.config.small_model))smallModel='';
  const draft=this.providerInput(input,live,[model,smallModel===undefined?live.config.small_model:smallModel]);
  return {draft,provider,model,smallModel};
 }
 profileSelection(row){const live=this.live(),target=this.profileInput(row,live);return {view:{app:'opencode',id:row.id,label:row.name,canSwitch:true,message:'将合并此供应商并设置默认模型 '+target.model+'；其他供应商、项目设置与 OAuth 授权保留。'},revision:JSON.stringify([this.revision(live),row.settings_config||row.settings])};}
 matchesProfile(row,live){
  try{const target=this.profileInput(row,live),id=target.draft.providerId,current=live.config.provider?.[id];if(!current||live.config.model!==target.model||!enabled(live.config,id))return false;const subset=(actual,expected)=>object(expected)?Object.entries(expected).every(([key,value])=>key==='apiKey'?((current.options?.apiKey||live.auth[id]?.key)===value):subset(actual?.[key],value)):equal(actual,expected);return subset(current,target.provider);}catch{return false;}
 }
 applyProfile(row){const live=this.live(),target=this.profileInput(row,live),next=this.providerChanges(live,target.draft,target.provider);this.set(next.changes,live,['model'],target.model);if(target.smallModel!==undefined){if(target.smallModel)this.set(next.changes,live,['small_model'],target.smallModel);else this.remove(next.changes,live,['small_model']);}return {...this.commit(live,next.changes,next.authContent),app:'opencode',id:row.id,name:row.name};}
}
