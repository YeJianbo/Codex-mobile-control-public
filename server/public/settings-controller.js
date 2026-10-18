/** Owns settings hydration and save races; model catalog loading remains shared with chat. */
export function createSettingsController({
  state, $, api, run, safeRead, loadModels, fillModelChoices, fillChatEfforts, updateControls, refreshCodex, toast, errorMessage,
}) {
  async function loadSettings(afterSave=false) {
    if(state.settingsSaving&&!afterSave)return;
    const generation=state.generation,request=state.settingsRequest=(state.settingsRequest||0)+1;
    const initialSettings=!state.settingsLoaded;
    state.settingsLoaded=false;state.rawSettingsLoaded=false;updateControls();
    $('settingsLoadStatus').hidden=false;$('settingsLoadMessage').textContent='正在读取设置…';$('retrySettings').hidden=true;
    const [modelsResult,settingsResult, rawResult, summaryResult, remoteApprovalResult, capacityRetryResult,harnessAccessResult] = await Promise.allSettled([
      loadModels(),
      api("/api/settings/user"),
      api("/api/settings/user/raw"),
      api("/api/settings/approval-summary"),
      api("/api/settings/remote-approval"),
      api('/api/settings/capacity-retry'),
      api('/api/settings/harness-access'),
    ]);
    if(generation!==state.generation||request!==state.settingsRequest)return;
    state.settingsLoaded=settingsResult.status==='fulfilled'&&modelsResult.status==='fulfilled';
    state.rawSettingsLoaded=rawResult.status==='fulfilled';
    if (settingsResult.status === "fulfilled") {
      state.settings = settingsResult.value.settings || {};
      if (!state.settingsDirty) fillSettings();
      if (initialSettings && !state.threadId && state.harness==='codex' && !safeRead('cmc.model.codex') && !safeRead('cmc.model') && state.models.some(m=>m.model===state.settings.model))
        $("chatModel").value = state.settings.model || "";
      fillChatEfforts();
    }
    if (rawResult.status === "fulfilled" && !state.rawDirty) {
      $("configPath").textContent = rawResult.value.config.path;
      $("rawConfig").value = rawResult.value.config.content;
    }
    if (summaryResult.status === "fulfilled")
      $("approvalSummary").textContent = summaryResult.value.summary.summary;
    else $('approvalSummary').textContent='摘要读取失败';
    if(remoteApprovalResult.status==='fulfilled')$('settingRemoteAutoApproval').checked=remoteApprovalResult.value.desktopAutoApprove===true;
    if(capacityRetryResult.status==='fulfilled')$('settingCapacityRetry').checked=capacityRetryResult.value.enabled===true;
    if(harnessAccessResult.status==='fulfilled')renderHarnessAccess(harnessAccessResult.value);
    const errors=[[modelsResult,'模型'],[settingsResult,'普通设置'],[rawResult,'完整配置'],[summaryResult,'审批摘要'],[remoteApprovalResult,'远程审批状态'],[capacityRetryResult,'自动重试']].filter(([result])=>result.status==='rejected').map(([result,label])=>label+'：'+errorMessage(result.reason));
    $('settingsLoadStatus').hidden=!errors.length;$('settingsLoadMessage').textContent=errors.length?'部分设置未读取成功。'+errors.join('；'):'';$('retrySettings').hidden=!errors.length;
    updateControls();
    await refreshCodex();
    return {errors};
  }

  function renderHarnessAccess(result){
    const container=$('harnessPublicAccess');container.replaceChildren();
    for(const agent of result.agents||[]){
      const label=document.createElement('label');label.className='switch-row';
      const name=document.createElement('span');name.textContent=agent.name;
      const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.checked=agent.enabled;input.dataset.harnessPublic=agent.agent;
      input.onchange=()=>run(async()=>{
        input.disabled=true;
        try{await api('/api/settings/harness-access',{method:'PUT',body:{agents:{[agent.agent]:input.checked}}});await loadModels();}
        catch(error){input.checked=!input.checked;throw error;}
        finally{input.disabled=false;}
      });
      label.append(name,input);container.append(label);
    }
  }
  const settingsFields = {
    model: "settingModel",
    reasoningEffort: "settingEffort",
    modelProvider: "settingProvider",
    providerBaseUrl: "settingBaseUrl",
    approvalPolicy: "settingApproval",
    sandboxMode: "settingSandbox",
    networkAccess: "settingNetwork",
    disableResponseStorage: "settingStorage",
  };
  function fillSettings() {
    for (const [key, id] of Object.entries(settingsFields)) {
      const field = $(id);
      if (field.type === "checkbox") field.checked = Boolean(state.settings[key]);
      else {
        const value = state.settings[key] || "";
        if (key !== 'model' &&
          field.tagName === "SELECT" &&
          !Array.from(field.options).some((o) => o.value === value)
        )
          field.add(new Option(value, value));
        field.value = value;
      }
    }
    fillModelChoices();
  }
  function readSettingsForm(){
    const settings = {};
    for (const [key, id] of Object.entries(settingsFields))
      if(key!=='modelProvider' && key!=='providerBaseUrl')
      settings[key] = $(id).type === "checkbox" ? $(id).checked : $(id).value;
    return settings;
  }
  async function refreshSavedSettings(message,generation){
    try{const result=await loadSettings(true);if(generation===state.generation)toast(result?.errors?.length?message+'，部分设置读取失败，请在设置页重试。':message,Boolean(result?.errors?.length));}
    catch(error){if(generation===state.generation)toast(message+'，设置刷新失败：'+errorMessage(error),true);}
  }
  async function saveSettings() {
    if (!state.settingsLoaded||state.settingsSaving) return;
    const settings=readSettingsForm(),generation=state.generation;
    state.settingsSaving=true;state.settingsRequest=(state.settingsRequest||0)+1;updateControls();
    try{
    const result = await api("/api/settings/user", {
      method: "PUT",
      body: settings,
    });
    if(generation!==state.generation)return;
    state.settings = result.settings;
    state.settingsDirty = JSON.stringify(readSettingsForm())!==JSON.stringify(settings);
    await refreshSavedSettings(state.settingsDirty?'设置已保存，后续修改尚未保存':'设置已保存',generation);
    }finally{state.settingsSaving=false;updateControls();}
  }
  async function saveRawConfig(){
    if(!state.rawSettingsLoaded||state.settingsSaving)return;
    const content=$('rawConfig').value,generation=state.generation;
    state.settingsSaving=true;state.settingsRequest=(state.settingsRequest||0)+1;updateControls();
    try{
      await api('/api/settings/user/raw',{method:'PUT',body:{content}});
      if(generation!==state.generation)return;
      state.rawDirty=$('rawConfig').value!==content;
      await refreshSavedSettings(state.rawDirty?'完整配置已保存，后续修改尚未保存':'完整配置已保存',generation);
    }finally{state.settingsSaving=false;updateControls();}
  }
  for (const id of Object.values(settingsFields))
    $(id).oninput = () => (state.settingsDirty = true);
  $('settingCapacityRetry').onchange=()=>run(async()=>{
    const field=$('settingCapacityRetry');field.disabled=true;
    try{await api('/api/settings/capacity-retry',{method:'PUT',body:{enabled:field.checked}});}
    catch(error){field.checked=!field.checked;throw error;}
    finally{field.disabled=false;}
  });
  $('settingRemoteAutoApproval').onchange=()=>run(async()=>{
    const field=$('settingRemoteAutoApproval');
    field.disabled=true;
    try{await api('/api/settings/remote-approval',{method:'PUT',body:{desktopAutoApprove:field.checked}});}
    catch(error){field.checked=!field.checked;throw error;}
    finally{field.disabled=false;}
  });
  $("rawConfig").oninput = () => (state.rawDirty = true);
  $("saveSettingsBtn").onclick = () => run(saveSettings, $("saveSettingsBtn"));
  $('retrySettings').onclick=()=>run(()=>loadSettings(),$('retrySettings'));
  $("saveRawBtn").onclick = () =>
    run(saveRawConfig, $("saveRawBtn"));

  return {loadSettings, saveSettings, saveRawConfig};
}
