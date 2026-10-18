import {skillReadRequests} from './skill-analytics.mjs';
function localMoment(value,label,end=false){
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value||'');
  if(!match)throw new Error(`请选择${label}时间`);
  const [,ys,ms,ds,hs,mins]=match,[year,month,day,hour,minute]=[ys,ms,ds,hs??(end?'23':'0'),mins??(end?'59':'0')].map(Number);
  const date=new Date(year,month-1,day,hour,minute,end?59:0,end?999:0);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute)throw new Error(`${label}时间无效`);
  return date;
}
export function calendarRange(range='week',now=Date.now(),bounds={}){
  if(!['today','yesterday','week','month','year','custom'].includes(range))throw new Error('统计范围无效');
  if(range==='custom'){
    const start=localMoment(bounds.from,'开始'),end=localMoment(bounds.to,'结束',true);
    const until=Math.min(end.getTime(),now);if(start.getTime()>until)throw new Error('开始日期不能晚于结束日期或今天');
    return {since:start.getTime(),until,from:bounds.from,to:bounds.to};
  }
  const start=new Date(now);start.setHours(0,0,0,0);
  if(range==='yesterday'){start.setDate(start.getDate()-1);return {since:start.getTime(),until:start.getTime()+86400000-1};}
  if(range==='week')start.setDate(start.getDate()-(start.getDay()+6)%7);
  if(range==='month')start.setDate(1);
  if(range==='year'){start.setMonth(0,1);}
  return {since:start.getTime(),until:now};
}
export function classifyTool(name){
  if(/apply_patch|write_file|create_file|edit_file|replace.*file|delete_file/.test(name))return 'write';
  if(/search|read_|fetch|open_file|list_|get_|view_image/.test(name))return 'read';
  if(/exec|shell|terminal|run_command|(^|[.:_])js$/.test(name))return 'command';
  return 'other';
}
export function normalizeAnalyticsTier(value){if(typeof value!=='string'||!value.trim())return null;const v=value.toLowerCase();if(['fast','priority'].includes(v))return 'fast';if(['default','standard'].includes(v))return 'standard';return v.slice(0,80);}
export const ANALYTICS_DIMENSION_VERSION=3;
export function initialAnalyticsState(){return {id:null,created:null,turn:null,previous:null,fork:false,skipped:0,resets:0,legacyTokens:0,dimensionVersion:ANALYTICS_DIMENSION_VERSION,skillVersion:1,model:null,effort:null,tier:null,threadTier:null};}
export function parseAnalyticsRecord(record,state,position){
  const p=record.payload||{},time=Date.parse(record.timestamp);const events=[];
  if(record.type==='session_meta'){state.id=p.id||state.id;state.created=Date.parse(p.timestamp||record.timestamp)||state.created;state.fork=!!(p.forked_from_id||p.forkedFromId||p.forked_from);return events;}
  // Applied thread settings persist until the next explicit update; turn-only tiers do not.
  if(record.type==='event_msg'&&p.type==='thread_settings_applied'){const settings=p.thread_settings||p.threadSettings||{};if(!p.thread_id||!state.id||p.thread_id===state.id){if(Object.hasOwn(settings,'service_tier')||Object.hasOwn(settings,'serviceTier')){state.threadTier=normalizeAnalyticsTier(settings.service_tier??settings.serviceTier);state.tier=state.threadTier;}}return events;}
  if(record.type==='turn_context'){state.turn=p.turn_id||p.turnId||state.turn;const settings=p.collaboration_mode?.settings||{};state.model=typeof p.model==='string'?p.model:typeof settings.model==='string'?settings.model:null;state.effort=p.effort||p.reasoning_effort||settings.reasoning_effort||null;state.tier=normalizeAnalyticsTier(p.service_tier??p.serviceTier??settings.service_tier??state.threadTier);return events;}
  if(record.type==='event_msg'&&p.type==='task_started'){const turn=p.turn_id||p.turnId;if(turn&&turn!==state.turn){state.model=null;state.effort=null;state.tier=state.threadTier;}state.turn=turn||state.turn;}
  if(!state.id||!Number.isFinite(time))return events;
  const historicalFork=state.fork&&state.created&&time<state.created;
  if(!historicalFork&&(record.type==='event_msg'||record.type==='response_item'))events.push({key:`active:${state.id}:${Math.floor(time/60000)}`,kind:'activity',time:Math.floor(time/60000)*60000,session:state.id});
  if(record.type==='response_item'&&['function_call','custom_tool_call','tool_call'].includes(p.type)){
    if(!historicalFork){const name=String(p.name||'unknown').slice(0,200);events.push({key:`tool:${p.call_id||p.id||state.id+':'+position}`,kind:'tool',time,session:state.id,tool:name,category:classifyTool(name)});for(const skill of skillReadRequests(p))events.push({key:`skill:${p.call_id||p.id||state.id+':'+position}:${skill}`,kind:'skill',time,session:state.id,tool:skill,category:'entry-read'});}return events;
  }
  if(record.type==='event_msg'&&p.type==='token_count'&&p.info){
    const total=p.info.total_token_usage,last=p.info.last_token_usage;
    const fields=['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'];
    const values=x=>x&&fields.map(k=>Number.isFinite(x[k])&&x[k]>=0?x[k]:0);
    const current=values(total),previous=state.previous;let delta;
    if(current){if(previous&&current[0]+current[2]>=previous[0]+previous[2])delta=current.map((v,i)=>Math.max(0,v-previous[i]));else {if(previous)state.resets++;delta=values(last)||current;}state.previous=current;}
    else delta=values(last);
    if(historicalFork||!delta||!delta.some(v=>v>0))return events;
    if(!state.turn)state.legacyTokens++;
    events.push({key:`token:${state.turn||state.id}:${record.timestamp}:${(current||delta).join(':')}`,kind:'token',time,session:state.id,input:delta[0],cached:delta[1],output:delta[2],reasoning:delta[3],model:state.model,effort:typeof state.effort==='string'?state.effort:null,tier:state.tier});
  }
  return events;
}
