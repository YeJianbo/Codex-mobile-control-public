export function modelListEndpoint(base){
  let url;try{url=new URL(base);}catch{throw new Error('请输入完整中转 URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('中转 URL 无效');
  if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('远程中转必须使用 HTTPS');
  let pathname=url.pathname.replace(/\/$/,'');if(!pathname.endsWith('/v1'))pathname+='/v1';url.pathname=pathname+'/models';return url.href;
}
export async function discoverProviderModels(store,{id,baseUrl,apiKey}={},fetchImpl=fetch){
  const saved=store.data.providers.find(p=>p.id===id),target=modelListEndpoint(baseUrl||saved?.baseUrl||'');
  const typedKey=String(apiKey||'').trim();
  if(saved&&!typedKey&&target!==modelListEndpoint(saved.baseUrl))throw new Error('中转地址已改变，请填写新地址的 API 密钥后再拉取模型');
  const credential=typedKey||(saved?await store.key(saved.id):'');
  if(!credential)throw new Error('请先填写中转 API 密钥');
  const response=await fetchImpl(target,{method:'GET',headers:{authorization:'Bearer '+credential,accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw new Error(`模型列表请求失败：HTTP ${response.status}`);
  const reader=response.body?.getReader();if(!reader)throw new Error('中转未返回模型列表');
  const chunks=[];let bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024)throw new Error('模型列表超过 2 MB');chunks.push(value);}}finally{reader.releaseLock();}
  let payload;try{payload=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map(x=>Buffer.from(x)))));}catch{throw new Error('中转返回的模型列表不是 JSON');}
  const entries=Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:null;
  if(!entries)throw new Error('中转未返回标准模型列表');
  const ids=[...new Set(entries.map(item=>typeof item==='string'?item:item?.id||item?.model).filter(x=>typeof x==='string'&&x.length<=200&&!x.includes('::')&&x.trim()===x))].slice(0,500);
  return {models:ids,total:entries.length,truncated:entries.length>500};
}
