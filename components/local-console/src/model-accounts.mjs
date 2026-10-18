import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ReadonlyModelAccounts} from './model-account-readonly.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));

const codexBase='https://chatgpt.com/backend-api/codex';
export function validateAccountInput(input,action='save'){
  if(!input||!['deepseek','hermes'].includes(input.app))throw new Error('请选择支持的助手');
  const baseUrl=String(input.baseUrl||'').trim().replace(/\/+$/,'');
  let url;try{url=new URL(baseUrl);}catch{throw new Error('请填写有效的服务地址');}
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('服务地址需使用 HTTPS；本机服务可使用 HTTP，地址不能包含密钥或查询参数');
  const model=String(input.model||'').trim(),apiKey=String(input.apiKey||'').trim();
  if((action!=='models'&&!model)||model.length>256||/[\r\n\0]/.test(model))throw new Error('请填写有效的模型 ID');
  if(apiKey.length>8192||/[\r\n\0]/.test(apiKey))throw new Error('API Key 格式不正确');
  const provider=String(input.provider||(input.app==='deepseek'?'deepseek-official':'openrouter')).trim();
  if(input.app==='deepseek'&&!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(provider))throw new Error('请选择支持的供应商');
  if(input.app==='hermes'&&!['openrouter','openai-api','openai-codex','deepseek','anthropic','custom'].includes(provider))throw new Error('请选择支持的供应商');
  if(provider==='openai-codex'&&(input.app!=='hermes'||baseUrl!==codexBase||apiKey))throw new Error('OpenAI 授权使用官方地址，无需填写 API Key');
  let apiMode=String(input.apiMode||'').trim();
  if(apiMode){
    const modes=input.app==='deepseek'?{'anthropic-messages':'anthropic-messages',anthropic_messages:'anthropic-messages','openai-responses':'openai-responses',responses:'openai-responses',codex_responses:'openai-responses','openai-completions':'openai-completions',chat_completions:'openai-completions'}:{'anthropic-messages':'anthropic_messages',anthropic_messages:'anthropic_messages','openai-responses':'codex_responses',responses:'codex_responses',codex_responses:'codex_responses','openai-completions':'chat_completions',chat_completions:'chat_completions'};
    apiMode=modes[apiMode];if(!apiMode)throw new Error('请选择支持的接口协议');
  }
  return {app:input.app,baseUrl,model,apiKey,provider,...(apiMode?{apiMode}:{})};
}

function installations(){
  const wrappers=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'tools','harnesses');
  const read=file=>{try{return fs.readFileSync(file,'utf8');}catch{return '';}};
  const candidates=(configured,name)=>configured?[configured]:[path.join(wrappers,name+'.cmd'),...(process.env.PATH||'').split(path.delimiter).filter(Boolean).flatMap(dir=>[path.join(dir,name+'.cmd'),path.join(dir,name+'.exe')])];
  let deepseek=null,hermes=null;
  for(const file of candidates(process.env.CODEX_MOBILE_CONTROL_DEEPSEEK_BIN,'dsh')){
    if(!fs.existsSync(file))continue;
    const bin=read(file).match(/"([^"\r\n]+[\\/]lib[\\/]bin\.js)"/i)?.[1];
    const root=bin?path.dirname(path.dirname(bin)):path.join(path.dirname(file),'node_modules','@deepseek-ai','dsh');
    if(fs.existsSync(path.join(root,'lib','bin.js'))){deepseek=root;break;}
  }
  for(const file of candidates(process.env.CODEX_MOBILE_CONTROL_HERMES_BIN,'hermes')){
    if(!fs.existsSync(file))continue;
    const executable=file.endsWith('.cmd')?read(file).match(/"([^"\r\n]+python\.exe)"\s+-m\s+hermes_cli\.main/i)?.[1]:path.resolve(path.dirname(file),'..','python.exe');
    if(executable&&fs.existsSync(executable)){hermes=executable;break;}
  }
  return {deepseek,hermes};
}

