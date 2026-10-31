const apiBase=document.querySelector('meta[name="local-api-base"]')?.content||'/api/';
const gateway=document.querySelector('meta[name="console-gateway"]')?.content==='true';
const names={codex:'Codex',agy:'Antigravity',antigravity:'Antigravity',claude:'Claude Code',zcode:'ZCode',grok:'Grok',deepseek:'DeepSeek',hermes:'Hermes',opencode:'OpenCode'};
let quotaCatalog=[],sourcesLoading=false,sourcesError='';
const quotaSources=()=>quotaCatalog.filter(source=>source.supported);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const at=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未读取';
const tokenCount=value=>value>=1e8?`${Number((value/1e8).toFixed(1))}亿`:value>=1e4?`${Number((value/1e4).toFixed(1))}万`:String(Math.round(value));
let dialog,tab='quotas',epoch=0,catalog=null,catalogError='',catalogLoading=false;
const quotas=new Map(),errors=new Map(),reading=new Set(),timers=new Map(),controllers=new Set();
function active(ticket){return dialog?.open&&ticket===epoch&&!document.hidden;}
async function api(route,body){
  const controller=new AbortController();controllers.add(controller);
  const token=gateway?localStorage.getItem('cmc.token')||'':document.querySelector('meta[name="local-token"]')?.content;
  try{
    const response=await fetch(apiBase+route,{method:body?'POST':'GET',headers:{...(gateway?{Authorization:'Bearer '+token}:{'X-Local-Token':token}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
    const value=await response.json();if(!response.ok)throw Error(value.error?.message||value.error||'读取失败');return value;
  }finally{controllers.delete(controller);}
}
function schedule(key,action,ticket){clearTimeout(timers.get(key));timers.set(key,setTimeout(()=>{timers.delete(key);if(active(ticket))void action();},2000));}
function stop(){epoch++;for(const controller of controllers)controller.abort();for(const timer of timers.values())clearTimeout(timer);timers.clear();reading.clear();catalogLoading=false;sourcesLoading=false;}
const text=(node,value)=>{const next=String(value??'');if(node.textContent!==next)node.textContent=next;};
function element(markup){const template=document.createElement('template');template.innerHTML=markup;return template.content.firstElementChild;}
function keyedChildren(parent,values,key,create,update){
  const previous=new Map([...parent.children].map(node=>[node.dataset.key,node]));
  values.forEach((value,index)=>{
    const id=String(key(value,index)),node=previous.get(id)||create(value);
    node.dataset.key=id;previous.delete(id);update(node,value);
    if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]||null);
  });
  for(const node of previous.values())node.remove();
}
function renderWindows(host,windows){
  keyedChildren(host,windows,(window,index)=>window.name+':'+index,
    ()=>element('<div class="overview-window"><div><span></span><b><span></span><small>%</small></b></div><progress max="100"></progress><small data-reset></small><small data-estimate></small></div>'),
    (node,window)=>{
      text(node.querySelector('div>span'),window.name);text(node.querySelector('b>span'),window.remainingPercent.toFixed(0));
      const progress=node.querySelector('progress');if(progress.value!==window.remainingPercent)progress.value=window.remainingPercent;
      const label=`${window.name}剩余 ${window.remainingPercent.toFixed(1)}%`;if(progress.getAttribute('aria-label')!==label)progress.setAttribute('aria-label',label);
      text(node.querySelector('[data-reset]'),window.resetsAt?at(window.resetsAt)+' 重置':'重置时间未提供');
      const estimate=node.querySelector('[data-estimate]');estimate.hidden=!window.estimate;
      const amount=window.estimate;
      text(estimate,amount?.state==='estimated'?`本机折算 ${tokenCount(amount.tokens)} Token · ${amount.usd==null?'金额暂无价格':`${amount.partial?'部分金额 ':''}$${amount.usd.toFixed(2)}`}`:amount?'估算采样中':'');
      estimate.title=amount?'按本机用量及额度变化推算；本机记录无法确认账号归属':'';
    });
}
function fillQuotaDetails(node){
  if(!node.open)return;
  const row=quotas.get(node.dataset.quotaOwner)?.accounts.find(account=>String(account.id)===node.dataset.quotaAccount);
  if(row)renderWindows(node.querySelector('[data-quota-rest]'),row.windows.slice(4));
}
function renderAccount(node,row,source){
  text(node.querySelector('strong'),row.label);
  node.querySelector('[data-current]').hidden=!row.active;
  const plan=node.querySelector('[data-plan]');plan.hidden=!row.plan;text(plan,row.plan);
  const empty=node.querySelector('[data-no-windows]');empty.hidden=!!row.windows.length;text(empty,row.configured===false?'未登录':'暂无额度记录');
  renderWindows(node.querySelector('[data-quota-first]'),row.windows.slice(0,4));
  let estimateNote=node.querySelector('[data-estimate-note]');
  if(row.windows.some(window=>window.estimate)){if(!estimateNote){estimateNote=document.createElement('p');estimateNote.dataset.estimateNote='';estimateNote.className='overview-muted';node.querySelector('[data-quota-first]').after(estimateNote);}text(estimateNote,'本机用量折算，账号归属无法确认');}
  else estimateNote?.remove();
  const details=node.querySelector('details');details.dataset.quotaOwner=source;details.dataset.quotaAccount=String(row.id);details.hidden=row.windows.length<=4;
  text(details.querySelector('summary'),`其余 ${Math.max(0,row.windows.length-4)} 项额度`);fillQuotaDetails(details);
  text(node.querySelector('[data-collected]'),(row.updatedAt?at(row.updatedAt)+' 采集':'尚无采集记录')+(row.stale?' · 上次成功数据':''));
  node.querySelector('[data-disabled]').hidden=!row.disabled;
  const reason=node.querySelector('[data-account-error]');reason.hidden=!row.reason;text(reason,row.reason);
  let credit=node.querySelector('[data-account-credits]');
  if(row.credits){if(!credit){credit=document.createElement('p');credit.dataset.accountCredits='';credit.className='overview-muted';node.querySelector('[data-quota-first]').after(credit);}text(credit,'Credits 余额  '+(row.credits.unlimited?'不限额':typeof row.credits.balance==='number'?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(row.credits.balance):'—'));}
  else credit?.remove();
}
function renderQuota(source){
  const host=dialog?.querySelector(`[data-quota-source="${source}"]`);if(!host)return;
  const descriptor=quotaCatalog.find(row=>row.source===source),value=quotas.get(source),busy=reading.has(source)||value?.refreshing;
  text(host.querySelector('h3'),descriptor.label);
  const status=host.querySelector('[role="status"]');text(status,busy?'正在更新':'');status.classList.toggle('analytics-loading-text',!!busy);
  const refresh=host.querySelector('[data-quota-refresh]');refresh.dataset.quotaRefresh=source;refresh.disabled=!!busy||!descriptor.refreshable;refresh.setAttribute('aria-label',`刷新 ${descriptor.label} 当前账号额度`);
  const error=host.querySelector('[role="alert"]'),message=errors.get(source)||value?.error;error.hidden=!message;text(error,message);
  const accounts=value?.accounts||[],empty=host.querySelector('[data-no-accounts]');empty.hidden=!!accounts.length;text(empty,busy?'正在读取账号信息':'未发现已登录或保存的账号');
  keyedChildren(host.querySelector('.overview-account-grid'),accounts,row=>row.id,
    ()=>element('<article class="overview-account"><div class="overview-account-heading"><strong></strong><span class="overview-tag" data-current>当前</span><span class="overview-tag" data-plan></span></div><p class="overview-muted" data-no-windows></p><div class="overview-windows" data-quota-first></div><details class="overview-extra-quotas"><summary></summary><div class="overview-windows" data-quota-rest></div></details><div class="overview-account-foot"><small data-collected></small><small data-disabled>已停用</small></div><p class="overview-muted overview-error" data-account-error></p></article>'),
    (node,row)=>renderAccount(node,row,source));
  renderSourcesStatus();
}
function renderSourcesStatus(){
  const status=dialog?.querySelector('[data-quota-load-state]');if(!status)return;
  text(status,sourcesError||(sourcesLoading?'正在读取额度来源':''));status.hidden=!status.textContent;
  dialog.querySelector('[data-sources-retry]').hidden=!sourcesError;
  dialog.querySelector('[data-quota-refresh="all"]').disabled=sourcesLoading||!quotaSources().some(row=>row.refreshable)||quotaSources().some(row=>reading.has(row.source)||quotas.get(row.source)?.refreshing);
}
function renderSources(){
  keyedChildren(dialog.querySelector('[data-quota-list]'),quotaSources(),row=>row.source,
    row=>{const node=element('<section class="overview-source"><header><h3></h3><span class="overview-source-status" role="status"></span><button type="button" data-overview-accounts>账号</button><button type="button" data-quota-refresh>刷新</button></header><p class="overview-error" role="alert" hidden></p><p class="overview-muted" data-no-accounts></p><div class="overview-account-grid"></div></section>');node.dataset.quotaSource=row.source;return node;},()=>{});
  quotaSources().forEach(row=>renderQuota(row.source));
  const unsupported=quotaCatalog.filter(row=>!row.supported),node=dialog.querySelector('.overview-unsupported');node.hidden=!unsupported.length;
  text(node.querySelector('p'),unsupported.map(row=>row.label).join('、')+' 暂无可读取的官方额度；请求消耗可在用量统计中查看。');renderSourcesStatus();
}
async function readSources(ticket=epoch){
  if(!active(ticket)||sourcesLoading)return;
  sourcesLoading=true;sourcesError='';renderSourcesStatus();
  try{const result=await api('quota-overview?catalog=1');if(!active(ticket))return;quotaCatalog=result.sources;renderSources();quotaSources().forEach(row=>void readQuota(row.source,ticket));}
  catch(error){if(active(ticket)&&error.name!=='AbortError'){sourcesError=error.message;quotaSources().forEach(row=>void readQuota(row.source,ticket));}}
  finally{if(ticket===epoch){sourcesLoading=false;renderSourcesStatus();}}
}
async function readQuota(source,ticket=epoch){
  if(!active(ticket)||reading.has(source))return;
  reading.add(source);renderQuota(source);
  try{const result=await api('quota-overview?source='+source);if(!active(ticket))return;quotas.set(source,result.sources[0]);errors.delete(source);if(result.sources[0]?.refreshing)schedule(source,()=>readQuota(source,ticket),ticket);}
  catch(error){if(active(ticket)&&error.name!=='AbortError')errors.set(source,error.message);}
  finally{if(ticket===epoch){reading.delete(source);renderQuota(source);}}
}
async function refreshQuota(source){
  const ticket=epoch,ids=source==='all'?quotaSources().filter(row=>row.refreshable).map(row=>row.source):[source];
  if(ids.some(id=>reading.has(id)||quotas.get(id)?.refreshing))return;
  ids.forEach(id=>{reading.add(id);renderQuota(id);});
  try{await api('quota-overview/refresh',{source});if(!active(ticket))return;ids.forEach(id=>reading.delete(id));await Promise.all(ids.map(id=>readQuota(id,ticket)));}
  catch(error){if(active(ticket))ids.forEach(id=>errors.set(id,error.message));}
  finally{if(ticket===epoch)ids.forEach(id=>{reading.delete(id);renderQuota(id);});}
}
function renderCatalog(){
  const host=dialog?.querySelector('[data-overview-models]');if(!host)return;
  const opened=new Set([...host.querySelectorAll('details[open]')].map(node=>node.dataset.modelId));
  const query=dialog.querySelector('[data-overview-search]').value.trim().toLowerCase();
  const harness=dialog.querySelector('[data-overview-harness]').value;
  const models=(catalog?.models||[]).filter(model=>(harness==='all'||model.harness===harness)&&`${model.displayName} ${model.model} ${model.providerName||''}`.toLowerCase().includes(query));
  const groups=new Map();for(const model of models){const key=model.harness||'codex';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(model);}
  host.innerHTML=[...groups].map(([id,rows])=>`<section class="overview-model-group"><h3>${esc(names[id]||id)} <small>${rows.length}</small></h3>${rows.map(model=>{
    const context=model.contextWindow??model.context_window;
    const levels=(model.supportedReasoningEfforts||[]).map(level=>level.reasoningEffort);
    const modalities=model.inputModalities||model.input_modalities;
    return `<details class="overview-model" data-model-id="${esc(id+':'+model.model)}"><summary><strong>${esc(model.displayName||model.model)}</strong><span>${model.available===false?'暂不可用':context?Math.round(context/1000)+'K':'查看能力'}</span></summary><dl><div><dt>模型 ID</dt><dd>${esc(model.model)}</dd></div><div><dt>思考等级</dt><dd>${esc(levels.join(' / ')||'未提供')}</dd></div><div><dt>默认思考</dt><dd>${esc(model.defaultReasoningEffort||'未提供')}</dd></div><div><dt>上下文上限</dt><dd>${context?Math.round(context/1000)+'K':'未提供'}</dd></div><div><dt>输入类型</dt><dd>${esc(Array.isArray(modalities)?modalities.join(' / '):'未提供')}</dd></div>${model.providerName?`<div><dt>模型来源</dt><dd>${esc(model.providerName)}</dd></div>`:''}${model.unavailableReason?`<div><dt>状态</dt><dd>${esc(model.unavailableReason)}</dd></div>`:''}</dl></details>`;
  }).join('')}</section>`).join('')||`<p class="overview-muted">${catalogLoading?'正在读取原生模型目录':'没有匹配的模型'}</p>`;
  for(const node of host.querySelectorAll('details'))node.open=opened.has(node.dataset.modelId);
  dialog.querySelector('[data-overview-catalog-status]').textContent=catalogError||((catalog?.pending||[]).length?'部分目录正在更新':catalogLoading?'正在更新':`${models.length} 个模型`);
}
async function readCatalog(refresh=false,ticket=epoch){
  if(!active(ticket)||tab!=='models'||catalogLoading)return;
  catalogLoading=true;renderCatalog();
  try{const value=await api('harnesses/catalog'+(refresh?'?refresh=1':''));if(!active(ticket))return;catalog=value;catalogError='';if(value.pending?.length)schedule('catalog',()=>readCatalog(false,ticket),ticket);}
  catch(error){if(active(ticket)&&error.name!=='AbortError')catalogError=error.message;}
  finally{if(ticket===epoch){catalogLoading=false;renderCatalog();}}
}
function chooseTab(value){
  if(tab!==value)stop();tab=value;
  dialog.querySelector('[data-overview-quotas]').hidden=tab!=='quotas';dialog.querySelector('[data-overview-catalog]').hidden=tab!=='models';
  for(const button of dialog.querySelectorAll('[data-overview-tab]')){const selected=button.dataset.overviewTab===tab;button.setAttribute('aria-selected',String(selected));button.classList.toggle('selected',selected);}
  if(tab==='quotas'){renderSources();void readSources();}else{renderCatalog();void readCatalog();}
}
function open(value='quotas'){
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='management-overview-dialog';dialog.setAttribute('aria-labelledby','management-overview-title');
    dialog.innerHTML=`<div class="overview-heading"><h2 id="management-overview-title">模型与额度</h2><button type="button" data-overview-close aria-label="关闭">✕</button></div><div class="overview-tabs" role="tablist"><button role="tab" type="button" data-overview-tab="quotas">全部额度</button><button role="tab" type="button" data-overview-tab="models">模型能力</button></div><div class="overview-scroll"><div data-overview-quotas><div class="overview-toolbar"><span class="overview-muted">账号额度</span><button type="button" data-quota-refresh="all">刷新当前账号</button></div><p class="overview-muted" data-quota-load-state role="status" hidden></p><button type="button" data-sources-retry hidden>重试</button><div data-quota-list></div><details class="overview-unsupported" hidden><summary>其他 Harness</summary><p class="overview-muted"></p></details></div><div data-overview-catalog hidden><div class="overview-toolbar"><input type="search" data-overview-search placeholder="搜索模型或 ID" aria-label="搜索模型"><select data-overview-harness aria-label="选择 Harness"><option value="all">全部 Harness</option>${Object.entries(names).filter(([key])=>key!=='agy').map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><button type="button" data-catalog-refresh>刷新目录</button></div><p class="overview-muted" data-overview-catalog-status role="status"></p><div data-overview-models></div></div></div>`;
    dialog.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-overview-close'))dialog.close();if(button.hasAttribute('data-overview-accounts')){dialog.close();location.hash='accounts';}if(button.dataset.overviewTab)chooseTab(button.dataset.overviewTab);if(button.dataset.quotaRefresh)void refreshQuota(button.dataset.quotaRefresh);if(button.hasAttribute('data-catalog-refresh'))void readCatalog(true);if(button.hasAttribute('data-sources-retry'))void readSources();});
    dialog.querySelector('[data-overview-search]').addEventListener('input',renderCatalog);dialog.querySelector('[data-overview-harness]').addEventListener('change',renderCatalog);
    dialog.addEventListener('toggle',event=>{if(event.target.matches('[data-quota-owner]'))fillQuotaDetails(event.target);},true);
    dialog.addEventListener('close',stop);document.body.append(dialog);
  }
  if(!dialog.open)dialog.showModal();chooseTab(value);
}
function mount(){
  const nav=document.querySelector('.sidebar-nav');
  if(nav&&!nav.querySelector('[data-open-overview]')){
    const button=document.createElement('button');button.type='button';button.className='overview-nav-button';button.dataset.openOverview='';button.textContent='模型与额度';button.onclick=()=>open();
    const icon=nav.querySelector('a[href="#usage"] svg')||nav.querySelector('a[href="#models"] svg');if(icon)button.prepend(icon.cloneNode(true));
    const sibling=nav.querySelector('a[href="#accounts"]');if(sibling)sibling.after(button);else nav.append(button);
  }
  const heading=document.querySelector('.heading .actions');
  if(heading&&['#models','#accounts','#usage','#harnesses'].includes(location.hash)&&!heading.querySelector('[data-overview-entry]')){
    const button=document.createElement('button');button.type='button';button.dataset.overviewEntry='';const models=location.hash==='#models'||location.hash==='#harnesses';button.textContent=models?'模型能力':'全部额度';button.onclick=()=>open(models?'models':'quotas');heading.prepend(button);
  }
}
document.addEventListener('visibilitychange',()=>{if(!dialog?.open)return;if(document.hidden)stop();else chooseTab(tab);});
new MutationObserver(mount).observe(document.querySelector('#app'),{childList:true,subtree:true});mount();
