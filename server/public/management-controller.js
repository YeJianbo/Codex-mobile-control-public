/** Owns management operation lifetimes and their connection-generation guards. */
export function createManagementController({
  state, $, api, run, el, button, confirmAction, errorMessage, comparablePath, renderProjects, refreshProjects, toast, onlineRequired,
}) {
  let codexStatusTicket=0,codexStateGeneration=-1,codexAction=null,codexStatusLoading=false,codexStatusError='',codexRenderedStatus='';
  function syncCodexScope(){
    if(codexStateGeneration===state.generation)return;
    codexStateGeneration=state.generation;codexStatusTicket++;codexAction=null;codexStatusLoading=false;codexStatusError='';codexRenderedStatus='';state.codex=null;
  }
  function renderCodexStatus(){
    syncCodexScope();
    const busy=Boolean(codexAction),codex=state.codex;
    const label=!state.connected?'连接后读取运行状态':busy?(codexAction.action==='restart'?'正在重启 Codex…':'正在启动 Codex…'):codexStatusLoading?'正在检查 Codex…':codexStatusError||(!codex?'尚未读取 Codex 状态':codex.running?'● Codex 正在运行':'○ Codex 尚未启动');
    const signature=JSON.stringify([label,codex?.cliVersion,codex?.lastError]);
    if(signature!==codexRenderedStatus){
      codexRenderedStatus=signature;
      const nodes=[el('div',codexStatusError?'error':null,label)];
      if(codex)nodes.push(el('div','muted',codex.cliVersion||'未检测到 Codex CLI'));
      if(codex?.lastError)nodes.push(el('p','muted',codex.lastError));
      $('codexStatus').replaceChildren(...nodes);
    }
    $('codexStartBtn').disabled=!state.connected||busy||Boolean(codex?.running);
    $('codexRestartBtn').disabled=!state.connected||busy;
    $('codexRefreshBtn').disabled=!state.connected||busy||codexStatusLoading;
  }
  async function refreshCodex(){
    syncCodexScope();if(!state.connected||codexAction){renderCodexStatus();return;}
    const generation=state.generation,ticket=++codexStatusTicket;
    const current=()=>generation===state.generation&&ticket===codexStatusTicket;
    codexStatusLoading=true;codexStatusError='';renderCodexStatus();
    try{const {codex}=await api('/api/codex/status');if(current())state.codex=codex;}
    catch(error){if(current())codexStatusError='无法检查 Codex：'+errorMessage(error);}
    finally{if(current()){codexStatusLoading=false;renderCodexStatus();}}
  }
  async function operateCodex(action){
    syncCodexScope();if(!state.connected||codexAction||(action==='start'&&state.codex?.running))return;
    const operation={action,generation:state.generation,ticket:++codexStatusTicket};
    const current=()=>codexAction===operation&&operation.generation===state.generation;
    codexAction=operation;codexStatusLoading=false;codexStatusError='';renderCodexStatus();
    try{
      if(action==='restart'&&!(await confirmAction('重启 Codex？','正在执行的任务可能会中断。')))return;
      if(!current())return;
      const {codex}=await api('/api/codex/'+action,{method:'POST',body:{},timeout:65000});
      if(current())state.codex=codex;
    }catch(error){if(current())codexStatusError=(action==='restart'?'无法重启 Codex：':'无法启动 Codex：')+errorMessage(error);}
    finally{if(codexAction===operation){codexAction=null;renderCodexStatus();}}
  }
  const removingRoots=new Set();
  function rootRemovalKey(project,generation){return JSON.stringify([generation,comparablePath(project.path)]);}
  async function removeProjectRoot(project,generation){
    const key=rootRemovalKey(project,generation);
    if(generation!==state.generation||removingRoots.has(key))return;
    removingRoots.add(key);renderRoots();
    try{
      if(!await confirmAction('移除项目？',`将移除 ${project.name} 的访问权限，电脑上的文件会保留。`))return;
      if(generation!==state.generation)return;
      await api(`/api/config/project-roots?path=${encodeURIComponent(project.path)}`,{method:'DELETE'});
      if(generation!==state.generation)return;
      state.projectsRequest=(state.projectsRequest||0)+1;
      state.projects=state.projects.filter(row=>comparablePath(row.path)!==comparablePath(project.path));
      state.sidebarProjects=(state.sidebarProjects||[]).filter(row=>comparablePath(row.path)!==comparablePath(project.path));
      renderProjects();
      try{await refreshProjects();}
      catch(error){if(generation===state.generation)toast('项目访问权限已移除，列表刷新失败：'+errorMessage(error),true);}
    }catch(error){if(generation===state.generation)throw error;}
    finally{removingRoots.delete(key);if(generation===state.generation)renderRoots();}
  }
  function renderRoots() {
    const generation=state.generation;
    $("projectRoots").replaceChildren(
      ...state.projects.map((project) => {
        const row = el("div", "settings-row");
        const content = el("div");
        content.append(
          el("strong", null, project.name),
          el("small", null, project.path),
        );
        const remove=button('移除',()=>removeProjectRoot(project,generation));
        const busy=removingRoots.has(rootRemovalKey(project,generation));
        remove.disabled=busy;remove.setAttribute('aria-busy',String(busy));
        row.append(content,remove);
        return row;
      }),
    );
    if (!state.projects.length)
      $("projectRoots").append(el("p", "muted", "还没有添加项目目录。"));
  }
  let upgradeCheck=null,upgradeGeneration=-1;
  function updateUpgradeControl(){
    if(upgradeGeneration!==state.generation){upgradeGeneration=state.generation;$('upgradeStatus').textContent='';}
    const busy=upgradeCheck?.generation===state.generation,control=$('checkUpgradeBtn');
    control.disabled=!state.connected||busy;
    control.setAttribute('aria-busy',String(busy));
  }
  async function checkUpgrade(){
    if(!onlineRequired()||upgradeCheck?.generation===state.generation)return;
    const request={generation:state.generation};upgradeCheck=request;updateUpgradeControl();
    const status=$('upgradeStatus');status.setAttribute('role','status');status.textContent='正在检查更新…';
    try{
      const {upgrade}=await api('/api/codex/upgrade-check');
      if(upgradeCheck!==request||request.generation!==state.generation)return;
      if(upgrade.error)status.textContent='检查更新失败：'+upgrade.error;
      else if(!upgrade.installedVersion)status.textContent=upgrade.latestVersion?`最新发布版本 ${upgrade.latestVersion}，未能读取当前版本。`:'未能读取版本信息，请重试。';
      else if(!upgrade.latestVersion)status.textContent=`当前版本 ${upgrade.installedVersion}，未能确认最新版本。`;
      else if(upgrade.updateAvailable)status.textContent=`可更新到 ${upgrade.latestVersion}。${upgrade.command||''}`;
      else status.textContent=upgrade.installedVersion===upgrade.latestVersion?`当前已是最新版本 ${upgrade.installedVersion}`:`当前版本 ${upgrade.installedVersion}，最新发布版本 ${upgrade.latestVersion}`;
    }catch(error){
      if(upgradeCheck===request&&request.generation===state.generation)status.textContent='检查更新失败：'+errorMessage(error);
    }finally{if(upgradeCheck===request)upgradeCheck=null;updateUpgradeControl();}
  }
  $("codexStartBtn").onclick = () => run(()=>operateCodex('start'));
  $("codexRestartBtn").onclick = () => run(()=>operateCodex('restart'));
  $("codexRefreshBtn").onclick = () => run(refreshCodex);
  $("checkUpgradeBtn").onclick = () =>
    run(checkUpgrade);

  return {renderCodexStatus, refreshCodex, operateCodex, renderRoots, removeProjectRoot, updateUpgradeControl, checkUpgrade};
}