function helper(app,installation,input){
  const executable=app==='deepseek'?process.execPath:installation;
  const args=app==='deepseek'?[path.join(here,'model-account-deepseek.mjs'),installation]:[path.join(here,'model-account-hermes.py')];
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,HERMES_DISABLE_LAZY_INSTALLS:'1',PYTHONUTF8:'1'}});
    let output='',finished=false;
    const timeout=setTimeout(()=>{child.kill();finish(new Error('读取或检查模型账户超时，请稍后重试'));},30000);
    function finish(error,value){if(finished)return;finished=true;clearTimeout(timeout);error?reject(error):resolve(value);}
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>128*1024){child.kill();finish(new Error('模型账户响应异常'));}});
    // 原生工具异常可能带凭据；不向页面转发 stderr。
    child.stderr.on('data',()=>{});
    child.on('error',()=>finish(new Error('无法启动模型配置工具')));
    child.on('close',code=>{try{const result=JSON.parse(output.trim());if(result.error)finish(new Error(result.error));else if(code!==0)finish(new Error('模型配置工具执行失败'));else finish(null,result);}catch{finish(new Error('无法读取原生模型配置，请检查助手安装和配置文件'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}

export class ModelAccounts{
  readonlyAccounts=new ReadonlyModelAccounts();
  pending=Promise.resolve();
  oauthJob=null;
  oauthStatus(){const job=this.oauthJob;return job?{state:job.state,verificationUrl:job.verificationUrl||null,userCode:job.userCode||null,message:job.message||''}:{state:'idle'};}
  startOAuth(){
    if(this.oauthJob?.state==='waiting')return this.oauthStatus();
    const installed=installations();if(!installed.hermes)throw new Error('未找到本机 Hermes 安装');
    const job={state:'waiting',message:'正在获取 OpenAI 授权码'};this.oauthJob=job;
    const child=spawn(installed.hermes,[path.join(here,'model-account-hermes.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,HERMES_DISABLE_LAZY_INSTALLS:'1',PYTHONUTF8:'1'}});
    job.child=child;let buffer='';
    const finish=(state,message)=>{if(job.state!=='waiting')return;clearTimeout(job.timeout);job.state=state;job.message=message;job.userCode=null;job.verificationUrl=null;};
    job.timeout=setTimeout(()=>{finish('error','授权等待超时，请重新发起');child.kill();},600000);job.timeout.unref();
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>16384){finish('error','授权响应异常');child.kill();return;}
      let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
        const event=JSON.parse(line);
        if(event.event==='challenge'&&event.verificationUrl==='https://auth.openai.com/codex/device'&&/^[A-Z0-9-]{4,32}$/i.test(event.userCode||'')&&job.state==='waiting')Object.assign(job,{verificationUrl:event.verificationUrl,userCode:event.userCode,message:'在 OpenAI 页面输入授权码，完成登录'});
        else if(event.event==='complete')finish('complete','OpenAI 授权已保存，可获取模型并保存配置');
        else if(event.error)finish('error',event.error);
      }catch{finish('error','无法读取授权响应');child.kill();}}
    });
    child.stderr.on('data',()=>{});child.on('error',()=>finish('error','无法启动 Hermes 授权工具'));
    child.on('close',()=>finish('error','OpenAI 授权未完成，请重新发起'));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action:'oauth'}));return this.oauthStatus();
  }
  cancelOAuth(){const job=this.oauthJob;if(job?.state==='waiting'){clearTimeout(job.timeout);job.state='cancelled';job.message='授权已取消';job.userCode=null;job.verificationUrl=null;job.child.kill();}return this.oauthStatus();}
  async list({editableOnly=false}={}){const installed=installations();const [editable,readonly]=await Promise.all([Promise.all(['deepseek','hermes'].map(async app=>{
    if(!installed[app])return {app,name:app==='deepseek'?'DeepSeek Harness':'Hermes',installed:false,configured:false,error:'未找到本机助手安装'};
    try{return await helper(app,installed[app],{action:'status'});}catch(error){return {app,name:app==='deepseek'?'DeepSeek Harness':'Hermes',installed:true,configured:false,error:error.message};}
  })),editableOnly?Promise.resolve([]):this.readonlyAccounts.list()]);return {accounts:[...readonly,...editable]};}
  act(action,input){
    if(!['save','test','models'].includes(action))throw new Error('不支持的模型账户操作');
    const value=validateAccountInput(input,action),installed=installations();
    if(!installed[value.app])throw new Error('未找到本机助手安装');
    const operation=this.pending.then(()=>helper(value.app,installed[value.app],{...value,action}));
    this.pending=operation.catch(()=>{});return operation;
  }
}
