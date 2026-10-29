import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,createDecipheriv,randomUUID} from 'node:crypto';

export const zcodeHome=()=>path.join(process.env.ZCODE_DATA_BASE_DIR||os.homedir(),'.zcode');
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export function decryptZcodeCredential(value:string,environment=process.env):string{
  if(!value.startsWith('enc:v1:'))return value;
  const parts=value.slice(7).split('.');
  if(parts.length!==3)throw Error('ZCode 凭据格式无效，请在桌面端重新登录');
  const secret=environment.ZCODE_CREDENTIAL_SECRET||`zcode-credential-fallback:${process.platform}:${os.homedir()}:${os.userInfo().username}`;
  try{
    const [iv,tag,encrypted]=parts.map(part=>Buffer.from(part,'base64url'));
    const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
  }catch{throw Error('无法读取 ZCode 本机凭据，请在运行网关的系统账号中登录 ZCode');}
}

export async function zcodeEnvironment(cli:string){
  const candidates=[process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,path.resolve(path.dirname(cli),'../config/provider/zcode-builtin.json'),path.join(path.dirname(cli),'provider/zcode-builtin.json')].filter((v):v is string=>!!v);
  let file:string|undefined;
  for(const candidate of candidates)if(await fs.stat(candidate).then(s=>s.isFile()).catch(()=>false)){file=path.resolve(candidate);break;}
  if(!file)throw Error('未找到 ZCode 自带模型配置，请设置 ZCODE_BUILTIN_PROVIDER_CONFIG_FILE');
  // Supplying both paths bypasses the CLI's broken bundled-resource lookup and
  // leaves the desktop's active configuration and selected model untouched.
  return {ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:file,ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE:file,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE||path.join(zcodeHome(),'v2','provider_config.json')};
}

