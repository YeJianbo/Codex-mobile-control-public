// Selects remain the form/state source; all visible pickers are shared across clients.
let retiringPicker;
function finishRetiringPicker(dialog) {
  if(!retiringPicker)return;
  if(retiringPicker.classList.contains('model-settings-dialog')===dialog.classList.contains('model-settings-dialog')){
    const style=getComputedStyle(retiringPicker);
    dialog.style.setProperty('--surface-start-opacity',style.opacity);
    dialog.style.setProperty('--surface-start-transform',style.transform);
  }
  retiringPicker.remove();retiringPicker=null;
}
function retirePicker(dialog) {
  dialog.inert=true;
  dialog.setAttribute('aria-hidden','true');
  dialog.classList.add('surface-closing');
  const immediate=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.input==='keyboard';
  if(immediate)dialog.remove();
  else {retiringPicker=dialog;setTimeout(()=>{dialog.remove();if(retiringPicker===dialog)retiringPicker=null;},180);}
}
const visibleSelectOptions=select=>[...select.options].filter(option=>!option.hidden&&!option.closest('optgroup')?.hidden);
const enabledOption=option=>!option.disabled&&!option.closest('optgroup')?.disabled;
function fieldLabelText(element){
  const text=[];
  const visit=node=>{
    if(node.nodeType===Node.TEXT_NODE)text.push(node.textContent);
    else if(node.nodeType===Node.ELEMENT_NODE&&!node.matches('select,button,input,textarea,[aria-hidden="true"]'))node.childNodes.forEach(visit);
  };
  visit(element);return text.join('').replace(/\s+/g,' ').trim();
}
function selectFieldName(select,labels){
  const namedBy=(select.getAttribute('aria-labelledby')||'').trim().split(/\s+/)
    .map(id=>document.getElementById(id)).filter(Boolean).map(fieldLabelText).filter(Boolean).join(' ');
  return namedBy||select.getAttribute('aria-label')?.trim()||labels.map(fieldLabelText).filter(Boolean).join(' ')||'请选择';
}
function observeSelect(select, sync) {
  new MutationObserver(sync).observe(select, {childList:true, subtree:true, attributes:true});
  select.addEventListener('change', sync);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {get() {return descriptor.get.call(this)}, set(value) {descriptor.set.call(this,value);sync()}});
}
document.querySelectorAll('select:not(#chatModel):not(#chatEffort)').forEach((select, index) => {
  let activeDialog,refreshOptions;
  const labels=[...select.labels];
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id=`custom-select-trigger-${select.id||index}`;
  trigger.className = `custom-select ${select.className}`;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  select.after(trigger);
  select.hidden = true;
  // The visible button owns label activation; the hidden select keeps form state.
  labels.forEach(label=>{label.htmlFor=trigger.id;});
  const sync = () => {
    const selected=select.selectedOptions[0];
    trigger.textContent = selected?.dataset.compactLabel || selected?.textContent || '请选择';
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-label', `${selectFieldName(select,labels)}：${selected?.textContent || trigger.textContent}`);
    trigger.title=trigger.getAttribute('aria-label');
    if(select.disabled && activeDialog?.open)activeDialog.close();
    else if(activeDialog?.open)refreshOptions?.();
  };
  observeSelect(select, sync);
  trigger.onclick = () => {
    if(select.disabled || activeDialog?.open)return;
    const dialog = document.createElement('dialog');
    activeDialog=dialog;
    dialog.className = 'choice-dialog';
    const header=document.createElement('div');header.className='choice-header';
    const title = document.createElement('h3');
    title.textContent = selectFieldName(select,labels);
    title.id=`choice-title-${index}`;dialog.setAttribute('aria-labelledby',title.id);
    const close = document.createElement('button');
    close.type='button';close.setAttribute('aria-label','关闭');close.title='关闭';
    close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    close.className='icon-button';close.onclick=()=>dialog.close();header.append(title,close);dialog.append(header);
    const list=document.createElement('div');list.className='choice-options';
    const search=document.createElement('input');search.type='search';search.className='choice-search';
    search.placeholder='输入名称搜索';search.setAttribute('aria-label',`搜索${title.textContent}`);
    search.autocomplete='off';search.spellcheck=false;
    dialog.append(search);
    const empty=document.createElement('p');empty.className='choice-empty';empty.textContent='没有匹配项';empty.hidden=true;
    dialog.append(list);let signature='',composing=false;
    const filterOptions=(resetScroll=false)=>{
      const query=search.value.trim().toLowerCase();let count=0;
      list.querySelectorAll('.choice-option').forEach(item=>{item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++});
      empty.hidden=count>0;if(resetScroll)list.scrollTop=0;
    };
    refreshOptions=()=>{
      const options=visibleSelectOptions(select),next=JSON.stringify(options.map(option=>[option.value,option.textContent,enabledOption(option)]));
      search.hidden=options.length<=6&&!search.value;
      if(next!==signature){
        signature=next;const active=document.activeElement,inList=list.contains(active),value=inList?active.dataset.value:null,scrollTop=list.scrollTop;
        list.replaceChildren(...options.map(option=>{
          const item=document.createElement('button');item.type='button';item.className='choice-option';item.dataset.value=option.value;
          const label=document.createElement('span');label.className='choice-label';label.textContent=option.textContent;
          const check=document.createElement('span');check.className='choice-check';check.setAttribute('aria-hidden','true');
          check.innerHTML='<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
          item.append(label,check);item.dataset.search=`${option.textContent} ${option.value}`.toLowerCase();item.disabled=!enabledOption(option);
          item.onclick=()=>{
            if(select.disabled||!visibleSelectOptions(select).some(current=>current.value===option.value&&enabledOption(current)))return;
            select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();
          };
          return item;
        }),empty);
        filterOptions();list.scrollTop=scrollTop;
        if(inList){const rows=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);(rows.find(item=>item.dataset.value===value)||rows.find(item=>item.dataset.value===select.value)||(!search.hidden?search:rows[0])||close).focus({preventScroll:true});}
      }
      list.querySelectorAll('.choice-option').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.value===select.value)));
      if(dialog.open&&search.hidden&&document.activeElement===search){const rows=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);(rows.find(item=>item.dataset.value===select.value)||rows[0]||close).focus({preventScroll:true});}
      if(dialog.open)position();
    };
    refreshOptions();
    search.addEventListener('compositionstart',()=>{composing=true;});search.addEventListener('compositionend',()=>{composing=false;filterOptions(true);});
    search.oninput=event=>{if(!composing&&!event.isComposing)filterOptions(true);};
    dialog.addEventListener('keydown',event=>{
      if(composing||event.isComposing||event.keyCode===229)return;
      if(event.key==='Enter'&&event.target===search&&!event.isComposing){const items=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);if(items.length===1){event.preventDefault();items[0].click();}return;}
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
      dialog.style.setProperty('--surface-origin',openBelow?'left top':'left bottom');
      dialog.style.setProperty('--surface-offset',openBelow?'6px':'-6px');
      dialog.style.maxHeight=`${Math.max(120,Math.min(500,openBelow?below:above))}px`;
      const bounds={width:dialog.offsetWidth,height:dialog.offsetHeight};
      dialog.style.left=`${Math.max(12,Math.min(innerWidth-bounds.width-12,anchor.left))}px`;
      dialog.style.top=`${Math.max(12,openBelow?anchor.bottom+6:anchor.top-bounds.height-6)}px`;
    };
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
    dialog.addEventListener('close',()=>{
      window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);
      if(activeDialog===dialog){activeDialog=null;refreshOptions=undefined;trigger.setAttribute('aria-expanded','false');}retirePicker(dialog);if(!activeDialog?.open&&trigger.isConnected)trigger.focus({preventScroll:true});
    },{once:true});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
    finishRetiringPicker(dialog);document.body.append(dialog);dialog.showModal();trigger.setAttribute('aria-expanded','true');position();
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
  const modelOptions = () => visibleSelectOptions(model).filter(option => option.value);
  const levels = () => visibleSelectOptions(effort).filter(enabledOption)
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
    const permissionHarness=localStorage.getItem('cmc.harness')||'codex';
    if(permissionHarness==='antigravity'&&permission==='ask'){
      // AGY 无头模式不支持逐条审批；把遗留的"询问"迁移为"自动审批"，避免每轮触发服务端警告。
      try{localStorage.setItem('cmc.permission','auto');localStorage.setItem('cmc.permission.antigravity','auto');}catch{}
      permission='auto';
    }
    for(const [value,label] of [['auto','自动审批'],['full','完全访问'],...(permissionHarness==='antigravity'?[]:[['ask','询问']]),...(permissionHarness==='codex'||!localStorage.getItem('cmc.harness')?[['custom','自定义 (config.toml)']]:[])]){
      const choice=document.createElement('button');choice.type='button';choice.textContent=label;choice.dataset.permission=value;choice.setAttribute('aria-pressed',String(permission===value));
      choice.onclick=()=>{try{localStorage.setItem('cmc.permission',value);localStorage.setItem('cmc.permission.'+(localStorage.getItem('cmc.harness')||'codex'),value);}catch{};permissionOptions.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===choice)));};
      permissionOptions.append(choice);
    }
    if(permissionHarness==='antigravity'){
      const hint=document.createElement('p');
      hint.className='form-help';hint.style.margin='4px 0 0';
      hint.textContent='Antigravity CLI 无逐条审批能力，工具操作将自动执行。';
      permissionOptions.after(hint);
    }
    let choosingModel = false, modelSignature = '', levelSignature = '', dragging = false, composing = false;
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
      dialog.style.setProperty('--surface-origin',openBelow?'right top':'right bottom');
      dialog.style.setProperty('--surface-offset',openBelow?'6px':'-6px');
      dialog.style.maxHeight=`${Math.max(140,Math.min(500,openBelow?below:above))}px`;
      const bounds={width:dialog.offsetWidth,height:dialog.offsetHeight};
      dialog.style.left=`${Math.max(12,Math.min(innerWidth-bounds.width-12,anchor.right-bounds.width))}px`;
      dialog.style.top=`${Math.max(12,openBelow?anchor.bottom+6:anchor.top-bounds.height-6)}px`;
    };
    const filterModels = () => {
      const query=search.value.trim().toLowerCase();let count=0;
      list.querySelectorAll('.choice-option').forEach(item=>{item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++;});
      list.querySelectorAll('.agent-section-heading').forEach(heading=>{
        let row=heading.nextElementSibling,visible=false;
        while(row&&!row.classList.contains('agent-section-heading')){
          if(row.classList.contains('choice-option')&&!row.hidden)visible=true;
          row=row.nextElementSibling;
        }
        heading.hidden=!visible;
      });
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
      const nextSignature=JSON.stringify(options.map(option=>[option.value,option.textContent,enabledOption(option),option.dataset.group,option.dataset.groupLabel]));
      if(nextSignature!==modelSignature) {
        modelSignature=nextSignature;
        let lastGroup='';
        list.replaceChildren(...options.flatMap(option=>{
          const agent=option.dataset.agent||'codex';
          const heading=document.createElement('p');heading.className='agent-section-heading';
          const group=option.dataset.group?`${agent}:${option.dataset.group}`:agent;
          heading.textContent=option.dataset.groupLabel||({codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',grok:'Grok Build',deepseek:'DeepSeek Harness',hermes:'Hermes',opencode:'OpenCode'})[agent]||agent;
          const section=group!==lastGroup?[heading]:[];lastGroup=group;
          const item=document.createElement('button');item.type='button';item.className='choice-option';
          item.dataset.value=option.value;item.dataset.search=`${option.textContent} ${option.value} ${option.dataset.groupLabel||''}`.toLowerCase();item.disabled=!enabledOption(option);
          item.dataset.agent=agent;
          const label=document.createElement('span');label.className='choice-label';label.textContent=option.textContent.replace(/^(Claude Code|Antigravity|Grok Build) · /,'');
          if(option.disabled)item.title=option.dataset.unavailableReason||'请在新会话中切换助手';
          const check=document.createElement('span');check.className='choice-check';check.setAttribute('aria-hidden','true');
          check.innerHTML='<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
          item.append(label,check);
          item.onclick=()=>{
            if(model.disabled || !modelOptions().some(choice=>choice.value===option.value&&enabledOption(choice)))return;
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
      if(composing||event.isComposing||event.keyCode===229)return;
      if(choosingModel&&event.key==='Escape'){event.preventDefault();event.stopPropagation();showModelList(false);return;}
      if(choosingModel&&event.key==='Enter'&&event.target===search){const items=[...list.querySelectorAll('.choice-option')].filter(item=>!item.hidden&&!item.disabled);if(items.length===1){event.preventDefault();items[0].click();}return;}
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
    search.addEventListener('compositionstart',()=>{composing=true;});search.addEventListener('compositionend',()=>{composing=false;filterModels();list.scrollTop=0;});
    search.oninput=event=>{if(!composing&&!event.isComposing){filterModels();list.scrollTop=0;}};
    dialog.addEventListener('click',event=>{
      if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
    });
    dialog.addEventListener('close',()=>{
      window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);
      popup=null;trigger.setAttribute('aria-expanded','false');retirePicker(dialog);trigger.focus({preventScroll:true});
    },{once:true});
    popup={dialog,sync:syncPopup};
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
    finishRetiringPicker(dialog);document.body.append(dialog);syncPopup();dialog.showModal();trigger.setAttribute('aria-expanded','true');position();
    (slider.tabIndex===0?slider:modelButton).focus({preventScroll:true});
  };
}
