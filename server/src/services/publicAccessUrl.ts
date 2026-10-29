// A single URL-safe segment keeps the public base unambiguous for HTTP,
// WebSocket and device signatures. Existing domain-only addresses remain valid.
export function normalizePublicAccessUrl(value:string):string {
  const url=new URL(value);
  const raw=value.match(/^https:\/\/[^/?#]+(\/[^?#]*)?$/);
  if(!raw||url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
    throw new Error('公网地址需要 HTTPS，不能包含账号、查询参数或片段');
  const suffix=raw[1]||'';
  if(suffix!==''&&suffix!=='/'&&!/^\/[A-Za-z0-9_-]{22,128}\/?$/.test(suffix))
    throw new Error('秘密路径需要 22 至 128 个字母、数字、下划线或短横线');
  return url.origin+suffix.replace(/\/$/,'');
}

export function publicAccessRequestTarget(rawUrl:string,publicUrl=''):string|null {
  // Do not normalize before checking the prefix: URL parsing can erase ../.
  if(!rawUrl.startsWith('/')||rawUrl.startsWith('//')||rawUrl.includes('#'))return null;
  const pathname=rawUrl.split('?')[0]!;
  if(pathname.includes('\\')||/%(?:2e|2f|5c)/i.test(pathname)||pathname.split('/').some(part=>part==='.'||part==='..'))return null;
  const prefix=publicUrl?new URL(normalizePublicAccessUrl(publicUrl)).pathname.replace(/\/$/,''):'';
  if(!prefix)return rawUrl;
  return rawUrl.startsWith(prefix+'/')?rawUrl.slice(prefix.length):null;
}
