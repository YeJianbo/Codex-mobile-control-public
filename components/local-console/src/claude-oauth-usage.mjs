// Adapted from CodexBar's ClaudeOAuthUsageFetcher.swift (MIT).
// Copyright (c) 2026 Peter Steinberger. See third-party/CodexBar-LICENSE.
// Source revision and adaptation details: third-party/claude-usage-source.md.

const windows=[['five_hour','5 小时'],['seven_day','每周'],['seven_day_oauth_apps','每周 · OAuth 应用'],['seven_day_opus','每周 · Opus'],['seven_day_sonnet','每周 · Sonnet']];
const iso=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const percentage=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
const label=value=>typeof value==='string'?value.replace(/[\r\n\0]/g,' ').slice(0,100):'';

export function parseClaudeUsage(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Claude 返回的额度数据格式不正确');
  const result=windows.flatMap(([key,name])=>percentage(value[key]?.utilization)?[{key,name,usedPercent:value[key].utilization,remainingPercent:100-value[key].utilization,resetsAt:iso(value[key].resets_at)}]:[]);
  const routineKey=['seven_day_routines','seven_day_claude_routines','claude_routines','routines','routine','seven_day_cowork','cowork'].find(key=>percentage(value[key]?.utilization));
  if(routineKey)result.push({key:'routines',name:'Routines',usedPercent:value[routineKey].utilization,remainingPercent:100-value[routineKey].utilization,resetsAt:iso(value[routineKey].resets_at)});
  for(const [index,entry] of (Array.isArray(value.limits)?value.limits:[]).entries()){
    if(entry?.is_active===false||!percentage(entry?.percent))continue;
    const model=label(entry.scope?.model?.display_name)||label(entry.scope?.model?.id);
    const kind=label(entry.kind),group=label(entry.group);
    // CodexBar also retains the new scoped limits alongside the classic windows.
    result.push({key:'limit_'+index,name:[model,group==='weekly'?'每周':group||kind||'额度'].filter(Boolean).join(' · '),usedPercent:entry.percent,remainingPercent:100-entry.percent,resetsAt:iso(entry.resets_at)});
  }
  if(!result.length)throw new Error('Claude 未返回可识别的额度窗口');
  return result;
}

export async function fetchClaudeUsage(accessToken,{fetchImpl=fetch,version='2.1.0'}={}){
  if(typeof accessToken!=='string'||!accessToken.trim()||/[\r\n\0]/.test(accessToken))throw new Error('Claude OAuth 凭据无效');
  const safeVersion=/^[\w.+-]{1,40}$/.test(version)?version:'2.1.0';
  const headers={Authorization:'Bearer '+accessToken,Accept:'application/json','Content-Type':'application/json','anthropic-beta':'oauth-2025-04-20','User-Agent':`claude-cli/${safeVersion} (external, cli)`};
  const request=async(optional=true)=>fetchImpl('https://api.anthropic.com/api/oauth/usage'+(optional?'?cedar_ember=1':''),{method:'GET',headers:optional?headers:{...headers,'User-Agent':`claude-code/${safeVersion}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
  let response;
  try{response=await request();if(response.status===400||response.status===403){const body=(await response.text()).slice(0,32768);if(response.status===400||!body.includes('user:profile'))response=await request(false);}}
  catch{throw new Error('无法连接 Claude 官方额度接口，请检查网络后刷新');}
  if(response.status===401)throw new Error('Claude OAuth 登录已失效，请先在 Claude Code 重新登录后导入');
  if(response.status===403)throw new Error('Claude OAuth 无额度读取权限，需要包含 user:profile 的订阅登录');
  if(response.status===429){const error=new Error('Claude 官方额度接口限流，请稍后刷新');const raw=response.headers.get('retry-after'),seconds=Number(raw);error.retryAt=raw?(Number.isFinite(seconds)&&seconds>=0?Date.now()+seconds*1000:Date.parse(raw)):Date.now()+60000;if(!Number.isFinite(error.retryAt))error.retryAt=Date.now()+60000;throw error;}
  if(!response.ok)throw new Error('Claude 官方额度接口返回 HTTP '+response.status);
  try{return parseClaudeUsage(await response.json());}catch(error){if(error.message==='Claude 未返回可识别的额度窗口')throw error;throw new Error('Claude 返回的额度数据暂不可读取');}
}
