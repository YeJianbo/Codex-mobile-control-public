const apiBase=document.querySelector('meta[name="local-api-base"]')?.content||'/api/';
const gateway=document.querySelector('meta[name="console-gateway"]')?.content==='true';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const sources={all:'全部来源',codex:'Codex',router:'网关请求',agy:'Antigravity',claude:'Claude Code',zcode:'ZCode',grok:'Grok',hermes:'Hermes',deepseek:'DeepSeek',opencode:'OpenCode'};
const count=value=>value==null?'—':value>=1e8?(value/1e8).toFixed(2)+'亿':value>=1e4?(value/1e4).toFixed(2)+'万':value.toLocaleString('zh-CN');
const seconds=value=>value==null?'—':(value/1000).toFixed(2)+' 秒';
const money=cost=>cost?.basis==='subscription_included'?'套餐内':cost?.usd==null?'—':'$'+cost.usd.toFixed(cost.usd<.01?6:4);
const tierLabel=value=>({standard:'标准',default:'标准',fast:'Fast',priority:'Fast',ultrafast:'Ultrafast'})[value]||value||'未记录';
const timingLabel=row=>row.timingBasis==='model-output-estimate'?'模型输出流计时估算，含推理':row.timingBasis==='visible-text-estimate'?'可见文字流计时估算':row.durationMs==null?'未记录':row.timingBasis==='native-recorded'?'原生记录耗时':'输出 Token / 整个请求耗时';
let dialog,controller,cursors=[''],data=null,generation=0;
function option(values){return Object.entries(values).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');}
function record(row){
  const time=new Date(row.time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const estimated=String(row.timingBasis||'').endsWith('estimate');
  const speedLabel=estimated?'输出流 Token/s · 估算':row.timingBasis==='native-recorded'?'平均 Token/s':'全程 Token/s';
  const hit=row.inputTokens>0&&row.cachedTokens!=null&&row.cachedTokens<=row.inputTokens?(row.cachedTokens/row.inputTokens*100).toFixed(1)+'%':'—';
  const costLabel=({subscription_included:'套餐内',provider_reported:'供应商实报',native:'原生金额',reported:'供应商实报',native_estimate:'原生估算',reference:'参考估算',official_reference:'参考估算'})[row.cost?.basis]||(row.cost?.usd!=null?'参考估算':'未计价');
  const nativeTier=row.tierBasis==='native-setting';
  const tierSummary=row.tier?' · '+tierLabel(row.tier)+(nativeTier?' · 会话设置':''):'';
  const value=(label,content)=>`<div><dt>${label}</dt><dd>${escape(content)}</dd></div>`;
  return `<details class="request-record"><summary><span class="request-record-model"><b>${escape(row.model||'模型未记录')}</b><small>${time} · ${escape(sources[row.source]||row.source)}${row.purpose==='warmup'?' · 预热':row.purpose==='test'?' · 测试':''}${escape(tierSummary)}${row.kind==='aggregate'?' · 汇总 '+row.requestCount+' 次':''}${row.failed?' · 请求失败':''}</small></span><span>${count(row.totalTokens)}<small>Token</small></span><span>${row.averageTPS==null?'—':row.averageTPS.toFixed(1)}<small>${speedLabel}</small></span><span>${seconds(row.durationMs)}<small>${estimated?'输出流时长':'耗时'}</small></span><span>${money(row.cost)}<small>${costLabel}</small></span></summary><dl>${value('输入',count(row.inputTokens))}${value('输出',count(row.outputTokens))}${value('缓存读取',count(row.cachedTokens))}${value('缓存命中率',hit)}${value('缓存写入',count(row.cacheWriteTokens))}${value('推理',count(row.reasoningTokens))}${value('首字',seconds(row.firstTextMs))}${value('首输出',seconds(row.firstOutputMs))}${row.firstByteMs!=null?value('首字节',seconds(row.firstByteMs)):''}${row.afterFirstOutputMs!=null?value('首输出后耗时',seconds(row.afterFirstOutputMs)):''}${value(nativeTier?'会话档位':'响应档位',tierLabel(row.tier))}${value('请求档位',tierLabel(row.requestedTier))}${value('思考强度',row.effort||'未记录')}${value('会话',row.sessionId||'未记录')}${value('速度口径',timingLabel(row))}${row.errorCode?value('错误',row.errorCode):''}</dl></details>`;
}
function render(){
  if(!dialog?.open)return;
  const body=dialog.querySelector('[data-request-list]'),scroll=body.scrollTop;
  const opened=new Set([...body.querySelectorAll('details[open]')].map(node=>node.dataset.id));
  body.innerHTML=data?.rows?.length?data.rows.map(row=>record(row)).join(''):'<p class="empty">当前范围暂无请求记录</p>';
  [...body.querySelectorAll('details')].forEach((node,index)=>{node.dataset.id=data.rows[index].id;node.open=opened.has(node.dataset.id);});
  body.scrollTop=scroll;
  dialog.querySelector('[data-request-page]').textContent=`第 ${cursors.length} 页`;
  dialog.querySelector('[data-requests-prev]').disabled=cursors.length===1;
  dialog.querySelector('[data-requests-next]').disabled=!data?.hasMore;
}
async function load(reset=false){
  if(!dialog?.open)return;
  if(reset){cursors=[''];data=null;dialog.querySelector('[data-request-list]').scrollTop=0;}
  controller?.abort();controller=new AbortController();const ticket=++generation;
  const params=new URLSearchParams(new FormData(dialog.querySelector('form')));params.set('cursor',cursors.at(-1));
  const status=dialog.querySelector('[data-request-status]');status.textContent='正在读取';status.classList.add('analytics-loading-text');
  const error=dialog.querySelector('[data-request-error]');error.textContent='';
  for(const button of dialog.querySelectorAll('[data-requests-prev],[data-requests-next]'))button.disabled=true;
  const token=gateway?localStorage.getItem('cmc.token')||'':document.querySelector('meta[name="local-token"]')?.content;
  try{
    const response=await fetch(apiBase+'usage/requests?'+params,{headers:gateway?{Authorization:'Bearer '+token}:{'X-Local-Token':token},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
    const value=await response.json();if(!response.ok)throw Error(value.error||'请求记录读取失败');
    if(ticket!==generation||!dialog.open)return;data=value;render();
    if(value.refreshing)setTimeout(()=>{if(dialog.open&&ticket===generation)void load();},5000);
  }catch(reason){if(ticket===generation&&dialog.open&&reason.name!=='AbortError')error.textContent=reason.message;}
  finally{if(ticket===generation){status.textContent='';status.classList.remove('analytics-loading-text');dialog.querySelector('[data-requests-prev]').disabled=cursors.length===1;dialog.querySelector('[data-requests-next]').disabled=!data?.hasMore;}}
}
function open(){
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='request-records-dialog';
    dialog.innerHTML=`<div class="request-records-heading"><h2>请求记录</h2><span data-request-status role="status"></span><button type="button" data-requests-close aria-label="关闭">✕</button></div><form class="request-records-filters"><label>时间<select name="range">${option({today:'今天',yesterday:'昨天',week:'本周',month:'本月',year:'今年'})}</select></label><label>来源<select name="source">${option(sources)}</select></label><label>类型<select name="purpose">${option({all:'全部请求',normal:'日常',warmup:'预热',test:'测试'})}</select></label><label>计价<select name="pricing">${option({codex:'Codex 计价',api:'API 参考价'})}</select></label><label class="request-model-filter">模型<input name="model" placeholder="完整模型 ID，留空为全部" autocomplete="off"></label><button type="submit">查询</button></form><p data-request-error role="alert"></p><div data-request-list class="request-records-list"></div><footer><small>速度口径见每条详情；未记录的字段显示 —。</small><div><button type="button" data-requests-prev>上一页</button><span data-request-page></span><button type="button" data-requests-next>下一页</button></div></footer>`;
    dialog.querySelector('[name=range]').value='week';
    dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void load(true);});
    dialog.addEventListener('change',event=>{if(event.target.matches('select'))void load(true);});
    dialog.querySelector('[data-requests-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-requests-prev]').onclick=()=>{cursors.pop();data=null;dialog.querySelector('[data-request-list]').scrollTop=0;void load();};
    dialog.querySelector('[data-requests-next]').onclick=()=>{if(data?.nextCursor){cursors.push(data.nextCursor);data=null;dialog.querySelector('[data-request-list]').scrollTop=0;void load();}};
    dialog.addEventListener('close',()=>{generation++;controller?.abort();});
    document.body.append(dialog);
  }
  dialog.showModal();void load();
}
function mount(){
  const parent=document.querySelector('.analytics-title-actions');if(!parent||parent.querySelector('[data-open-request-records]'))return;
  const button=document.createElement('button');button.type='button';button.dataset.openRequestRecords='';button.textContent='请求记录';button.onclick=open;parent.append(button);
}
new MutationObserver(mount).observe(document.querySelector('#app'),{childList:true,subtree:true});mount();
