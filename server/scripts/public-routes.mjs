export function permittedPublicRequest(method,rawUrl) {
  const pathname=new URL(rawUrl||'/', 'http://localhost').pathname;
  if(pathname==='/ws')return method==='GET';
  if(pathname==='/health')return method==='GET';
  if(/^\/raw\/projects\/[^/]+\/file$/.test(pathname))return method==='GET'||method==='HEAD';
  if(['/api/sidebar','/api/projects','/api/threads','/api/models','/api/usage','/api/approvals','/api/codex/status','/api/codex/compatibility','/api/settings/approval-summary'].includes(pathname))return method==='GET';
  if(pathname==='/api/pair/claim')return method==='POST';
  if(['/api/uploads/images','/api/uploads/files'].includes(pathname))return method==='POST';
  if(/^\/api\/uploads\/(images|files)\/[^/]+$/.test(pathname))return method==='GET';
  if(/^\/api\/threads\/[^/]+$/.test(pathname))return method==='PATCH';
  if(/^\/api\/threads\/[^/]+\/(events|history-image|queue)$/.test(pathname))return method==='GET'||(pathname.endsWith('/queue')&&method==='POST');
  if(/^\/api\/threads\/[^/]+\/queue\/[^/]+$/.test(pathname))return method==='PATCH'||method==='DELETE';
  if(/^\/api\/threads\/[^/]+\/queue\/[^/]+\/(steer|retry)$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/(resume|pin)$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/goal$/.test(pathname))return method==='PATCH';
  if(/^\/api\/approvals\/[^/]+\/(answer|resolve)$/.test(pathname))return method==='POST';
  if(/^\/api\/projects\/[^/]+\/(files|file|diff|diff\/files|diff\/file|diff\/file\/hunks)$/.test(pathname))return method==='GET'||(pathname.endsWith('/file')&&method==='PUT');
  if(/^\/api\/projects\/[^/]+\/diff\/(file\/(accept|revert)|file\/hunk\/(accept|revert)|files\/(accept|revert))$/.test(pathname))return method==='POST';
  return false;
}
