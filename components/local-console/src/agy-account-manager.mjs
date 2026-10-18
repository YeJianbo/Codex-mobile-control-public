import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {protect} from './store.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const safeText=value=>typeof value==='string'?value.slice(0,200):'';
function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw new Error('无法读取 AGY 本机账号文件');}}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function claims(token){try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{return {};}}
function credential(value){
  const token=value?.token;
  if(!token||typeof token.refresh_token!=='string'||!token.refresh_token||typeof token.access_token!=='string'||!token.access_token||!Number.isFinite(Date.parse(token.expiry)))throw new Error('账号凭据格式不受支持，请在 AGY 中重新登录');
  return {token:{access_token:token.access_token,refresh_token:token.refresh_token,token_type:'Bearer',expiry:new Date(token.expiry).toISOString()},auth_method:value.auth_method||'consumer',...(typeof value.id_token==='string'?{id_token:value.id_token}:{})};
}
function toolsCredential(account){
  const token=account?.token;
  const stamp=token?.expiry_timestamp;
  if(!Number.isFinite(stamp))throw new Error('账号凭据过期时间缺失');
  return credential({token:{...token,expiry:new Date(stamp*(stamp>1e11?1:1000)).toISOString()},auth_method:'consumer',id_token:token.id_token});
}
function credentialStore(request){
  if(process.platform!=='win32')throw new Error('AGY 系统账号切换需要 Windows 凭据管理器');
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(here,'agy-credentials.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('AGY 系统凭据操作超时'));},15000);
    child.stdout.on('data',data=>{output+=data;if(output.length>131072){child.kill();finish(new Error('AGY 系统凭据响应异常'));}});child.stderr.on('data',()=>{});
    child.on('error',()=>finish(new Error('无法启动 AGY 系统凭据工具')));
    child.on('close',code=>{try{if(code!==0)throw new Error();finish(null,JSON.parse(output));}catch{finish(new Error('无法访问 AGY 系统凭据'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
  });
}
export class AgyAccountManager {
  #quotaOwner;
  constructor({directory,home=os.homedir(),encrypt=protect,systemCredential=credentialStore,now=()=>Date.now(),acpCredentialFile=null}={}){
    if(!directory)throw new Error('缺少 AGY 账号存储目录');
    this.directory=path.join(directory,'agy-accounts');this.home=home;this.encrypt=encrypt;this.systemCredential=systemCredential;this.now=now;this.acpCredentialFile=acpCredentialFile;
    this.vaultFile=path.join(this.directory,'credentials.dpapi.json');this.historyFile=path.join(this.directory,'quota-history.json');this.cliFile=path.join(home,'.gemini','antigravity-cli','antigravity-oauth-token');this.toolsDir=path.join(home,'.antigravity_tools');this.pending=Promise.resolve();
  }
  async vault(){const saved=read(this.vaultFile);if(!saved)return {version:1,accounts:[]};try{const value=JSON.parse(await this.encrypt(saved.ciphertext,true));if(!Array.isArray(value.accounts))throw new Error();return value;}catch{throw new Error('无法解密 AGY 账号，请使用保存账号的 Windows 用户');}}
  async save(vault){write(this.vaultFile,{version:1,ciphertext:await this.encrypt(JSON.stringify(vault))});}
  serialize(operation){const current=this.pending.then(operation);this.pending=current.catch(()=>{});return current;}
  tools(){
    const index=read(path.join(this.toolsDir,'accounts.json'),{accounts:[]});
    return (Array.isArray(index.accounts)?index.accounts:[]).flatMap(entry=>{
      if(!/^[a-zA-Z0-9-]{1,100}$/.test(entry.id||''))return [];
      try{const account=read(path.join(this.toolsDir,'accounts',entry.id+'.json'));if(!account)return [];const native=toolsCredential(account);return [{sourceId:entry.id,email:safeText(account.email),name:safeText(account.name),disabled:!!account.disabled,credential:native,quota:account.quota}];}catch{return [];}
    });
  }
  async current(){
    const system=await this.systemCredential({action:'read'});
    try{const value=system.payload?JSON.parse(system.payload):read(this.cliFile);return value?credential(value):null;}catch{throw new Error('当前 AGY 凭据格式不支持，请重新登录');}
  }
  async list(){
    const vault=await this.vault(),sources=this.tools();let active=null,currentError=null;
    try{active=await this.current();}catch(error){currentError=error.message;}
    const match=active?vault.accounts.find(account=>account.credential.token.refresh_token===active.token.refresh_token):null;
    const acp=this.acpCredentialFile?read(this.acpCredentialFile):null;
    const acpMatch=acp?vault.accounts.find(account=>account.credential.token.refresh_token===acp.token?.refresh_token):null;
    const items=vault.accounts.map(account=>({id:account.id,email:account.email,name:account.name,source:account.source,importedAt:account.importedAt,expiresAt:account.credential.token.expiry,active:match?.id===account.id,acpActive:acpMatch?.id===account.id,disabled:!!account.disabled}));
    const email=claims(active?.id_token||'').email;
    return {items,current:{accountId:match?.id||null,email:match?.email||safeText(email)||null,configured:!!active,error:currentError},targets:[{id:'cli',name:'AGY CLI',available:!currentError},{id:'acp',name:'AGY ACP',available:!!this.acpCredentialFile}],sources:sources.map(source=>({id:source.sourceId,email:source.email,name:source.name,disabled:source.disabled,imported:vault.accounts.some(account=>account.sourceId===source.sourceId),quotaUpdatedAt:Number.isFinite(source.quota?.last_updated)&&Number.isFinite(new Date(source.quota.last_updated*1000).valueOf())?new Date(source.quota.last_updated*1000).toISOString():null})),reference:'https://github.com/lbjlaq/Antigravity-Manager'};
  }
  import(input={}){return this.serialize(async()=>{
    const vault=await this.vault();let incoming=[];
    if(input.source==='tools'){
      const ids=input.accountIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw new Error('请选择要导入的账号');
      incoming=this.tools().filter(source=>ids===undefined||ids.includes(source.sourceId)).map(source=>({...source,source:'tools'}));
    }else if(input.source==='current'){
      const current=await this.current();if(!current)throw new Error('尚未发现当前 AGY 登录');const identity=claims(current.id_token||'');
      incoming=[{credential:current,email:safeText(identity.email),name:safeText(input.name)||safeText(identity.name)||'当前 AGY 账号',source:'current'}];
    }else throw new Error('请选择 AGY 账号来源');
    if(!incoming.length)throw new Error('所选来源没有可导入的有效账号');
    const records=[];
    for(const source of incoming){let account=vault.accounts.find(item=>item.credential.token.refresh_token===source.credential.token.refresh_token||source.sourceId&&item.sourceId===source.sourceId);if(!account){account={id:randomUUID(),importedAt:new Date(this.now()).toISOString()};vault.accounts.push(account);}Object.assign(account,{email:source.email,name:source.name,source:source.source,sourceId:source.sourceId,disabled:source.disabled,credential:source.credential});records.push({account,quota:source.quota});}
    await this.save(vault);
    for(const {account,quota} of records)if(quota&&Number.isFinite(quota.last_updated))this.recordQuota({updatedAt:new Date(quota.last_updated*1000).toISOString(),windows:(quota.models||[]).map(model=>({name:safeText(model.display_name||model.name),window:'模型额度',remainingPercent:model.percentage,resetsAt:model.reset_time}))},{accountId:account.id,source:'tools-cache'});
    return {imported:incoming.length,message:`已导入 ${incoming.length} 个 AGY 账号`,...await this.list()};
  });}
  select(input={}){return this.serialize(async()=>{
    if(!['cli','acp'].includes(input.target))throw new Error('请选择 AGY CLI 或 ACP');
    if(input.target==='acp'&&!this.acpCredentialFile)throw new Error('AGY ACP 账号目录尚未配置');
    const vault=await this.vault(),account=vault.accounts.find(item=>item.id===input.accountId);if(!account)throw new Error('AGY 账号不存在，请先导入');if(account.disabled)throw new Error('此账号在来源中已停用，请先完成重新登录');
    const file=input.target==='cli'?this.cliFile:this.acpCredentialFile;
    const priorFile=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
    const priorSystem=input.target==='cli'?(await this.systemCredential({action:'read'})).payload:null;
    const backupId=randomUUID();write(path.join(this.directory,'backups',backupId+'.json'),{at:new Date(this.now()).toISOString(),target:input.target,ciphertext:await this.encrypt(JSON.stringify({file:priorFile,system:priorSystem}))});
    try{
      write(file,credential(account.credential));
      if(input.target==='cli')await this.systemCredential({action:'write',payload:JSON.stringify(credential(account.credential))});
      const stored=input.target==='cli'?await this.current():credential(read(file));
      if(stored?.token.refresh_token!==account.credential.token.refresh_token)throw new Error('AGY 账号切换未通过读取确认');
    }catch(error){
      let recovered=true;try{if(priorFile===null){if(fs.existsSync(file))fs.unlinkSync(file);}else fs.writeFileSync(file,priorFile,{mode:0o600});if(input.target==='cli')await this.systemCredential(priorSystem?{action:'write',payload:priorSystem}:{action:'clear'});}catch{recovered=false;}
      throw new Error(recovered?'AGY 账号切换失败，已恢复原凭据':`AGY 账号切换失败；自动恢复未完成，请使用本机备份 ${backupId}`);
    }
    return {switched:true,target:input.target,backupId,message:`已切换 ${input.target==='cli'?'AGY CLI':'AGY ACP'} 账号，新建进程使用此账号`,...await this.list()};
  });}
  recordQuota(row,{accountId=null,source='cli-live'}={}){
    if(row?.stale||!Array.isArray(row?.windows)||!row.windows.length)return null;
    const time=Date.parse(row.updatedAt);if(!Number.isFinite(time))return null;
    const windows=row.windows.flatMap(window=>typeof window.remainingPercent==='number'&&Number.isFinite(window.remainingPercent)&&window.remainingPercent>=0&&window.remainingPercent<=100?[{name:safeText(window.name)||'AGY',window:safeText(window.window),remainingPercent:window.remainingPercent,resetsAt:Number.isFinite(Date.parse(window.resetsAt))?new Date(window.resetsAt).toISOString():null}]:[]);if(!windows.length)return null;
    const history=read(this.historyFile,{points:[]}),point={at:new Date(time).toISOString(),accountId,source,windows};
    if(history.points.some(prior=>prior.at===point.at&&prior.accountId===accountId&&prior.source===source))return point;
    const previous=history.points.findLast(prior=>prior.accountId===accountId&&prior.source===source);
    if(previous&&time>=Date.parse(previous.at)&&time-Date.parse(previous.at)<60000&&JSON.stringify(previous.windows)===JSON.stringify(windows))return previous;
    history.points.push(point);history.points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));history.points=history.points.slice(-12000);write(this.historyFile,history);return point;
  }
  async captureQuota(row){let accountId=null;try{accountId=(await this.list()).current.accountId;}catch{}return this.recordQuota(row,{accountId});}
  withQuotaRefresh(loadAccounts,{invalidateCache=()=>{}}={}){return this.serialize(async()=>{
    // 系统凭据也可由 Tools 修改；前后比较仅留在内存中，不把凭据放进历史。
    let before=null,beforeReadFailed=false;try{before=await this.current();}catch{beforeReadFailed=true;await invalidateCache();}
    const beforeOwner=before?.token.refresh_token||null;
    if(this.#quotaOwner!==beforeOwner)await invalidateCache();
    const vault=await this.vault(),accountId=vault.accounts.find(account=>account.credential.token.refresh_token===beforeOwner)?.id||null;
    const result=await loadAccounts();
    let after=null,readFailed=false;try{after=await this.current();}catch{readFailed=true;}
    const afterOwner=after?.token.refresh_token||null;
    if(beforeReadFailed||readFailed||beforeOwner!==afterOwner){
      await invalidateCache();this.#quotaOwner=undefined;
      return {...result,accounts:(result?.accounts||[]).map(account=>account.app==='agy'?{...account,windows:[],stale:true,status:'账号已变化 · 请刷新额度',note:'查询期间 AGY 账号发生变化，已丢弃本次额度响应。'}:account)};
    }
    this.#quotaOwner=beforeOwner;
    const row=result?.accounts?.find(account=>account.app==='agy');if(row)this.recordQuota(row,{accountId});return result;
  });}
  history({accountId,days=7}={}){const count=Math.max(1,Math.min(90,Number(days)||7)),since=this.now()-count*86400000;return {days:count,points:read(this.historyFile,{points:[]}).points.filter(point=>Date.parse(point.at)>=since&&(!accountId||point.accountId===accountId)),note:'历史从成功读取额度或导入本机缓存开始记录；缓存保留原始采集时间。'};}
}
