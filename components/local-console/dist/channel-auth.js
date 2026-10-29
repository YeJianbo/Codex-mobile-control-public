const apiBase=document.querySelector('meta[name="local-api-base"]')?.content||'/api/';
const gateway=document.querySelector('meta[name="console-gateway"]')?.content==='true';
let reading=false,lastRead=0;
async function call(route,body){
  const token=gateway?localStorage.getItem('cmc.token')||'':document.querySelector('meta[name="local-token"]')?.content;
  const response=await fetch(apiBase+route,{method:body?'POST':'GET',headers:{...(gateway?{Authorization:'Bearer '+token}:{'X-Local-Token':token}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const value=await response.json();if(!response.ok)throw Error(value.error||'QQ 授权设置读取失败');return value;
}
async function refresh(){
  const panel=document.querySelector('[data-qq-auth]');if(!panel||document.hidden||reading)return;
  reading=true;lastRead=Date.now();
  try{
    const value=await call('access/channels'),id=panel.closest('[data-channel]').querySelector('[data-channel-account]').value;
    const account=value.accounts?.find(account=>account.id===id),count=account?.details?.authorizedCount||0;
    if(!panel.isConnected)return;
    panel.querySelector('[data-qq-auth-state]').textContent=count?`已授权 ${count} 个 QQ 账号`:'尚未授权 QQ，机器人不会执行聊天任务';
    panel.querySelector('[data-qq-auth-revoke]').disabled=count===0;
    panel.querySelector('[data-qq-auth-pair]').disabled=!id;
  }catch(error){if(panel.isConnected)panel.querySelector('[data-qq-auth-state]').textContent=error.message;}finally{reading=false;}
}
function mount(){
  const accountPanel=document.querySelector('[data-channel="qq"]');if(!accountPanel||accountPanel.querySelector('[data-qq-auth]'))return;
  const panel=document.createElement('div');panel.dataset.qqAuth='';panel.className='qq-authorization';
  panel.innerHTML='<p data-qq-auth-state>仅允许已绑定的 QQ 使用</p><div class="actions"><button type="button" data-qq-auth-pair>生成绑定码</button><button type="button" data-qq-auth-revoke disabled>清除授权</button></div><div data-qq-auth-command hidden><p>用需要授权的 QQ 私聊机器人发送以下命令。十分钟内有效，只能使用一次。</p><input readonly aria-label="QQ 绑定命令"><button type="button" data-qq-auth-copy>复制绑定命令</button><small data-qq-auth-expiry></small></div><p data-qq-auth-error role="alert"></p>';
  accountPanel.querySelector('form').prepend(panel);
  const picker=accountPanel.querySelector('[data-channel-account]'),command=panel.querySelector('[data-qq-auth-command]'),error=panel.querySelector('[data-qq-auth-error]');
  let busy=false,expiryTimer,revokeConfirm=false;
  picker.addEventListener('change',()=>{command.hidden=true;clearTimeout(expiryTimer);revokeConfirm=false;panel.querySelector('[data-qq-auth-revoke]').textContent='清除授权';void refresh();});
  async function action(kind,button){
    if(busy||!picker.value)return;const id=picker.value;busy=true;button.disabled=true;error.textContent='';
    try{
      const value=await call('access/channel',{id,action:kind,...(kind==='revoke-access'?{confirmed:true}:{})});
      if(!panel.isConnected||picker.value!==id)return;
      if(kind==='pair'){
        command.hidden=false;command.querySelector('input').value='/绑定 '+value.code;panel.querySelector('[data-qq-auth-expiry]').textContent='';clearTimeout(expiryTimer);
        expiryTimer=setTimeout(()=>{if(panel.isConnected){command.querySelector('input').value='';panel.querySelector('[data-qq-auth-expiry]').textContent='绑定码已过期，请重新生成';}},Math.max(0,value.expiresAt-Date.now()));
      }else{command.hidden=true;clearTimeout(expiryTimer);revokeConfirm=false;button.textContent='清除授权';}
    }catch(reason){if(panel.isConnected)error.textContent=reason.message;}finally{busy=false;if(panel.isConnected){button.disabled=false;void refresh();}}
  }
  panel.querySelector('[data-qq-auth-pair]').onclick=event=>void action('pair',event.currentTarget);
  panel.querySelector('[data-qq-auth-revoke]').onclick=event=>{if(!revokeConfirm){revokeConfirm=true;event.currentTarget.textContent='确认清除全部 QQ 授权';return;}void action('revoke-access',event.currentTarget);};
  panel.querySelector('[data-qq-auth-copy]').onclick=async()=>{const input=command.querySelector('input');if(!input.value)return;try{await navigator.clipboard.writeText(input.value);}catch{input.select();document.execCommand('copy');}};
  void refresh();
}
new MutationObserver(mount).observe(document.querySelector('#app'),{childList:true,subtree:true});
setInterval(()=>{if(Date.now()-lastRead>15000)void refresh();},15000);mount();
