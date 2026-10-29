import {esc,creditNumber as fmt} from './console-management-client.js';
let host,cache=null,cacheRoute='',estimateExpanded=false;
const route=()=>location.hash.split('?')[0];
function quotaPanel(){
  if(route()==='#usage')return document.querySelector('main .quota-panel');
  if(route()==='#statistics')return document.querySelector('.analytics-panel [data-tab="quota"][aria-pressed="true"]')?.closest('.analytics-panel');
  return null;
}
const label=value=>value?.unlimited?'不限额':fmt(value?.balance);
const timeLabel=(time,span)=>new Date(time*1000).toLocaleString('zh-CN',span<3600?{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}:span<86400?{hour:'2-digit',minute:'2-digit',hour12:false}:{month:'numeric',day:'numeric'});
function estimate(value){
  return (value?.windows||[{name:'5h',state:'collecting'},{name:'7d',state:'collecting'}]).map(row=>`<div><span>${esc(row.name)} 订阅折合下限</span><b>${row.state==='estimated'?'≥ '+fmt(row.minimumCredits)+' <small>Credits</small>':'采集中'}</b>${row.requests?`<small>${row.requests} 条请求 · ${fmt(row.observedPercent)}% 额度变化</small>`:''}</div>`).join('');
}
function render(value){
  if(!host?.isConnected)return;
  value??={points:[]};
  const latest=value.latest,credits=latest?.credits,points=value.points.filter(point=>point.credits&&!point.credits.unlimited&&typeof point.credits.balance==='number');
  host.querySelector('[data-credit-summary]').innerHTML=`<div><span>官方 Credits 余额</span><b>${label(credits||points.at(-1)?.credits)}</b><small>${latest?.at?esc(new Date(latest.at).toLocaleString('zh-CN')):points.length?esc(new Date(points.at(-1).timestamp*1000).toLocaleString('zh-CN')):'尚未采集'}</small></div><div><span>区间已观测消耗</span><b>${value.creditUsage?.intervals?fmt(value.creditUsage.consumed):'—'} <small>Credits</small></b><small>${value.creditUsage?.added?'余额增加 '+fmt(value.creditUsage.added)+' Credits':'按余额下降累计'}</small></div>`;
  host.querySelector('[data-credit-estimate]').innerHTML=estimate(latest?.subscriptionEstimate);
  const stage=host.querySelector('.credit-plot');stage.replaceChildren();
  if(!points.length){stage.innerHTML='<p class="cm-muted">所选时间内暂无 Credits 记录。</p>';return;}
  const min=Math.min(...points.map(point=>point.credits.balance)),max=Math.max(...points.map(point=>point.credits.balance)),pad=Math.max(1,(max-min)*.12),low=Math.max(0,min-pad),high=max+pad;
  const timeline=value.points.filter(point=>Number.isFinite(point.timestamp));
  const start=timeline[0].timestamp,end=timeline.at(-1).timestamp,span=Math.max(1,end-start),w=1140,h=315;
  const x=time=>timeline.length===1?580:60+(time-start)/span*1040;
  const y=balance=>250-(balance-low)/(high-low)*210;
  const xy=point=>[x(point.timestamp),y(point.credits.balance)];
  // Break the line at missing or unlimited samples instead of implying a zero balance.
  let drawing='',connected=false;
  for(const point of value.points){if(!point.credits||point.credits.unlimited||typeof point.credits.balance!=='number'){connected=false;continue;}const [x,y]=xy(point);drawing+=(connected?' L':' M')+x.toFixed(2)+' '+y.toFixed(2);connected=true;}
  const ticks=timeline.length===1?[start]:Array.from({length:6},(_,i)=>start+(end-start)*i/5);
  stage.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Credits 余额曲线"><title>Credits 余额，横轴与上方额度曲线一致</title>${[low,(low+high)/2,high].map(balance=>`<line x1="60" x2="1100" y1="${y(balance)}" y2="${y(balance)}" class="chart-grid"/><text x="47" y="${y(balance)+4}" text-anchor="end" class="chart-label">${fmt(balance)}</text>`).join('')}${ticks.map(time=>`<line x1="${x(time)}" x2="${x(time)}" y1="40" y2="250" class="chart-grid vertical"/><text x="${x(time)}" y="292" text-anchor="middle" class="chart-label">${esc(timeLabel(time,end-start))}</text>`).join('')}<path class="credit-line" d="${drawing}"/>${points.length===1?`<circle class="credit-dot" cx="${xy(points[0])[0]}" cy="${xy(points[0])[1]}" r="4"/>`:''}<line class="credit-crosshair" data-credit-cursor y1="40" y2="250" hidden/><circle class="credit-dot credit-selected" r="4" hidden/></svg><output hidden class="credit-tooltip"></output>`;
  const svg=stage.querySelector('svg'),tip=stage.querySelector('output'),line=stage.querySelector('[data-credit-cursor]'),dot=stage.querySelector('.credit-selected');
  const hide=()=>{tip.hidden=line.hidden=dot.hidden=true;line.style.display=dot.style.display='none';};
  const show=event=>{
    const bounds=svg.getBoundingClientRect(),relative=Math.max(0,Math.min(w,(event.clientX-bounds.left)/bounds.width*w)),at=start+(relative-60)/1040*span;
    let l=0,r=points.length-1;while(l<r){const mid=(l+r)>>1;if(points[mid].timestamp<at)l=mid+1;else r=mid;}const point=l>0&&at-points[l-1].timestamp<points[l].timestamp-at?points[l-1]:points[l];
    const [x,y]=xy(point);line.setAttribute('x1',x);line.setAttribute('x2',x);dot.setAttribute('cx',x);dot.setAttribute('cy',y);tip.textContent=new Date(point.timestamp*1000).toLocaleString('zh-CN')+' · '+fmt(point.credits.balance)+' Credits';
    tip.hidden=line.hidden=dot.hidden=false;line.style.display=dot.style.display='';tip.style.left=Math.min(Math.max(0,(event.clientX-bounds.left)-120),Math.max(0,bounds.width-240))+'px';
  };
  let touching=false;svg.onpointerdown=event=>{touching=true;svg.setPointerCapture(event.pointerId);show(event);};svg.onpointermove=event=>{if(event.pointerType==='mouse'||touching)show(event);};
  svg.onpointerup=svg.onpointercancel=svg.onlostpointercapture=()=>{touching=false;hide();};svg.onpointerleave=()=>{if(!touching)hide();};hide();
}
function mount(){
  const anchor=quotaPanel();
  if(!anchor){host?.remove();host=null;return false;}
  if(host?.isConnected){if(host.previousElementSibling!==anchor)anchor.after(host);return false;}
  host=document.createElement('section');host.className='panel credit-history';host.dataset.creditHistory='';
  host.innerHTML=`<header class="cm-heading"><h2>Credits</h2></header><div class="credit-metrics" data-credit-summary></div><div class="credit-plot"></div><details class="credit-estimates"><summary>订阅额度折合 Credits · 估算</summary><div class="credit-metrics" data-credit-estimate></div><p class="cm-muted">仅按可归属的官方请求和同一周期的额度变化计算下限。Fast 和 Ultrafast 使用订阅倍率；账号切换、充值和重置不参与校准。</p><a href="https://learn.chatgpt.com/docs/pricing" target="_blank" rel="noopener">官方 Credits 计价</a></details>`;
  const details=host.querySelector('.credit-estimates');details.open=estimateExpanded;details.ontoggle=()=>estimateExpanded=details.open;
  anchor.after(host);render(cacheRoute===route()?cache:null);return true;
}
document.addEventListener('console:quota-history',event=>{cache=event.detail;cacheRoute=route();if(!mount())render(cache);});
new MutationObserver(mount).observe(document.querySelector('#app'),{childList:true,subtree:true});
addEventListener('hashchange',()=>queueMicrotask(mount));
mount();
