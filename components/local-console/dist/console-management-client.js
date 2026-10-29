export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const creditNumber=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value):'—';
export async function api(route,body,signal){
  const base=document.querySelector('meta[name="local-api-base"]')?.content||'/api/';
  const gateway=document.querySelector('meta[name="console-gateway"]')?.content==='true';
  const token=gateway?localStorage.getItem('cmc.token')||'':document.querySelector('meta[name="local-token"]')?.content;
  const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(gateway?{Authorization:'Bearer '+token}:{'X-Local-Token':token}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
  const value=await response.json();if(!response.ok)throw Error(value.error?.message||value.error||'请求失败');return value;
}
