export function networkError(error){
  const raw=error?.cause?.code||error?.code;
  const code=typeof raw==='string'&&/^[A-Z][A-Z_0-9]{1,60}$/.test(raw)?raw:null;
  if(code==='CLIENT_CLOSED')return {status:499,code,message:'客户端已断开连接'};
  const timeout=code?.includes('TIMEOUT')||['TimeoutError','AbortError'].includes(error?.name);
  if(!timeout&&!code&&!/fetch failed|terminated/i.test(error?.message||''))return null;
  const known=code&&(/^(ECONN|ENET|EHOST|EAI_|ENOTFOUND|UND_ERR_|ERR_TLS_|CERT_|DEPTH_|UNABLE_|UPSTREAM_)/.test(code));
  if(!timeout&&!known&&!/fetch failed|terminated/i.test(error?.message||''))return null;
  const reason=timeout?'连接或响应超时':code==='ENOTFOUND'||code==='EAI_AGAIN'?'域名解析失败':code==='ECONNREFUSED'?'连接被拒绝':code==='ECONNRESET'||code==='UND_ERR_SOCKET'?'连接被关闭':'网络连接失败';
  return {status:timeout?504:502,code:code||'UPSTREAM_NETWORK_ERROR',message:`上游${reason}（${code||'UPSTREAM_NETWORK_ERROR'}），请重试`};
}
