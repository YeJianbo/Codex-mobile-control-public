const apiBase=document.querySelector('meta[name="local-api-base"]')?.content||'/api/';
const gateway=document.querySelector('meta[name="console-gateway"]')?.content==='true';
const defaults=['04:00','09:00','14:00','19:00'];
let data=null,busy=false,error='',refreshing=false,refreshAt=0,revision=0,planDirty=false;
const labels={disabled:'已关闭',waiting:'等待额度重置','waiting-idle':'已重置，等待任务结束',sending:'正在预热',complete:'本轮已预热',covered:'本轮已有正常请求',uncertain:'上次预热结果未确认','waiting-time':'等待下一次暖机时间','waiting-reset':'等待当前 5h 窗口重置','no-account':'请先登录 Codex',unavailable:'暂无所选窗口数据',error:'读取失败'};
async function request(body){
  const token=gateway?localStorage.getItem('cmc.token')||'':document.querySelector('meta[name="local-token"]')?.content;
  const response=await fetch(apiBase+'usage/warmup',{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{...(gateway?{Authorization:'Bearer '+token}:{'X-Local-Token':token}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'预热设置读取失败');return value;
}
const plan=()=>data?.fiveHourSchedule||{enabled:false,times:defaults,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
const format=at=>at?new Date(at).toLocaleString():'';
const readTimes=panel=>[...panel.querySelectorAll('[data-warmup-times] input')].map(input=>input.value);
function timeRows(panel,times){
  panel.querySelector('[data-warmup-times]').dataset.times=JSON.stringify(times);
  panel.querySelector('[data-warmup-times]').replaceChildren(...times.map((time,index)=>{
    const row=document.createElement('label');row.textContent='暖机 '+(index+1);
    const input=document.createElement('input');input.type='time';input.required=true;input.value=time;input.disabled=busy||!data;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','删除暖机时间');remove.disabled=times.length===1||busy||!data;
    remove.addEventListener('click',()=>{if(busy||!data)return;planDirty=true;timeRows(panel,readTimes(panel).filter((_,i)=>i!==index));render();});
    row.append(input,remove);return row;
  }));
}
function render(){
  const panel=document.querySelector('[data-quota-warmup]');if(!panel)return;
  const enabled=data?.enabled===true,selected=data?.windows||['weekly'],settings=plan();
  const toggle=panel.querySelector('[data-warmup-toggle]');toggle.setAttribute('aria-checked',String(enabled));toggle.disabled=busy||!data;
  for(const button of panel.querySelectorAll('[data-warmup-window]')){button.setAttribute('aria-pressed',String(selected.includes(button.dataset.warmupWindow)));button.disabled=busy||!data;}
  const model=panel.querySelector('[data-warmup-model]'),choices=[{id:'',name:'默认 · 6.1 Sol'},...(data?.models||[])];
  if(data?.model&&!choices.some(item=>item.id===data.model))choices.push({id:data.model,name:data.model+'（已不可用）'});
  const key=JSON.stringify(choices);
  if(model.dataset.choices!==key){model.replaceChildren(...choices.map(item=>new Option(item.name.replace(/^gpt[- ]/i,''),item.id)));model.dataset.choices=key;}
  model.value=data?.model||'';model.disabled=busy||!data;
  panel.querySelector('[data-warmup-plan]').hidden=!selected.includes('fiveHour');
  const planToggle=panel.querySelector('[data-warmup-plan-toggle]');planToggle.disabled=busy||!data;planToggle.setAttribute('aria-checked',String(settings.enabled));
  panel.querySelector('[data-warmup-plan-form]').hidden=!settings.enabled;
  if(!planDirty&&panel.querySelector('[data-warmup-times]').dataset.times!==JSON.stringify(settings.times))timeRows(panel,settings.times);
  for(const control of panel.querySelectorAll('[data-warmup-plan-form] input,[data-warmup-add],[data-warmup-defaults]'))control.disabled=busy||!data;
  const count=readTimes(panel).length;
  for(const remove of panel.querySelectorAll('[data-warmup-times] button'))remove.disabled=busy||!data||count===1;
  panel.querySelector('[data-warmup-zone]').textContent=settings.timeZone;
  panel.querySelector('[data-warmup-plan-save]').disabled=busy||!data||!planDirty;
  panel.querySelector('[data-warmup-next]').textContent=[data?.resets?.fiveHour?'当前 5h 重置：'+format(data.resets.fiveHour*1000):'',data?.nextFiveHourAt?'下个计划：'+format(data.nextFiveHourAt):''].filter(Boolean).join(' · ');
  panel.querySelector('[data-warmup-status]').textContent=error||data?.lastError||(data?labels[data.status]||'等待额度重置':'');
  panel.querySelector('[data-warmup-time]').textContent=data?.lastAttempt?.at?'最近：'+format(data.lastAttempt.at):'';
}
async function save(next){
  revision++;busy=true;error='';render();
  try{data=await request({enabled:data.enabled,windows:data.windows,...next});if(next.fiveHourSchedule)planDirty=false;}catch(reason){error=reason.message;}finally{busy=false;render();}
}
async function refresh(){
  if(document.hidden||!document.querySelector('[data-quota-warmup]')||refreshing||busy||Date.now()-refreshAt<10000)return;
  refreshing=true;refreshAt=Date.now();const readRevision=revision;
  try{const value=await request();if(readRevision===revision&&!busy){data=value;error='';}}catch(reason){if(readRevision===revision&&!busy)error=reason.message;}finally{refreshing=false;render();}
}
function mount(){
  const parent=document.querySelector('[data-usage-page]');if(!parent||parent.querySelector('[data-quota-warmup]'))return;
  const panel=document.createElement('section');panel.className='panel quota-warmup-panel';panel.dataset.quotaWarmup='';
  panel.innerHTML='<div class="quota-warmup-heading"><div><h3>自动预热</h3><p>当前登录账号 · 空闲时发送一次最小请求</p></div><button type="button" class="access-switch" role="switch" aria-label="自动预热" aria-checked="false" data-warmup-toggle><span></span></button></div><div class="quota-warmup-windows" role="group" aria-label="预热窗口"><button type="button" data-warmup-window="fiveHour" aria-pressed="false">5 小时</button><button type="button" data-warmup-window="weekly" aria-pressed="true">7 天</button></div><label class="quota-warmup-model">暖机模型 <select data-warmup-model></select></label><div data-warmup-plan><div class="quota-warmup-heading"><div><h3>5 小时定时暖机</h3><p>每天按指定时刻启动周期</p></div><button type="button" class="access-switch" role="switch" aria-label="5 小时定时暖机" aria-checked="false" data-warmup-plan-toggle><span></span></button></div><form data-warmup-plan-form><div data-warmup-times></div><div class="quota-warmup-actions"><button type="button" data-warmup-add>添加时间</button><button type="button" data-warmup-defaults>使用 04 / 09 / 14 / 19</button><button type="submit" data-warmup-plan-save>保存时间</button></div><p>例如 04:00、09:00、14:00、19:00，可覆盖到午夜。<br>当前窗口未重置时等待实际重置；运行中先等待任务结束。</p><small data-warmup-zone></small></form><p data-warmup-next></p></div><div class="quota-warmup-status"><span data-warmup-status></span><small data-warmup-time></small></div>';
  planDirty=false;
  panel.querySelector('[data-warmup-model]').addEventListener('change',event=>{if(data&&!busy)void save({model:event.target.value});});
  const form=panel.querySelector('form');
  form.addEventListener('input',()=>{planDirty=true;render();});
  form.addEventListener('submit',event=>{
    event.preventDefault();if(busy||!data)return;const times=readTimes(panel);
    if(!times.length||times.length>24||new Set(times).size!==times.length||times.some(time=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))){error='请输入不重复的有效时间';render();return;}
    void save({fiveHourSchedule:{...plan(),times}});
  });
  panel.addEventListener('click',event=>{
    if(busy||!data)return;
    if(event.target.closest('[data-warmup-plan-toggle]'))void save({fiveHourSchedule:{...plan(),enabled:!plan().enabled}});
    if(event.target.closest('[data-warmup-toggle]'))void save({enabled:!data.enabled});
    if(event.target.closest('[data-warmup-defaults]')){planDirty=true;timeRows(panel,defaults);render();}
    if(event.target.closest('[data-warmup-add]')){
      const times=readTimes(panel),last=times.at(-1),minute=/^\d{2}:\d{2}$/.test(last)?(Number(last.slice(0,2))*60+Number(last.slice(3))+300)%1440:0;
      const next=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
      const available=!times.includes(next)?next:Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+':00').find(time=>!times.includes(time));
      if(times.length<24&&available){planDirty=true;timeRows(panel,[...times,available]);render();}
    }
    const button=event.target.closest('[data-warmup-window]');if(!button)return;const name=button.dataset.warmupWindow,selected=new Set(data.windows);
    if(selected.has(name)){if(selected.size===1)return;selected.delete(name);}else selected.add(name);
    void save({windows:[...selected]});
  });
  const heading=parent.querySelector('.heading');if(heading)heading.after(panel);else parent.prepend(panel);
  render();refreshAt=0;void refresh();
}
new MutationObserver(mount).observe(document.querySelector('#app'),{childList:true,subtree:true});
document.addEventListener('visibilitychange',()=>void refresh());
setInterval(()=>void refresh(),15000);mount();
