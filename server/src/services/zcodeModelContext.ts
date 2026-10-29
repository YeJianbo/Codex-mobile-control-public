import fs from 'node:fs';
import path from 'node:path';
import {appHome} from './paths.js';
import {zcodeHome} from './zcodeAccount.js';
import {zcodeNativeSessions} from './zcodeNativeSessions.js';

type ModelRef={providerId:string;modelId:string};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const matches=(pattern:string,value:string,ignoreCase=false)=>new RegExp(`^(?:${pattern})$`,ignoreCase?'i':undefined).test(value);

/** Follow native rule order; a provider's explicit override also applies to its window. */
export function resolveZcodeModelWindow(builtin:any,personal:any,ref:ModelRef):number|null{
  if(!builtin?.config)return null;
  const providers=builtin?.config?.providerConfigRules?.providerRules||[];
  const localProviders=personal?.config?.providerConfigRules?.providerRules||[];
  const matching=[...providers,...localProviders].filter((rule:any)=>rule.providerId===ref.providerId);
  if(!matching.length)return null;
  const templateId=matching.map((rule:any)=>rule.templateId).filter(Boolean).at(-1);
  const template=builtin.config.providerConfigRules.templateRules?.find((rule:any)=>rule.templateId===templateId);
  const api=Object.assign({},template?.config?.api,...matching.map((rule:any)=>rule.config?.api));
  const baseUrl=typeof api.baseUrl==='string'?api.baseUrl.replace(/\/+$/,''):undefined;
  let window:number|null=null;
  const apply=(rule:any,manual=false)=>{
    if(manual)window=null;
    if(rule.config?.properties===null)window=null;
    const value=rule.config?.properties?.contextWindow;
    if(value!==undefined)window=positive(value)?value:null;
  };
  const rules=builtin.config.modelConfigRules||{};
  for(const rule of rules.modelRules||[])if(matches(rule.modelMatch,ref.modelId,true))apply(rule);
  for(const rule of rules.modelApiRules||[])if(matches(rule.modelMatch,ref.modelId,true)&&(!rule.apiTypeMatch||api.type&&matches(rule.apiTypeMatch,api.type)))apply(rule);
  for(const rule of rules.providerSiteRules||[])if(matches(rule.modelMatch,ref.modelId,true)&&baseUrl&&matches(rule.baseUrlMatch,baseUrl)&&(!rule.apiTypeMatch||api.type&&matches(rule.apiTypeMatch,api.type)))apply(rule);
  for(const rule of rules.templateModelRules||[])if(rule.templateId===templateId&&rule.modelId===ref.modelId)apply(rule);
  const local=personal?.config?.modelConfigRules||{};
  for(const rule of [...(rules.builtinProviderModelRules||[]),...(local.providerModelRules||[])])if(rule.providerId===ref.providerId&&rule.modelId===ref.modelId)apply(rule);
  for(const rule of local.manualProviderModelRules||[])if(rule.providerId===ref.providerId&&rule.modelId===ref.modelId)apply(rule,true);
  return window;
}

const files=new Map<string,{checked:number;stamp:string;value:any}>();
function config(file:string){
  const cached=files.get(file),now=Date.now();
  if(cached&&now-cached.checked<1000)return cached.value;
  try{
    const stat=fs.statSync(file),stamp=`${stat.mtimeMs}:${stat.size}`;
    const value=cached?.stamp===stamp?cached.value:JSON.parse(fs.readFileSync(file,'utf8'));
    files.set(file,{checked:now,stamp,value});return value;
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    files.set(file,{checked:now,stamp:'missing',value:null});return null;
  }
}

/** Old shared runtimes retain a 200K projection after the installed catalog grows. */
export function currentZcodeContextWindow(model:string|undefined):number|null{
  if(!model?.startsWith('zcode::'))return null;
  const raw=model.slice('zcode::'.length),slash=raw.indexOf('/');
  if(slash<1)return null;
  const ref={providerId:decodeURIComponent(raw.slice(0,slash)),modelId:decodeURIComponent(raw.slice(slash+1))};
  const bridge=config(process.env.CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG||path.join(appHome(),'zcode-bridge','config.json'));
  const builtinFile=process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE||bridge?.env?.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE;
  if(!builtinFile)return null;
  const personalFile=process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE||bridge?.env?.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE||path.join(zcodeHome(),'v2','provider_config.json');
  return resolveZcodeModelWindow(config(builtinFile),config(personalFile),ref);
}

/** Apply at the shared API boundary, including responses from an old busy executor. */
export async function withCurrentZcodeContext<T extends {contextWindow?:number|null}>(id:string,tokens:T|null|undefined,model?:string){
  if(!tokens)return tokens;
  const native=(await zcodeNativeSessions.list()).find(row=>row.thread.id===id);
  const window=currentZcodeContextWindow(native?.model||model);
  return window?{...tokens,contextWindow:window}:tokens;
}
