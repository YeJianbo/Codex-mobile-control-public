import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {protect} from './store.mjs';
import {fetchClaudeUsage} from './claude-oauth-usage.mjs';
import {HarnessProfiles} from './harness-profiles.mjs';

const AUTH_KEYS=['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','CLAUDE_CODE_OAUTH_TOKEN'];
const PROFILE_ENV=/^(?:CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_(?:BASE_URL|AUTH_TOKEN|API_KEY|MODEL|REASONING_MODEL|DEFAULT_[A-Z0-9_]+_MODEL(?:_NAME)?))$/;
const OBJECT=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.replace(/[\r\n\0]/g,' ').slice(0,160):null;
const read=file=>{if(!fs.existsSync(file))return {};try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!OBJECT(value))throw 0;return value;}catch{throw new Error('Claude 本地配置不是有效 JSON，请先修复配置文件');}};
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function token(value){if(typeof value!=='string'||!value.trim()||value.length>32768||/[\r\n\0]/.test(value))throw new Error('Claude 凭据格式不正确');return value.trim();}
function official(base){if(!base)return true;try{const u=new URL(base);return u.origin==='https://api.anthropic.com'&&!u.username&&!u.password;}catch{return false;}}
function normalize(input){
  if(!OBJECT(input))throw new Error('请选择有效的 Claude 凭据 JSON 文件');
  const credentials=input.credentials??input,settings=input.settings??input,sourceEnv=settings.env??input.env??{};
  if(!OBJECT(credentials)||!OBJECT(settings)||!OBJECT(sourceEnv))throw new Error('Claude 凭据 JSON 结构不正确');
  const env={};for(const key of Object.keys(sourceEnv).filter(key=>PROFILE_ENV.test(key)).sort()){if(sourceEnv[key]!=null&&sourceEnv[key]!==''){env[key]=token(sourceEnv[key]);if(key==='ANTHROPIC_BASE_URL'){let url;try{url=new URL(env[key]);}catch{throw new Error('Claude 服务地址无效');}if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Claude 服务地址需使用 HTTPS；本机服务可使用 HTTP');}}
  }
  let oauth=null;
  if(credentials.claudeAiOauth!=null){const value=credentials.claudeAiOauth;if(!OBJECT(value))throw new Error('claudeAiOauth 格式不正确');oauth={accessToken:token(value.accessToken)};if(value.refreshToken)oauth.refreshToken=token(value.refreshToken);if(value.expiresAt!=null){if(typeof value.expiresAt!=='number'||!Number.isFinite(value.expiresAt)||value.expiresAt<=0)throw new Error('Claude OAuth 到期时间格式不正确');oauth.expiresAt=value.expiresAt;}if(value.scopes!=null){if(!Array.isArray(value.scopes)||!value.scopes.every(s=>typeof s==='string'&&s.length<=100))throw new Error('Claude OAuth scope 格式不正确');oauth.scopes=value.scopes;}for(const key of ['subscriptionType','rateLimitTier'])if(value[key])oauth[key]=text(value[key]);}
  const legacyApiKey=input.legacyApiKey?token(input.legacyApiKey):null;
  if(!oauth&&!env.CLAUDE_CODE_OAUTH_TOKEN&&!env.ANTHROPIC_AUTH_TOKEN&&!env.ANTHROPIC_API_KEY&&!legacyApiKey)throw new Error('未发现 Claude OAuth、API Key 或认证令牌');
  const account=OBJECT(input.oauthAccount)?Object.fromEntries(['accountUuid','organizationUuid','emailAddress','displayName','hasExtraUsageEnabled','billingType','tokenCreatedAt','subscriptionCreatedAt'].flatMap(key=>['string','boolean','number'].includes(typeof input.oauthAccount[key])?[[key,input.oauthAccount[key]]]:[])):null;
  const model=settings.model==null?null:text(settings.model);if(settings.model!=null&&(!model||typeof settings.model!=='string'))throw new Error('Claude 模型 ID 无效');
  return {oauth,env,model,legacyApiKey,oauthAccount:account,identity:text(input.identity)||text(account?.emailAddress)};
}
function effective(snapshot){
  const env=snapshot.env;
  if(!official(env.ANTHROPIC_BASE_URL))return {kind:'token',available:false,reason:'当前使用中转服务；Claude 官方订阅额度不适用于此配置'};
  if(env.ANTHROPIC_AUTH_TOKEN||env.ANTHROPIC_API_KEY||snapshot.legacyApiKey)return {kind:'api',available:false,reason:'当前使用 API Key 或认证令牌，未发现可读取订阅额度的 Claude OAuth 登录'};
  const accessToken=env.CLAUDE_CODE_OAUTH_TOKEN||snapshot.oauth?.accessToken;
  if(!accessToken)return {kind:'none',available:false,reason:'未发现可读取 Claude 订阅额度的 OAuth 凭据'};
  if(!env.CLAUDE_CODE_OAUTH_TOKEN&&snapshot.oauth.expiresAt&&snapshot.oauth.expiresAt<=Date.now())return {kind:'oauth',available:false,reason:'Claude OAuth 登录已过期，请在 Claude Code 重新登录后重新导入'};
  if(!env.CLAUDE_CODE_OAUTH_TOKEN&&snapshot.oauth.scopes&&!snapshot.oauth.scopes.includes('user:profile'))return {kind:'oauth',available:false,reason:'Claude OAuth 缺少 user:profile 权限，不能读取订阅额度'};
  return {kind:'oauth',available:true,accessToken};
}
function same(a,b){return JSON.stringify(a?.env)===JSON.stringify(b?.env)&&a?.model===b?.model&&a?.oauth?.accessToken===b?.oauth?.accessToken&&a?.legacyApiKey===b?.legacyApiKey;}
// An unsaved CLI login can change outside this app. A secret-derived owner key
// prevents its quota history from being attributed to the next local login.
function owner(snapshot){return 'local-'+crypto.createHash('sha256').update(JSON.stringify([snapshot.oauth?.refreshToken||snapshot.oauth?.accessToken||null,snapshot.env,snapshot.legacyApiKey])).digest('hex');}

export class ClaudeAccountManager{
  constructor({dir,claudeHome=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),userHome=os.homedir(),environment=process.env,seal=value=>protect(value),unseal=value=>protect(value,true),fetchUsage=fetchClaudeUsage,harnessProfiles}={}){
    this.dir=dir||path.join(environment.CODEX_HOME||path.join(userHome,'.codex'),'codexmate','local-console');this.claudeHome=claudeHome;this.globalFile=path.resolve(claudeHome)===path.resolve(path.join(userHome,'.claude'))?path.join(userHome,'.claude.json'):path.join(claudeHome,'.claude.json');this.environment=environment;this.file=path.join(this.dir,'claude-accounts.json');this.historyFile=path.join(this.dir,'claude-usage-history.json');this.seal=seal;this.unseal=unseal;this.fetchUsage=fetchUsage;this.harnessProfiles=harnessProfiles||new HarnessProfiles({home:userHome,storeDir:this.dir});this.pending=Promise.resolve();this.cooldown=new Map();
  }
  state(){const state=read(this.file);return {version:1,selectedId:state.selectedId||null,items:Array.isArray(state.items)?state.items:[]};}
  native(){
    const settings=read(path.join(this.claudeHome,'settings.json')),credentials=read(path.join(this.claudeHome,'.credentials.json')),global=read(this.globalFile);
    const env={...(settings.env||{})};for(const key of AUTH_KEYS)if(this.environment[key])env[key]=this.environment[key];
    try{return normalize({credentials,settings:{env,model:settings.model},oauthAccount:global.oauthAccount,legacyApiKey:global.primaryApiKey});}
    catch(error){if(error.message==='未发现 Claude OAuth、API Key 或认证令牌')return null;throw error;}
  }
  history(){const value=read(this.historyFile);return Array.isArray(value.points)?value.points:[];}
  describe(snapshot){const value=effective(snapshot);let host=null;try{host=snapshot.env.ANTHROPIC_BASE_URL?new URL(snapshot.env.ANTHROPIC_BASE_URL).host:'api.anthropic.com';}catch{}return {configured:true,identity:value.kind==='oauth'?snapshot.identity:null,authMethod:value.kind==='oauth'?'Claude OAuth':value.kind==='token'?'中转令牌':'API Key / 认证令牌',serviceHost:host,baseUrl:snapshot.env.ANTHROPIC_BASE_URL||'https://api.anthropic.com',model:snapshot.model||snapshot.env.ANTHROPIC_MODEL||null,modelRoles:Object.fromEntries(['sonnet','opus','haiku'].map(role=>[role,snapshot.env['ANTHROPIC_DEFAULT_'+role.toUpperCase()+'_MODEL']||null])),hasKey:!!(snapshot.env.ANTHROPIC_AUTH_TOKEN||snapshot.env.ANTHROPIC_API_KEY||snapshot.legacyApiKey),authType:snapshot.env.ANTHROPIC_API_KEY||snapshot.legacyApiKey?'apiKey':'authToken',usageAvailable:value.available,usageReason:value.reason||null,plan:text(snapshot.oauth?.subscriptionType),expiresAt:snapshot.oauth?.expiresAt?new Date(snapshot.oauth.expiresAt).toISOString():null};}
  async list(){
    const state=this.state(),points=this.history();let current=null,currentError=null;
    try{const snapshot=this.native();current=snapshot?{id:'current',name:'当前 Claude 配置',...this.describe(snapshot)}:{id:'current',name:'当前 Claude 配置',configured:false,usageAvailable:false,usageReason:'本机未发现 Claude 登录凭据，请先在 Claude Code 登录'};}
    catch(error){currentError=error.message;current={id:'current',name:'当前 Claude 配置',configured:false,usageAvailable:false,usageReason:currentError};}
    const native=current?.configured?this.native():null;
    const items=await Promise.all(state.items.map(async item=>{try{const snapshot=JSON.parse(await this.unseal(item.secret)),active=native&&same(native,snapshot);return {id:item.id,name:item.name,createdAt:item.createdAt,updatedAt:item.updatedAt,active:!!active,...this.describe(snapshot)};}catch{return {id:item.id,name:item.name,configured:false,usageAvailable:false,usageReason:'无法解密此账号，请使用保存时的 Windows 用户重新导入'};}}));
    const active=items.find(item=>item.active);if(active)current.savedId=active.id;
    const selectedId=state.selectedId&&items.some(item=>item.id===state.selectedId)?state.selectedId:'current';
    const selected=selectedId==='current'?current:items.find(item=>item.id===selectedId);
    const ownerId=selectedId==='current'?(active?.id||(native?owner(native):'no-login')):selectedId;
    const history=points.filter(point=>point.accountId===ownerId).slice(-720),latest=history.at(-1)||null;
    let externalProfiles=[];try{externalProfiles=this.harnessProfiles.rows('claude').map(row=>{let settings={};try{settings=JSON.parse(row.settings_config);}catch{}return {id:row.id,name:text(row.name),category:row.category,baseUrl:text(settings.env?.ANTHROPIC_BASE_URL),model:text(settings.model)||text(settings.env?.ANTHROPIC_MODEL)};});}catch{}
    return {app:'claude',name:'Claude Code',current,items,externalProfiles,selectedId,selected,latest,history,canSwitch:!AUTH_KEYS.some(key=>!!this.environment[key]),switchReason:AUTH_KEYS.some(key=>!!this.environment[key])?'Claude 认证被当前进程环境变量覆盖，请先在启动环境中移除对应变量再切换':null,source:{name:'CodexBar · MIT',url:'https://github.com/steipete/CodexBar'}};
  }
  act(action,input={}){const operation=this.pending.then(()=>this.perform(action,input));this.pending=operation.catch(()=>{});return operation;}
  async perform(action,input){
    if(action==='import-cc-switch'){const profile=await this.harnessProfiles.resolvedProfile('claude',input.id);return this.perform('import',{name:input.name||profile.name,credentials:{settings:profile.settings}});}
    if(action==='preview-switch'){const state=await this.list(),target=state.items.find(item=>item.id===input.id);if(!target)throw new Error('请选择已导入的 Claude 账号');if(!state.canSwitch)throw new Error(state.switchReason);return {id:target.id,planId:target.id,canSwitch:true,label:target.name,from:state.current,to:target,changes:['Claude 本地认证配置','后续新建 Claude 会话使用的账号'],message:'已运行的 Claude 会话需要重新打开'};}
    if(action==='select'){const state=this.state(),id=input.id||'current';if(id!=='current'&&!state.items.some(item=>item.id===id))throw new Error('Claude 账号不存在');state.selectedId=id;write(this.file,state);return this.list();}
    if(action==='import'||action==='import-current'){
      let source;if(action!=='import-current'){try{source=typeof input.json==='string'?JSON.parse(input.json):input.credentials??input.data;}catch{throw new Error('导入文件不是有效 JSON');}}
      const snapshot=action==='import-current'?this.native():normalize(source);
      if(!snapshot)throw new Error('当前 Claude 没有可导入的登录凭据');
      const name=text(input.name)?.trim();if(!name)throw new Error('请填写账号名称');
      const state=this.state();if(state.items.length>=100)throw new Error('已达到 100 个 Claude 账号上限');
      for(const item of state.items){let stored;try{stored=JSON.parse(await this.unseal(item.secret));}catch{continue;}if(same(snapshot,stored)){item.name=name;item.secret=await this.seal(JSON.stringify(snapshot));item.updatedAt=new Date().toISOString();state.selectedId=item.id;write(this.file,state);return {...await this.list(),message:'已更新 Claude 账号快照'};}}
      const at=new Date().toISOString(),item={id:crypto.randomUUID(),name,createdAt:at,updatedAt:at,secret:await this.seal(JSON.stringify(snapshot))};state.items.push(item);state.selectedId=item.id;write(this.file,state);const oldOwner=owner(snapshot),points=this.history();if(points.some(point=>point.accountId===oldOwner))write(this.historyFile,{version:1,points:points.map(point=>point.accountId===oldOwner?{...point,accountId:item.id}:point)});return {...await this.list(),message:'Claude 账号已导入，当前登录未改变'};
    }
    if(action==='refresh')return this.refresh(input.id);
    if(action==='switch')return this.switch(input.id);
    throw new Error('不支持的 Claude 账号操作');
  }
  async refresh(id){
    const state=this.state();id=id||state.selectedId||'current';let snapshot,accountId=id;
    if(id==='current'){snapshot=this.native();if(snapshot){accountId=owner(snapshot);for(const item of state.items){try{if(same(snapshot,JSON.parse(await this.unseal(item.secret)))){accountId=item.id;break;}}catch{}}}else accountId='no-login';}
    else{const item=state.items.find(item=>item.id===id);if(!item)throw new Error('Claude 账号不存在');try{snapshot=JSON.parse(await this.unseal(item.secret));}catch{throw new Error('无法解密 Claude 账号，请重新导入');}}
    const at=new Date().toISOString();let point;
    try{if(!snapshot)throw new Error('本机未发现 Claude 登录凭据');const credential=effective(snapshot);if(!credential.available)throw new Error(credential.reason);if((this.cooldown.get(accountId)||0)>Date.now())throw new Error('Claude 额度接口暂在冷却中，请稍后刷新');const windows=await this.fetchUsage(credential.accessToken);point={accountId,at,status:'ok',windows};}
    catch(error){if(error.retryAt)this.cooldown.set(accountId,error.retryAt);point={accountId,at,status:'unavailable',reason:error.message,windows:[]};}
    const points=this.history();points.push(point);write(this.historyFile,{version:1,points:points.slice(-20000)});const result=await this.list();return {...result,sample:point,message:point.status==='ok'?'Claude 额度已刷新并保存历史':point.reason};
  }
  async switch(id){
    if(AUTH_KEYS.some(key=>!!this.environment[key]))throw new Error('Claude 认证被当前进程环境变量覆盖，请先移除对应变量再切换');
    const state=this.state(),item=state.items.find(item=>item.id===id);if(!item)throw new Error('请选择已导入的 Claude 账号');
    let snapshot;try{snapshot=JSON.parse(await this.unseal(item.secret));}catch{throw new Error('无法解密 Claude 账号，请重新导入');}
    const files=[path.join(this.claudeHome,'settings.json'),path.join(this.claudeHome,'.credentials.json'),this.globalFile],original=files.map(file=>({file,exists:fs.existsSync(file),data:read(file)}));
    const settings=structuredClone(original[0].data),credentials=structuredClone(original[1].data),global=structuredClone(original[2].data);
    settings.env={...(settings.env||{})};for(const key of Object.keys(settings.env))if(PROFILE_ENV.test(key))delete settings.env[key];Object.assign(settings.env,snapshot.env);if(snapshot.model)settings.model=snapshot.model;else delete settings.model;
    if(snapshot.oauth)credentials.claudeAiOauth=snapshot.oauth;else delete credentials.claudeAiOauth;
    if(snapshot.oauthAccount)global.oauthAccount=snapshot.oauthAccount;else delete global.oauthAccount;
    if(snapshot.legacyApiKey)global.primaryApiKey=snapshot.legacyApiKey;else delete global.primaryApiKey;
    // The backup is encrypted with the same Windows user protection as imported credentials.
    const backup=path.join(this.dir,'claude-account-backups',Date.now()+'-'+crypto.randomUUID()+'.json');write(backup,{at:new Date().toISOString(),secret:await this.seal(JSON.stringify(original))});
    try{for(const [index,value] of [settings,credentials,global].entries())write(files[index],value);}
    catch{for(const entry of original){try{if(entry.exists)write(entry.file,entry.data);else if(fs.existsSync(entry.file))fs.unlinkSync(entry.file);}catch{}}throw new Error('写入 Claude 配置失败，已尝试恢复切换前配置');}
    state.selectedId=id;write(this.file,state);return {...await this.list(),message:'Claude 账号已切换；新建 Claude 会话使用此配置，已运行会话请重新打开'};
  }
}