type AccountMaterial={providerId:string;apiKey:string;credentialKey:string;accountScope:string;family:string;mode:string};
export type ZcodeAccount={snapshot:any;auth:(params:any)=>Promise<any>;reason:string};
async function readJson(file:string){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}}
async function desktopVersion(configFile:string){
  const archive=path.resolve(path.dirname(configFile),'../../app.asar');
  let handle;
  try{
    handle=await fs.open(archive,'r');const prefix=Buffer.alloc(16);await handle.read(prefix,0,16,0);
    const size=prefix.readUInt32LE(12);if(size>8*1024*1024)throw Error('ASAR header too large');
    const bytes=Buffer.alloc(size);await handle.read(bytes,0,size,16);
    const entry=JSON.parse(bytes.toString()).files['package.json'];if(!entry||Number(entry.size)>1024*1024)throw Error('Missing package');
    const data=Buffer.alloc(Number(entry.size));await handle.read(data,0,data.length,8+prefix.readUInt32LE(4)+Number(entry.offset));
    return String(JSON.parse(data.toString()).version);
  }catch{return process.env.ZCODE_APP_VERSION||'unknown';}finally{await handle?.close();}
}
async function sourceHeaders(configFile:string){
  const [version,telemetry]=await Promise.all([desktopVersion(configFile),readJson(path.join(zcodeHome(),'v2','telemetry-state.json'))]);
  return {'HTTP-Referer':'https://zcode.z.ai','User-Agent':'ZCode/'+version,'X-Title':'Z Code@mobile-control',
    'X-ZCode-App-Version':version,'X-Platform':process.platform+'-'+process.arch,'X-Client-Language':'zh-CN',
    'X-Client-Timezone':Intl.DateTimeFormat().resolvedOptions().timeZone,'X-Os-Category':process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux','X-Os-Version':os.release(),
    ...(typeof telemetry.deviceMid==='string'?{'X-Device-Mid':telemetry.deviceMid}:{})};
}
async function officialJson(url:string,authorization:string,headers:Record<string,string>){
  const response=await fetch(url,{headers:{...headers,'x-request-id':randomUUID(),Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(`ZCode 账号服务返回 HTTP ${response.status}`);
  const value=await response.json() as any;
  if(value.success===false||value.code!==undefined&&![0,200].includes(value.code))throw Error('ZCode 账号服务未确认权益，请在桌面端刷新登录');
  return value;
}

/** Credentials stay in this process; only entitlement and model IDs cross stdio. */
export async function readZcodeAccount(file:string):Promise<ZcodeAccount>{
  const [builtin,settings,encrypted]=await Promise.all([readJson(file),readJson(path.join(zcodeHome(),'v2','setting.json')),readJson(path.join(zcodeHome(),'v2','credentials.json'))]);
  const load=(key:string)=>typeof encrypted[key]==='string'?decryptZcodeCredential(encrypted[key]).trim():'';
  const family=settings.providerFamilyDomain,selection=settings.providerFamilyConnectionSelections?.[family];
  const headers=await sourceHeaders(file);
  let identity='';
  if(family==='bigmodel'||family==='zai'){
    const stored=load(`oauth:${family}:user_info`);
    if(stored){try{identity=String(JSON.parse(stored).id||'');}catch{throw Error('ZCode 账号资料无效，请重新登录');}}
  }
  const providers:Record<string,any>={},states:Record<string,any>={},materials=new Map<string,AccountMaterial>();
  let reason='';
  const rules=builtin.config?.providerConfigRules?.providerRules||[];
  await Promise.all(rules.filter((rule:any)=>rule.config?.access?.type==='zhipu-account').map(async(rule:any)=>{
    const {providerId,config}=rule,access=config.access,current=access.accountType===family&&!!identity&&(access.mode==='start-plan'||selection?.kind===access.mode);
    providers[providerId]={access:{type:'zhipu-account',entitled:false}};
    states[providerId]={availability:'unavailable',entitled:false,current};
    if(!current||!['start-plan','individual-coding-plan'].includes(access.mode))return;
    try{
      let apiKey='',credentialKey='',models:string[]|undefined,entitled=false;
      if(access.mode==='start-plan'){
        if(load('oauth:active_provider')!==family)return;
        credentialKey='zcodejwttoken';apiKey=load(credentialKey);if(!apiKey)return;
        const response=await officialJson('https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version='+encodeURIComponent(headers['X-ZCode-App-Version']),`Bearer ${apiKey}`,headers),now=(response.data?.server_time||Date.now()/1000);
        const plans=(response.data?.plans||[]).filter((plan:any)=>String(plan.status).toLowerCase()==='active'&&(!plan.ends_at||Number(plan.ends_at)>now));
        entitled=plans.some((plan:any)=>[plan.plan_id,plan.name].some(v=>typeof v==='string'&&/start[- ]plan/i.test(v))||!plan.plan_id&&!plan.name);
        const balances=(response.data?.balances||[]).filter((balance:any)=>plans.some((plan:any)=>balance.user_plan_id&&plan.user_plan_id?balance.user_plan_id===plan.user_plan_id:balance.plan_id===plan.plan_id));
        const labels=balances.flatMap((balance:any)=>{const caps=(balance.capabilities||[]).filter((cap:any)=>typeof cap==='string'&&/^model:/i.test(cap)).map((cap:string)=>cap.slice(6).trim());return caps.length?caps:[balance.show_name||''];});
        const builtinIds=[...new Set<string>(rules.flatMap((entry:any)=>entry.config?.builtinModelIds||[]))];
        models=[...new Set<string>(labels.flatMap((id:string)=>builtinIds.filter((known:string)=>known.toLowerCase()===id.toLowerCase())))];
      }else{
        credentialKey=`account-provider:coding-plan:${encodeURIComponent(providerId)}:account:${encodeURIComponent(identity)}:api-key`;
        apiKey=load(credentialKey);if(!apiKey)return;
        const host=family==='bigmodel'?'https://bigmodel.cn':'https://api.z.ai';
        const response=await officialJson(host+'/api/biz/subscription/list',apiKey,headers);
        entitled=Array.isArray(response.data)&&response.data.some((item:any)=>item.status==='VALID'&&item.inCurrentPeriod===true&&[item.productId,item.productName].some(v=>typeof v==='string'&&/coding/i.test(v)));
      }
      providers[providerId]={access:{type:'zhipu-account',entitled},...(models?{builtinModelIds:models}:{})};
      states[providerId]={availability:entitled?'available':'unavailable',entitled,current};
      if(entitled)materials.set(providerId,{providerId,apiKey,credentialKey,accountScope:sha(JSON.stringify([identity,family,access.mode==='start-plan'?{kind:'start-plan'}:selection??null])),family,mode:access.mode});
    }catch(error){states[providerId]={availability:'unknown',entitled:false,current};reason=(error as Error).message;}
  }));
  const revision=`zcode-builtin:${builtin.revision}:${sha(path.resolve(file))}`;
  return {snapshot:{revision:'gateway-account:'+Date.now(),basedOnZCodeBuiltinRevision:revision,providers,states},reason,
    auth:async params=>{
      const material=materials.get(params.providerId),access=params.accountAccess;
      if(!material||params.modelSelection?.providerId!==material.providerId||access?.accountType&&access.accountType!==material.family||params.expectedAccountScope&&params.expectedAccountScope!==material.accountScope)return {headersApplied:false,errorMessage:'ZCode 当前账号未授权此模型，请刷新账号'};
      if(params.rejectedProjectTokenFingerprint===sha(material.apiKey))return {headersApplied:false,errorMessage:'ZCode 已拒绝当前凭据，请在桌面端刷新登录'};
      // Never send a stale account key after a desktop login/account switch.
      const [latest,latestSettings]=await Promise.all([readJson(path.join(zcodeHome(),'v2','credentials.json')),readJson(path.join(zcodeHome(),'v2','setting.json'))]);
      const currentInfo=typeof latest[`oauth:${material.family}:user_info`]==='string'?JSON.parse(decryptZcodeCredential(latest[`oauth:${material.family}:user_info`])):null;
      const currentKey=typeof latest[material.credentialKey]==='string'?decryptZcodeCredential(latest[material.credentialKey]).trim():'';
      if(String(currentInfo?.id||'')!==identity||latestSettings.providerFamilyDomain!==family||currentKey!==material.apiKey)return {headersApplied:false,errorMessage:'ZCode 账号已变化，请重新发送'};
      return {headersApplied:true,requestAuth:{apiKey:material.apiKey,accountScope:material.accountScope,headers:{...headers,'x-request-id':randomUUID()}}};
    }};
}
