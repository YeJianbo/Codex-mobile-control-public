export function mountChannels({api,button}){
  const dialog=document.createElement('dialog');dialog.className='modal channels-modal';
  dialog.innerHTML='<div class="modal-heading"><h2>QQ / 微信</h2><button class="button secondary" data-dismiss>关闭</button></div><p class="inline-error" role="alert" data-error></p><div data-platforms></div><p class="muted">发文字开始任务；/状态、/结果、/停止、/新会话。会话会自动出现在电脑和手机控制台。</p>';
  document.body.append(dialog);
  const container=dialog.querySelector('[data-platforms]'),error=dialog.querySelector('[data-error]');
  const rows=new Map();let accounts=[],projects=[],refreshing=false,loginTimer,timer,loginActive=false;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
  const act=async(fn,control)=>{if(control)control.disabled=true;error.textContent='';try{await fn();}catch(e){error.textContent=e.message||'操作失败';}finally{if(control)control.disabled=false;}};
  const endpoint=(id,tail='')=>`/api/channels/accounts/${encodeURIComponent(id)}${tail}`;
  const actionButton=(text,fn)=>{const node=el('button',text,'button secondary');node.type='button';node.onclick=()=>act(fn,node);return node;};
  const statusNames={connected:'已连接',connecting:'正在连接',disconnected:'未连接',error:'连接失败',unavailable:'不可用'};
  const accountFor=kind=>accounts.find(account=>account.channel===kind);
  async function ensure(kind){let account=accountFor(kind);if(!account){account=(await api('/api/channels/accounts',{method:'POST',body:{channel:kind,label:kind==='qq'?'QQ 官方机器人':'微信'}})).account;accounts.push(account);}return account;}
  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{accounts=(await api('/api/channels')).accounts;
      for(const [kind,row] of rows){const account=accountFor(kind);row.status.textContent=account?(account.details.transport==='reconnecting'?'正在重连':statusNames[account.state]||account.state):'未配置';row.issue.textContent=account?.details.lastError||'';
        if(account?.projectPath&&!row.project.value)row.project.value=account.projectPath;
        if(row.appId&&!row.appId.value&&account?.details.appId)row.appId.value=account.details.appId;
      }
    }finally{refreshing=false;}
  }
  async function saveProject(kind){const row=rows.get(kind);if(!row.project.value)throw Error('请选择工作目录');const account=await ensure(kind);await api(endpoint(account.id,'/settings'),{method:'PUT',body:{projectPath:row.project.value}});return account;}
  async function connect(kind){const account=await saveProject(kind);await api(endpoint(account.id,'/disconnect'),{method:'POST'});await api(endpoint(account.id,'/connect'),{method:'POST'});await refresh();}
  function createPlatform(kind){
    const root=el('section',null,'channel-account'),status=el('p',null,'muted'),issue=el('p',null,'inline-error');
    root.append(el('h3',kind==='qq'?'QQ 官方机器人':'微信'),status,issue);
    const project=el('select');project.setAttribute('aria-label',`${kind==='qq'?'QQ':'微信'}工作目录`);project.add(new Option('选择工作目录',''));for(const item of projects)project.add(new Option(item.name||item.path,item.path));
    const label=el('label','新会话的工作目录');label.className='channel-project';label.append(project);root.append(label);
    const row={root,status,issue,project};rows.set(kind,row);
    if(kind==='qq'){
      const form=document.createElement('form');form.className='channel-credentials';
      const appId=el('input');appId.placeholder='AppID';appId.autocomplete='off';appId.setAttribute('aria-label','QQ AppID');row.appId=appId;
      const secret=el('input');secret.type='password';secret.placeholder='AppSecret（已保存时可留空）';secret.autocomplete='new-password';secret.setAttribute('aria-label','QQ AppSecret');
      const save=el('button','保存并连接','button');form.append(appId,secret,save);
      form.onsubmit=e=>{e.preventDefault();act(async()=>{const account=await ensure(kind);
        if(secret.value){const body={appId:appId.value.trim(),appSecret:secret.value.trim()};secret.value='';await api(endpoint(account.id,'/credentials'),{method:'PUT',body});}
        else if(!account.details?.configured)throw Error('请填写 QQ 开放平台的 AppID 和 AppSecret');
        await connect(kind);
      },save);};root.append(form);
      const link=el('a','打开 QQ 机器人开放平台');link.href='https://q.qq.com/';link.target='_blank';link.rel='noopener noreferrer';root.append(link);
    }else{
      const login=el('div',null,'channel-login'),qr=el('img');qr.width=256;qr.height=256;qr.alt='微信登录二维码';qr.hidden=true;
      const qrStatus=el('p',null,'muted'),verify=el('input');verify.placeholder='微信显示的验证码';verify.hidden=true;verify.autocomplete='off';
      const verifyButton=actionButton('提交验证码',async()=>{await poll(verify.value);verify.value='';});verifyButton.hidden=true;
      function showLogin(result){
        if(result.qrImage){qr.src=result.qrImage;qr.hidden=['confirmed','expired','binded_redirect','verify_code_blocked'].includes(result.status);}
        qrStatus.textContent=({wait:'请用微信扫描二维码',scaned:'已扫码，请在微信确认',confirmed:'已登录',expired:'二维码已过期，请重新扫码',need_verifycode:'请填写微信显示的验证码',verify_code_blocked:'验证次数过多，请刷新二维码',scaned_but_redirect:'正在继续验证',binded_redirect:'请在微信中调整机器人绑定后重试'})[result.status]||'正在等待微信';
        verify.hidden=verifyButton.hidden=result.status!=='need_verifycode';
        return ['wait','scaned','scaned_but_redirect','need_verifycode'].includes(result.status);
      }
      async function poll(verifyCode){
        clearTimeout(loginTimer);const account=accountFor(kind);if(!account)return;
        const result=await api(endpoint(account.id,'/login'),{method:'POST',body:{...(verifyCode?{verifyCode}:{})}});
        if(!dialog.open||!loginActive)return;
        if(showLogin(result))loginTimer=setTimeout(()=>act(()=>poll()),2500);
        else{loginActive=false;if(result.status==='confirmed')await connect(kind);await refresh();}
      }
      login.append(actionButton('微信扫码连接',async()=>{const account=await saveProject(kind);clearTimeout(loginTimer);loginActive=true;await api(endpoint(account.id,'/disconnect'),{method:'POST'});showLogin(await api(endpoint(account.id,'/login'),{method:'POST',body:{refresh:true}}));loginTimer=setTimeout(()=>act(()=>poll()),2500);}),actionButton('重新连接',()=>connect(kind)),qr,qrStatus,verify,verifyButton);root.append(login);
    }
    const controls=el('div',null,'button-row');controls.append(actionButton('断开',async()=>{const account=accountFor(kind);if(account)await api(endpoint(account.id,'/disconnect'),{method:'POST'});await refresh();}),actionButton('清除登录',async()=>{const account=accountFor(kind);if(account)await api(endpoint(account.id),{method:'DELETE'});if(row.appId)row.appId.value='';await refresh();}));root.append(controls);container.append(root);
  }
  dialog.querySelector('[data-dismiss]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{clearTimeout(loginTimer);clearInterval(timer);loginActive=false;});
  button.onclick=()=>act(async()=>{dialog.showModal();rows.clear();container.replaceChildren();projects=(await api('/api/projects')).projects;for(const kind of ['qq','weixin'])createPlatform(kind);await refresh();clearInterval(timer);timer=setInterval(()=>{if(dialog.open)act(refresh);},4000);});
}
