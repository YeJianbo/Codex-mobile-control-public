// Selects remain the form/state source; all visible pickers are shared across clients.
function observeSelect(select, sync) {
  new MutationObserver(sync).observe(select, {childList:true, subtree:true, attributes:true});
  select.addEventListener('change', sync);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {get() {return descriptor.get.call(this)}, set(value) {descriptor.set.call(this,value);sync()}});
}
document.querySelectorAll('select:not(#chatModel):not(#chatEffort)').forEach((select, index) => {
  let activeDialog;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `custom-select ${select.className}`;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  select.after(trigger);
  select.hidden = true;
  const sync = () => {
    const selected=select.selectedOptions[0];
    trigger.textContent = selected?.dataset.compactLabel || selected?.textContent || '请选择';
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-label', `${select.getAttribute('aria-label') || ''} ${selected?.textContent || trigger.textContent}`);
    trigger.title=trigger.getAttribute('aria-label');
    if(select.disabled && activeDialog?.open)activeDialog.close();
  };
  observeSelect(select, sync);
  trigger.onclick = () => {
    if(select.disabled || activeDialog?.open)return;
    const dialog = document.createElement('dialog');
    activeDialog=dialog;
    dialog.className = 'choice-dialog';
    const header=document.createElement('div');header.className='choice-header';
    const title = document.createElement('h3');
    title.textContent = select.getAttribute('aria-label') || select.parentElement.firstChild?.textContent?.trim() || '请选择';
    title.id=`choice-title-${index}`;dialog.setAttribute('aria-labelledby',title.id);
    const close = document.createElement('button');
    close.type='button';close.setAttribute('aria-label','关闭');close.title='关闭';
    close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    close.className='icon-button';close.onclick=()=>dialog.close();header.append(title,close);dialog.append(header);
    const list=document.createElement('div');list.className='choice-options';
    const options=[...select.options].filter(option=>!option.hidden);
    const searchable=options.length>6;
    const search=document.createElement('input');search.type='search';search.className='choice-search';
    search.placeholder='输入名称搜索';search.setAttribute('aria-label',`搜索${title.textContent}`);
    search.autocomplete='off';search.spellcheck=false;
    if(searchable)dialog.append(search);
    const empty=document.createElement('p');empty.className='choice-empty';empty.textContent='没有匹配项';empty.hidden=true;
    for(const option of options) {
      const item = document.createElement('button');
      item.type='button';item.className = 'choice-option';
      const label=document.createElement('span');label.className='choice-label';label.textContent=option.textContent;
      const check=document.createElement('span');check.className='choice-check';check.setAttribute('aria-hidden','true');
      check.innerHTML=option.selected?'<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>':'';
      item.append(label,check);item.dataset.search=`${option.textContent} ${option.value}`.toLowerCase();
      item.disabled=option.disabled; item.setAttribute('aria-pressed',String(option.selected));
      item.onclick=()=>{
        if(select.disabled || ![...select.options].some(o=>o.value===option.value&&!o.disabled))return;
        select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();
      };
      list.append(item);
    }
    list.append(empty);dialog.append(list);
    search.oninput=()=>{
      const query=search.value.trim().toLowerCase();let count=0;
      list.querySelectorAll('.choice-option').forEach(item=>{item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++});
      empty.hidden=count>0;list.scrollTop=0;
    };
    dialog.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.isComposing)return;
      if(event.target===search && ['Home','End'].includes(event.key))return;
      const items=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);
      if(!items.length)return;event.preventDefault();
      const current=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:current<0?items.length-1:(current-1+items.length)%items.length;
      items[next].focus({preventScroll:true});items[next].scrollIntoView({block:'nearest'});
    });
    const position=()=>{
      const height=window.visualViewport?.height || innerHeight;
      const mobile=matchMedia('(max-width:760px)').matches;
      dialog.classList.toggle('choice-anchored',!mobile);
      if(mobile){dialog.style.left='';dialog.style.top='';dialog.style.maxHeight=`${Math.max(180,height-32)}px`;return;}
      const anchor=trigger.getBoundingClientRect(),above=anchor.top-12,below=innerHeight-anchor.bottom-12;
      const openBelow=below>=300 || below>=above;
      dialog.style.maxHeight=`${Math.max(120,Math.min(500,openBelow?below:above))}px`;
      const bounds={width:dialog.offsetWidth,height:dialog.offsetHeight};
      dialog.style.left=`${Math.max(12,Math.min(innerWidth-bounds.width-12,anchor.left))}px`;
      dialog.style.top=`${Math.max(12,openBelow?anchor.bottom+6:anchor.top-bounds.height-6)}px`;
    };
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
    dialog.addEventListener('close',()=>{
      window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);
      activeDialog=null;trigger.setAttribute('aria-expanded','false');dialog.remove();if(trigger.isConnected)trigger.focus({preventScroll:true});
    },{once:true});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
    document.body.append(dialog);dialog.showModal();trigger.setAttribute('aria-expanded','true');position();
    const selected=list.querySelector('[aria-pressed=true]:not(:disabled)');
    if(selected){selected.focus({preventScroll:true});list.scrollTop=selected.offsetTop-list.offsetTop-(list.clientHeight-selected.clientHeight)/2;}
    else dialog.focus({preventScroll:true});
  };
  sync();
});

