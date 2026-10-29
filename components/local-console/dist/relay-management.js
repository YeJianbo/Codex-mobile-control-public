import {api,esc} from './console-management-client.js';
let state=null,host,search='',filter='all',dialog=null,reading=null;
const isRoute=()=>location.hash.split('?')[0]==='#providers';
const button=(text,action)=>`<button type="button" ${action}>${text}</button>`;
function list(){
  if(!host?.isConnected||!state)return;
  const rows=state.providers.filter(row=>(filter==='all'||row.enabled===(filter==='enabled'))&&[row.name,row.baseUrl,...row.models].join(' ').toLowerCase().includes(search.toLowerCase()));
  host.querySelector('[data-relay-list]').innerHTML=rows.length?rows.map(row=>`<article class="relay-row"><div class="relay-identity"><strong>${esc(row.name)}</strong><span class="relay-state ${row.enabled?'is-on':''}">${row.enabled?'已启用':'未启用'}</span><small>${esc(row.baseUrl)}</small></div><div class="relay-model-summary"><b>${row.models.length} 个模型</b><span>${esc(row.models.slice(0,3).map(model=>row.modelSettings?.[model]?.displayName||model).join(' · '))}${row.models.length>3?' …':''}</span></div><div class="relay-row-actions">${button('编辑',`data-relay-edit="${esc(row.id)}"`)}${button(row.enabled?'停用':'启用',`data-relay-toggle="${esc(row.id)}"`)}${button('删除',`data-action="delete-provider" data-id="${esc(row.id)}"`)}</div></article>`).join(''):'<p class="cm-muted">没有匹配的中转服务</p>';
}
function refreshLegacy(){
  // Keep the original model catalog, route controls and other pages synchronized.
  const trigger=document.createElement('button');trigger.type='button';trigger.dataset.action='refresh';trigger.hidden=true;document.body.append(trigger);trigger.click();trigger.remove();
}
async function reload(){state=await api('state');list();refreshLegacy();}
async function mount(){
  if(!isRoute())return;
  const grid=document.querySelector('.provider-grid');if(!grid||grid.dataset.relayEnhanced)return;
  grid.dataset.relayEnhanced='true';grid.hidden=true;
  host=document.createElement('section');host.className='relay-management';
  host.innerHTML='<div class="cm-filters"><input type="search" aria-label="搜索中转" placeholder="搜索供应商、地址或模型"><select aria-label="中转状态"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">未启用</option></select></div><p data-relay-error role="alert" hidden></p><div data-relay-list></div>';
  const main=grid.parentElement,heading=main.querySelector('.heading');heading.after(host);
  // Route changes remain explicit, but no longer obscure the provider list.
  for(const panel of [...main.children].filter(node=>node.classList.contains('panel'))){
    const details=document.createElement('details');details.className='panel relay-routing';details.innerHTML='<summary>连接方式与路由</summary>';panel.before(details);details.append(panel);grid.after(details);
  }
  const input=host.querySelector('input');input.value=search;input.oninput=event=>{search=event.target.value;list();};
  const select=host.querySelector('select');select.value=filter;select.onchange=event=>{filter=event.target.value;list();};
  host.onclick=async event=>{
    const edit=event.target.closest('[data-relay-edit]');if(edit){open(state.providers.find(row=>row.id===edit.dataset.relayEdit));return;}
    const remove=event.target.closest('[data-action="delete-provider"]');
    if(remove){
      event.preventDefault();event.stopPropagation();
      if(remove.dataset.confirm!=='true'){remove.dataset.confirm='true';remove.textContent='确认删除';return;}
      remove.disabled=true;const error=host.querySelector('[data-relay-error]');error.hidden=true;
      try{await api('providers/delete',{id:remove.dataset.id});await reload();}catch(e){error.hidden=false;error.textContent=e.message;}finally{remove.disabled=false;}return;
    }
    const toggle=event.target.closest('[data-relay-toggle]');if(!toggle)return;const row=state.providers.find(row=>row.id===toggle.dataset.relayToggle);
    toggle.disabled=true;const error=host.querySelector('[data-relay-error]');error.hidden=true;
    try{await api('providers/save',{...row,enabled:!row.enabled});await reload();}catch(e){error.hidden=false;error.textContent=e.message;}finally{toggle.disabled=false;}
  };
  reading?.abort();reading=new AbortController();
  try{state=await api('state',undefined,reading.signal);if(host.isConnected)list();}catch(error){if(error.name!=='AbortError'&&host.isConnected){const node=host.querySelector('[data-relay-error]');node.hidden=false;node.textContent=error.message;}}
}
function open(saved){
  if(dialog?.open)return;
  const selected=new Set(saved?.models||[]),settings=structuredClone(saved?.modelSettings||{});let discovered=[],query='',controller=new AbortController(),saving=false;
  const node=document.createElement('dialog');dialog=node;node.className='cm-dialog relay-editor';
  node.innerHTML=`<form><header class="cm-heading"><div><h2>${saved?'编辑中转':'添加中转'}</h2><p class="cm-muted">连接信息、模型和显示名称</p></div>${button('✕','data-relay-close aria-label="关闭中转编辑"')}</header><div class="relay-editor-body"><div class="relay-connection"><label>名称<input name="name" required maxlength="100" placeholder="供应商名称" value="${esc(saved?.name||'')}"></label><label>API 地址<input name="baseUrl" type="url" required placeholder="https://example.com/v1" value="${esc(saved?.baseUrl||'')}"></label><label>API 密钥<div class="relay-secret"><input name="apiKey" type="password" autocomplete="new-password" placeholder="${saved?.hasKey?'留空保留已保存密钥':'粘贴 API 密钥'}">${button('显示','data-relay-secret')}</div></label><label class="relay-enabled"><input name="enabled" type="checkbox" ${saved?saved.enabled?'checked':'':'checked'}>启用此供应商</label></div><section class="relay-models"><header class="cm-heading"><h3>模型 <small data-relay-count></small></h3>${button('拉取模型','data-relay-discover')}</header><p class="cm-muted" data-relay-discovery-status role="status"></p><div class="cm-filters"><input type="search" data-relay-search aria-label="搜索可选模型" placeholder="搜索模型 ID 或显示名">${button('全选筛选结果','data-relay-select-visible')}</div><div class="relay-discovered" data-relay-discovered></div><details class="relay-manual"><summary>手动添加模型</summary><textarea data-relay-manual rows="3" placeholder="每行一个模型 ID，也可用逗号分隔"></textarea>${button('添加','data-relay-add-models')}</details><div data-relay-selected></div></section></div><footer><span class="cm-error" role="alert" data-relay-feedback></span>${button('取消','data-relay-close')}<button type="submit" data-relay-save>保存配置</button></footer></form>`;
  document.body.append(node);const form=node.querySelector('form'),feedback=node.querySelector('[data-relay-feedback]');
  const match=id=>[id,settings[id]?.displayName||''].join(' ').toLowerCase().includes(query.toLowerCase());
  function renderModels(){
    node.querySelector('[data-relay-count]').textContent=selected.size+' 已选';
    const visible=discovered.filter(match),results=node.querySelector('[data-relay-discovered]');
    results.innerHTML=visible.slice(0,100).map(id=>`<label><input type="checkbox" data-relay-model="${esc(id)}" ${selected.has(id)?'checked':''}><span>${esc(id)}</span></label>`).join('');
    if(visible.length>100)results.insertAdjacentHTML('beforeend','<p class="cm-muted">显示前 100 项，输入关键词缩小范围</p>');
    const parent=node.querySelector('[data-relay-selected]');
    // Existing controls remain mounted while discovery selection changes, so
    // unfinished edits and focus do not disappear.
    for(const row of [...parent.children])if(!selected.has(row.dataset.model))row.remove();
    for(const id of selected){if([...parent.children].some(row=>row.dataset.model===id))continue;
      const row=document.createElement('article');row.className='relay-selected-model';row.dataset.model=id;const setting=settings[id]||{};
      row.innerHTML=`<div><strong>${esc(id)}</strong>${button('移除','data-relay-remove')}</div><label>显示名称<input data-model-name value="${esc(setting.displayName||'')}" placeholder="${esc(id)}"></label><details><summary>模型参数</summary><label>上下文上限<input type="number" min="4096" max="2000000" step="1" data-model-context value="${esc(setting.contextWindow||saved?.contextWindow||272000)}"></label><label class="relay-enabled"><input type="checkbox" data-model-enabled ${setting.enabled!==false?'checked':''}>在模型列表中显示</label></details>`;
      parent.append(row);
    }
    for(const row of parent.children)row.hidden=!match(row.dataset.model);
  }
  function collect(){for(const row of node.querySelector('[data-relay-selected]').children){const id=row.dataset.model;settings[id]={...settings[id],displayName:row.querySelector('[data-model-name]').value.trim(),contextWindow:Number(row.querySelector('[data-model-context]').value),enabled:row.querySelector('[data-model-enabled]').checked};}}
  node.oninput=event=>{if(event.target.matches('[data-relay-search]')){query=event.target.value;renderModels();}else if(event.target.closest('.relay-selected-model'))collect();};
  node.onclick=async event=>{
    const target=event.target.closest('button,input');if(!target)return;
    if(target.hasAttribute('data-relay-close')){if(!saving)node.close();return;}
    if(target.hasAttribute('data-relay-secret')){const input=form.elements.apiKey;input.type=input.type==='password'?'text':'password';target.textContent=input.type==='password'?'显示':'隐藏';return;}
    if(target.dataset.relayModel!==undefined){collect();target.checked?selected.add(target.dataset.relayModel):selected.delete(target.dataset.relayModel);renderModels();return;}
    if(target.hasAttribute('data-relay-remove')){collect();selected.delete(target.closest('[data-model]').dataset.model);renderModels();return;}
    if(target.hasAttribute('data-relay-select-visible')){collect();discovered.filter(match).forEach(id=>selected.add(id));renderModels();return;}
    if(target.hasAttribute('data-relay-add-models')){collect();for(const id of node.querySelector('[data-relay-manual]').value.split(/[\n,，]/).map(id=>id.trim()).filter(Boolean))selected.add(id);node.querySelector('[data-relay-manual]').value='';renderModels();return;}
    if(target.hasAttribute('data-relay-discover')){
      target.disabled=true;const status=node.querySelector('[data-relay-discovery-status]');status.textContent='正在读取模型列表…';
      const address=form.elements.baseUrl.value,key=form.elements.apiKey.value;
      try{const value=await api('providers/discover',{id:saved?.id,baseUrl:address,apiKey:key},controller.signal);if(!node.open||address!==form.elements.baseUrl.value||key!==form.elements.apiKey.value)return;collect();discovered=value.models;renderModels();status.textContent=`发现 ${value.models.length} 个模型，勾选后加入配置${value.truncated?' · 列表已截取前 500 项':''}`;}catch(error){if(error.name!=='AbortError')status.textContent=error.message;}finally{target.disabled=false;}
    }
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(saving)return;collect();feedback.textContent='';
    if(!selected.size){feedback.textContent='请拉取或手动添加至少一个模型';return;}
    saving=true;node.querySelector('[data-relay-save]').disabled=true;
    try{await api('providers/save',{id:saved?.id,name:form.elements.name.value,baseUrl:form.elements.baseUrl.value,apiKey:form.elements.apiKey.value,enabled:form.elements.enabled.checked,contextWindow:saved?.contextWindow||272000,models:[...selected],modelSettings:Object.fromEntries([...selected].map(id=>[id,settings[id]||{}]))},controller.signal);node.close();await reload();}
    catch(error){if(error.name!=='AbortError')feedback.textContent=error.message;}
    finally{saving=false;if(node.isConnected)node.querySelector('[data-relay-save]').disabled=false;}
  };
  node.oncancel=event=>{if(saving)event.preventDefault();};
  node.addEventListener('close',()=>{controller.abort();form.reset();node.remove();if(dialog===node)dialog=null;},{once:true});renderModels();node.showModal();
}
document.addEventListener('click',event=>{
  if(!isRoute()||!event.target.closest)return;const target=event.target.closest('[data-action="add-provider"],[data-action="edit-provider"]');if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();void (async()=>{try{state??=await api('state');open(target.dataset.action==='edit-provider'?state.providers.find(row=>row.id===target.dataset.id):null);}catch(error){console.error(error.message);}})();
},true);
new MutationObserver(()=>{if(isRoute()&&!document.querySelector('.provider-grid[data-relay-enhanced]'))void mount();}).observe(document.querySelector('#app'),{childList:true,subtree:true});
addEventListener('hashchange',()=>{if(!isRoute())reading?.abort();else queueMicrotask(mount);});void mount();
