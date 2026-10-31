import {modelHarness,modelDisplayName} from './model-identity.js';

export function renderModelChoices({state,$,safeRead,Option,fillEfforts,fillChatEfforts,updateBackendNotice,preserveAvailable=false},rememberedModel='') {
  for(const id of ['chatModel','settingModel']) {
    const node=$(id),previous=(id==='chatModel'?rememberedModel:'') || node.value || safeRead('cmc.model.'+state.harness) || (state.harness==='codex'?safeRead('cmc.model')||state.settings?.model:'');
    const models=state.models.filter(m=>m.available!==false&&modelHarness(m)===(id==='settingModel'?'codex':state.harness));
    if(preserveAvailable&&models.length)continue;
    if(!models.length&&state.modelLoadFailed){
      node.replaceChildren(new Option('模型读取失败，请刷新',''));node.disabled=true;continue;
    }
    if(!models.length&&state.modelPending?.includes(id==='settingModel'?'codex':state.harness)){
      node.replaceChildren(new Option('正在读取模型…',''));node.disabled=true;continue;
    }
    node.replaceChildren(...models.map(m=>{
      const agent=modelHarness(m),option=new Option(modelDisplayName(m),m.model);
      option.dataset.compactLabel=option.textContent;
      option.dataset.agent=agent;
      if(agent==='opencode'){
        const raw=m.displayName.replace(/^OpenCode · /,''),slash=raw.indexOf('/');
        option.dataset.group=m.providerId||m.model.slice('opencode::'.length).split('/')[0];
        option.dataset.groupLabel=m.providerName||(slash>=0?raw.slice(0,slash):'OpenCode');
      }
      return option;
    }));
    const missingOpenCode=id==='chatModel'&&state.harness==='opencode'&&previous.startsWith('opencode::')&&!models.some(m=>m.model===previous);
    if(missingOpenCode){
      const option=new Option(`${previous.split('/').at(-1).replace(/^opencode::/,'')}（不可用，请重新选择）`,previous);
      option.disabled=true;option.dataset.agent='opencode';option.dataset.group='unavailable';option.dataset.groupLabel='不可用';option.dataset.unavailableReason='该模型已不在当前可用目录，请重新选择';node.prepend(option);
    }
    node.value=missingOpenCode||models.some(m=>m.model===previous)?previous:(id==='chatModel'?(models.find(m=>m.model==='gpt-6-sol')||models.find(m=>m.model==='gpt-6.1-sol'))?.model:undefined)||models.find(m=>m.model.endsWith('::default'))?.model||models[0]?.model||'';
    node.disabled=!models.length;
  }
  fillEfforts();
  fillChatEfforts();
  updateBackendNotice();
}
export function renderModelEfforts({state,$,safeRead,Option}){
  const model=state.models.find(m=>m.model===$('chatModel').value),select=$('chatEffort');
  const context=JSON.stringify([state.threadId||'',state.harness,model?.model||'']),current=select.value,preserve=select.dataset.context===context;
  const remembered=safeRead('cmc.effort.'+(model?.model||'')),choices=model?.supportedReasoningEfforts||[];
  const labels={default:'默认',__default:'默认',off:'关',none:'无',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'超高',ultra:'最高'};
  const identity=`${model?.model||''} ${model?.displayName||''}`.toLowerCase();
  const ecnu=/^(deepseek|pi)::/.test(identity)&&/ecnu[-/", ]+(max|plus)/.test(identity);
  const ecnuLabels=identity.startsWith('pi::')?{off:'关',low:'中',medium:'高',xhigh:'超高'}:{off:'关',low:'中',high:'高',medium:'高',max:'超高',xhigh:'超高'};
  select.replaceChildren(...choices.map(e=>{
    const label=(ecnu&&ecnuLabels[e.reasoningEffort])||labels[e.reasoningEffort]||e.reasoningEffort;
    const option=new Option(ecnu?label:`${label} · ${e.reasoningEffort}`,e.reasoningEffort);
    option.dataset.compactLabel=label;
    return option;
  }));
  const preferred=preserve&&choices.some(choice=>choice.reasoningEffort===current)?current:remembered||(model?.model?.includes('astra')?'medium':model?.model?.includes('sol')?'high':state.settings?.reasoningEffort)||model?.defaultReasoningEffort;
  const fallback=choices.find(choice=>choice.reasoningEffort===model?.defaultReasoningEffort)?.reasoningEffort??choices[0]?.reasoningEffort??'';
  select.value=choices.some(e=>e.reasoningEffort===preferred)?preferred:fallback;
  select.dataset.context=context;
  if(!choices.length)select.add(new Option('模型默认',''));
  select.disabled=!state.connected||!choices.length;
}