mountModelSettings();
function mountModelSettings() {
  const model = document.getElementById('chatModel');
  const effort = document.getElementById('chatEffort');
  const trigger = document.getElementById('modelSettingsBtn');
  const order = ['none','minimal','low','medium','high','xhigh','max','ultra'];
  const compact = option => (option?.dataset.compactLabel || option?.textContent || '').replace(/^(Claude Code|Antigravity|Grok Build) · /,'');
  const modelOptions = () => [...model.options].filter(option => !option.hidden && option.value);
  const levels = () => [...effort.options].filter(option => !option.hidden && !option.disabled)
    .sort((a,b) => (order.indexOf(a.value) < 0 ? 99 : order.indexOf(a.value)) - (order.indexOf(b.value) < 0 ? 99 : order.indexOf(b.value)));
  let popup;
  function sync() {
    const name = compact(model.selectedOptions[0]) || '选择模型';
    const intensity = levels().filter(option=>option.value).length>1 ? compact(effort.selectedOptions[0]) : '';
    trigger.querySelector('.model-setting-name').textContent = name;
    trigger.querySelector('.model-setting-effort').textContent = intensity;
    trigger.querySelector('.model-setting-effort').hidden = !intensity;
    trigger.disabled = model.disabled || !modelOptions().length;
    trigger.setAttribute('aria-label', `模型与思考强度：${name}${intensity ? ' · '+intensity : ''}`);
    trigger.title = trigger.getAttribute('aria-label');
    if (trigger.disabled) popup?.dialog.close();
    else popup?.sync();
  }
  observeSelect(model, sync);
  observeSelect(effort, sync);
  sync();
  trigger.onclick = () => {
    if (trigger.disabled || popup) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'choice-dialog model-settings-dialog';
    dialog.setAttribute('aria-labelledby', 'model-settings-title');
    dialog.innerHTML = `
      <h2 id="model-settings-title" class="sr-only">模型与思考强度</h2>
      <div class="model-panel-heading">
        <button type="button" class="icon-button model-list-back" aria-label="返回思考强度" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6"/></svg></button>
        <button type="button" id="chooseChatModel" class="model-current"><span class="model-current-name"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
        <span class="model-list-title" hidden>选择模型</span>
        <button type="button" class="icon-button model-settings-close" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
      </div>
      <div class="reasoning-panel">
        <div class="reasoning-heading"><span>思考强度</span><strong class="reasoning-value"></strong></div>
        <div id="reasoningSlider" class="reasoning-slider" role="slider" tabindex="0" aria-label="思考强度" aria-valuemin="0">
          <div class="reasoning-track"><div class="reasoning-fill"></div><div class="reasoning-ticks" aria-hidden="true"></div><span class="reasoning-thumb" aria-hidden="true"></span></div>
        </div>
        <div class="reasoning-scale" aria-hidden="true"><span></span><span></span></div>
        <div class="permission-options" role="group" aria-label="执行权限"></div>
      </div>
      <input type="search" class="choice-search model-search" aria-label="搜索模型" placeholder="搜索模型" autocomplete="off" spellcheck="false" hidden>
      <div class="choice-options model-options" hidden></div>`;
    const find = selector => dialog.querySelector(selector);
    const modelButton = find('#chooseChatModel');
    const back = find('.model-list-back');
    const search = find('.model-search');
    const list = find('.model-options');
    const slider = find('#reasoningSlider');

    const permissionOptions=find('.permission-options');
    let permission='full';try{permission=localStorage.getItem('cmc.permission')||'full';}catch{}
    for(const [value,label] of [['ask','询问'],['auto','自动审批'],['full','完全访问'],...(localStorage.getItem('cmc.harness')==='codex'||!localStorage.getItem('cmc.harness')?[['custom','自定义 (config.toml)']]:[])]){
      const choice=document.createElement('button');choice.type='button';choice.textContent=label;choice.dataset.permission=value;choice.setAttribute('aria-pressed',String(permission===value));
      choice.onclick=()=>{try{localStorage.setItem('cmc.permission',value);localStorage.setItem('cmc.permission.'+(localStorage.getItem('cmc.harness')||'codex'),value);}catch{};permissionOptions.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===choice)));};
      permissionOptions.append(choice);
    }
    let choosingModel = false, modelSignature = '', levelSignature = '', dragging = false;
    const selectValue = (select,value) => {
      select.value = value;
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    const setLevel = index => {
      const choices = levels();
      if (effort.disabled || !choices.length) return;
      const choice = choices[Math.max(0,Math.min(choices.length-1,index))];
      if (choice.value !== effort.value) selectValue(effort,choice.value);
    };
    const position = () => {
      const height = window.visualViewport?.height || innerHeight;
      const mobile = matchMedia('(max-width:760px)').matches;
      dialog.classList.toggle('choice-anchored', !mobile);
      if (mobile) { dialog.style.left='';dialog.style.top='';dialog.style.maxHeight=`${Math.max(180,height-32)}px`;return; }
      const anchor = trigger.getBoundingClientRect();
      const above=anchor.top-12,below=innerHeight-anchor.bottom-12;
      const openBelow=below>=300 || below>=above;
      dialog.style.maxHeight=`${Math.max(140,Math.min(500,openBelow?below:above))}px`;
      const bounds={width:dialog.offsetWidth,height:dialog.offsetHeight};
      dialog.style.left=`${Math.max(12,Math.min(innerWidth-bounds.width-12,anchor.right-bounds.width))}px`;
      dialog.style.top=`${Math.max(12,openBelow?anchor.bottom+6:anchor.top-bounds.height-6)}px`;
    };
    const filterModels = () => {
      const query=search.value.trim().toLowerCase();let count=0;
      list.querySelectorAll('.choice-option').forEach(item=>{item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++;});
      list.querySelectorAll('.agent-section-heading').forEach(item=>item.hidden=true);
      list.querySelector('.choice-empty').hidden=count>0;
    };
    const syncPopup = () => {
      const name=compact(model.selectedOptions[0]);
      modelButton.querySelector('.model-current-name').textContent=name;
      modelButton.setAttribute('aria-label', `选择模型：${name}`);
      const choices=levels(),index=Math.max(0,choices.findIndex(option=>option.value===effort.value));
      find('.reasoning-panel').hidden=choosingModel || choices.filter(option=>option.value).length<2;
      const percent=choices.length>1 ? index/(choices.length-1)*100 : 0;
      const disabled=effort.disabled || choices.length<2;
      slider.setAttribute('aria-valuemax',String(Math.max(0,choices.length-1)));
      slider.setAttribute('aria-valuenow',String(index));
      slider.setAttribute('aria-valuetext',compact(choices[index]));
      slider.setAttribute('aria-disabled',String(disabled));
      slider.tabIndex=disabled ? -1 : 0;
      find('.reasoning-value').textContent=compact(choices[index]);
      find('.reasoning-thumb').style.left=percent+'%';
      find('.reasoning-fill').style.width=percent+'%';
      const scale=find('.reasoning-scale');
      scale.firstElementChild.textContent=compact(choices[0]);
      scale.lastElementChild.textContent=choices.length>1 ? compact(choices.at(-1)) : '';
      const signature=choices.map(option=>option.value).join('|');
      if(signature!==levelSignature) {
        levelSignature=signature;
        find('.reasoning-ticks').replaceChildren(...choices.map((option,i)=>{
          const tick=document.createElement('span');tick.style.left=(choices.length>1?i/(choices.length-1)*100:0)+'%';return tick;
        }));
      }
      const options=modelOptions();
      const nextSignature=options.map(option=>`${option.value}:${option.textContent}:${option.disabled}`).join('|');
      if(nextSignature!==modelSignature) {
        modelSignature=nextSignature;
        let lastAgent='';
        list.replaceChildren(...options.flatMap(option=>{
          const agent=option.dataset.agent||'codex';
          const heading=document.createElement('p');heading.className='agent-section-heading';
          heading.textContent=({codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build'})[agent]||agent;
          const section=agent!==lastAgent?[heading]:[];lastAgent=agent;
          const item=document.createElement('button');item.type='button';item.className='choice-option';
          item.dataset.value=option.value;item.dataset.search=`${option.textContent} ${option.value}`.toLowerCase();item.disabled=option.disabled;
          item.dataset.agent=agent;
          const label=document.createElement('span');label.className='choice-label';label.textContent=option.textContent.replace(/^(Claude Code|Antigravity|Grok Build) · /,'');
          if(option.disabled)item.title='请在新会话中切换助手';
          const check=document.createElement('span');check.className='choice-check';check.setAttribute('aria-hidden','true');
          check.innerHTML='<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
          item.append(label,check);
          item.onclick=()=>{
            if(model.disabled || !modelOptions().some(choice=>choice.value===option.value&&!choice.disabled))return;
            selectValue(model,option.value);showModelList(false);
          };
          return [...section,item];
        }));
        const empty=document.createElement('p');empty.className='choice-empty';empty.textContent='没有匹配的模型';list.append(empty);
        filterModels();
      }
      list.querySelectorAll('.choice-option').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.value===model.value)));
    };
    function showModelList(show) {
      choosingModel=show;
      back.hidden=!show;find('.model-list-title').hidden=!show;modelButton.hidden=show;
      find('.reasoning-panel').hidden=show || levels().filter(option=>option.value).length<2;search.hidden=!show;list.hidden=!show;
      syncPopup();position();
      if(show) {
        search.value='';filterModels();
        const selected=list.querySelector('[aria-pressed=true]:not(:disabled)');
        selected?.focus({preventScroll:true});selected?.scrollIntoView({block:'nearest'});
      } else (slider.tabIndex===0?slider:modelButton).focus({preventScroll:true});
    }
    const fromPointer = event => {
      const rect=find('.reasoning-track').getBoundingClientRect();
      setLevel(Math.round((event.clientX-rect.left)/rect.width*(levels().length-1)));
    };
    slider.onpointerdown=event=>{
      if(slider.getAttribute('aria-disabled')==='true')return;
      event.preventDefault();dragging=true;slider.classList.add('is-dragging');slider.focus({preventScroll:true});slider.setPointerCapture(event.pointerId);fromPointer(event);
    };
    slider.onpointermove=event=>{if(dragging)fromPointer(event);};
    slider.onpointerup=slider.onpointercancel=slider.onlostpointercapture=()=>{dragging=false;slider.classList.remove('is-dragging');};
    slider.onkeydown=event=>{
      if(event.key==='Enter'){event.preventDefault();dialog.close();return;}
      const index=levels().findIndex(option=>option.value===effort.value);
      const next={ArrowRight:index+1,ArrowUp:index+1,ArrowLeft:index-1,ArrowDown:index-1,Home:0,End:levels().length-1}[event.key];
      if(next!==undefined){event.preventDefault();setLevel(next);}
    };
    dialog.addEventListener('keydown',event=>{
      if(!choosingModel || !['ArrowDown','ArrowUp','Home','End'].includes(event.key) || event.isComposing)return;
      if(event.target===search&&['Home','End'].includes(event.key))return;
      const items=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);
      if(!items.length)return;event.preventDefault();
      const current=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:current<0?items.length-1:(current-1+items.length)%items.length;
      items[next].focus({preventScroll:true});items[next].scrollIntoView({block:'nearest'});
    });
    modelButton.onclick=()=>showModelList(true);
    back.onclick=()=>showModelList(false);
    find('.model-settings-close').onclick=()=>dialog.close();
    search.oninput=()=>{filterModels();list.scrollTop=0;};
    dialog.addEventListener('click',event=>{
      if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
    });
    dialog.addEventListener('close',()=>{
      window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);
      popup=null;trigger.setAttribute('aria-expanded','false');dialog.remove();trigger.focus({preventScroll:true});
    },{once:true});
    popup={dialog,sync:syncPopup};
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
    document.body.append(dialog);syncPopup();dialog.showModal();trigger.setAttribute('aria-expanded','true');position();
    (slider.tabIndex===0?slider:modelButton).focus({preventScroll:true});
  };
}
