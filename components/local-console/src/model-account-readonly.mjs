import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const home=os.homedir();
function executable(name,extras=[]){return [...extras,...(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,name+'.exe'))].find(file=>fs.existsSync(file));}
function jsonCommand(file,args,timeoutMs=30000){return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('读取超时'));},timeoutMs);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>131072){child.kill();finish(new Error('响应过大'));}});
  child.stderr.on('data',()=>{});
  child.on('error',()=>finish(new Error('无法启动工具')));
  child.on('close',()=>{try{finish(null,JSON.parse(output));}catch{finish(new Error('无法读取状态'));}});
});}
const text=value=>typeof value==='string'?value.slice(0,200):null;
export class ReadonlyModelAccounts{
  agySnapshot=null;
  cached=null;at=0;pending=null;
  async list(){
    if(this.cached&&Date.now()-this.at<60000)return this.cached;
    if(this.pending)return this.pending;
    this.pending=Promise.all([this.agy(),this.claude(),this.grok()]).then(rows=>{this.cached=rows;this.at=Date.now();return rows;}).finally(()=>{this.pending=null;});return this.pending;
  }
  async agy(){
    const file=executable('agy',[path.join(home,'AppData','Local','agy','bin','agy.exe')]);
    const row={app:'agy',name:'AGY / Antigravity',readOnly:true,installed:!!file,configured:false,status:'未安装',windows:[]};
    if(!file)return row;
    try{
      // Only this verified built-in command is allowed: it performs zero agent turns.
      const launcher=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../gateway/dist/services/hidden-console-launcher.exe');
      const useLauncher=process.platform==='win32'&&fs.existsSync(launcher);
      const value=await jsonCommand(useLauncher?launcher:file,[...(useLauncher?[file]:[]),'-p','/usage','--output-format','json'],60000);
      if(value.status!=='SUCCESS'||value.command?.name!=='usage'||value.num_turns!==0||!Array.isArray(value.command?.data?.groups))throw new Error('无有效额度');
      row.configured=true;row.status='额度可读取';row.updatedAt=new Date().toISOString();
      row.windows=value.command.data.groups.flatMap(group=>(Array.isArray(group.buckets)?group.buckets:[]).flatMap(bucket=>{
        const fraction=bucket.remaining_fraction;if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1)return [];
        return [{name:text(group.name)||'AGY',poolId:text(bucket.id),group:text(group.name),description:text(group.description),window:text(bucket.window),remainingPercent:fraction*100,resetsAt:Number.isFinite(Date.parse(bucket.reset_time))?new Date(bucket.reset_time).toISOString():null}];
      }));row.note='额度由当前 AGY 登录读取；此接口未提供账号身份。';this.agySnapshot={...row};
    }catch(error){
      const reason=error.message==='读取超时'?'AGY 额度查询超过 60 秒，请稍后刷新。':error.message==='无法启动工具'?'无法启动 AGY，请检查安装后刷新。':error.message==='无有效额度'?'AGY 未返回有效的只读额度结果，请稍后刷新。':'AGY 状态响应暂不可读取，请稍后刷新。';
      if(this.agySnapshot)return {...this.agySnapshot,status:'上次额度 · 待更新',stale:true,note:reason+' 当前保留上次成功读取的额度。'};
      row.status='额度暂不可读取';row.note=reason;
    }
    return row;
  }
  async claude(){
    const dirs=(process.env.PATH||'').split(path.delimiter);
    const file=executable('claude',dirs.map(dir=>path.join(dir,'node_modules','@anthropic-ai','claude-code','bin','claude.exe')));
    const row={app:'claude',name:'Claude Code',readOnly:true,installed:!!file,configured:false,status:file?'未登录':'未安装'};
    if(!file)return row;
    try{const value=await jsonCommand(file,['auth','status','--json']);
      if(typeof value.loggedIn!=='boolean')throw new Error('状态不完整');
      row.configured=value.loggedIn;row.status=value.loggedIn?'已配置认证':'未登录';
      row.identity=text(value.email);row.authMethod=text(value.authMethod);row.note=value.loggedIn?'CLI 报告认证已配置；额度未提供。':'请在 Claude Code 中完成登录或配置 API Key。';
    }catch{row.status='状态暂不可读取';row.note='请检查 Claude Code 安装后刷新。';}return row;
  }
  async grok(){
    const file=executable('grok',[path.join(home,'.grok','bin','grok.exe')]);
    const row={app:'grok',name:'Grok',readOnly:true,installed:!!file,configured:false,status:file?'未登录 / 未配置':'未安装'};
    try{
      const authFile=path.join(home,'.grok','auth.json');
      const auth=fs.existsSync(authFile)?JSON.parse(fs.readFileSync(authFile,'utf8')):{};
      const hasCredential=Object.values(auth).some(value=>value&&typeof value==='object'&&typeof value.key==='string'&&value.key.length>0);
      row.configured=!!process.env.XAI_API_KEY||hasCredential;
      row.status=row.configured?'已保存凭据':'未登录 / 未配置';
      row.note=row.configured?'本机凭据存在；有效性、账号身份与额度尚未核验。':'尚未发现本机登录凭据或 XAI_API_KEY。';
    }catch{row.status='状态暂不可读取';row.note='无法读取本机 Grok 配置。';}return row;
  }
}
