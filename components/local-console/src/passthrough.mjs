const hopHeaders=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length','content-encoding','set-cookie']);
export function officialRequestHeaders(incoming={}){
  const headers=new Headers();
  const named=new Set(['accept','content-type','user-agent','originator','version','session-id','conversation-id','thread-id','openai-beta','chatgpt-account-id','x-request-id','x-client-request-id']);
  const connection=String(incoming.connection||'').toLowerCase().split(',').map(v=>v.trim());
  for(const [key,value] of Object.entries(incoming)){const name=key.toLowerCase();if(hopHeaders.has(name)||connection.includes(name))continue;if(named.has(name)||name.startsWith('x-codex-'))headers.set(name,Array.isArray(value)?value.join(', '):String(value));}
  return headers;
}
export function upstreamResponseHeaders(incoming){
  const blocked=new Set([...hopHeaders,...(incoming.get('connection')||'').toLowerCase().split(',').map(v=>v.trim())]);
  const headers={};for(const [key,value] of incoming)if(!blocked.has(key.toLowerCase()))headers[key]=value;
  // fetch decompresses upstream bodies, so encoding and length must not be copied.
  headers['cache-control']='no-store';headers['x-content-type-options']='nosniff';return headers;
}
