export function isPublicAndroidDownload(method,rawUrl){
  return (method==='GET'||method==='HEAD')&&['/downloads/android.apk','/downloads/android.json'].includes(new URL(rawUrl||'/', 'http://localhost').pathname);
}

export function permittedPublicRequest(method,rawUrl) {
  const pathname=new URL(rawUrl||'/', 'http://localhost').pathname;
  if(pathname==='/downloads/android.apk'||pathname==='/downloads/android.json')return isPublicAndroidDownload(method,pathname);
  if(/^\/api\/console-management\/[a-zA-Z0-9/_-]+$/.test(pathname))return method==='GET'||method==='POST';
  if(pathname==='/ws')return method==='GET';
  if(pathname==='/health')return method==='GET';
  if(pathname==='/api/diagnostics/performance')return method==='GET';
  if(pathname==='/api/browser/tabs')return method==='GET';
  if(pathname==='/api/browser/connection')return method==='PUT';
  if(/^\/api\/browser\/[^/]+\/screenshot$/.test(pathname))return method==='GET';
  if(/^\/api\/browser\/[^/]+\/action$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/(fork|side\/close|background-terminals\/terminate|review)$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/background-terminals$/.test(pathname))return method==='GET';
  if(pathname==='/api/settings/fast')return method==='GET';
  if(pathname==='/api/settings/capacity-retry'||pathname==='/api/settings/remote-approval'||pathname==='/api/settings/harness-access')return method==='GET'||method==='PUT';
  if(pathname==='/api/network/openai')return method==='GET';
  if(pathname==='/api/network/openai/node')return method==='PUT';
  if(pathname==='/api/network/openai/test')return method==='POST';
  if(pathname==='/api/network/google')return method==='GET';
  if(pathname==='/api/network/google/node')return method==='PUT';
  if(pathname==='/api/network/google/test')return method==='POST';
  if(pathname==='/api/agent-instructions')return method==='GET'||method==='PUT';
  if(/^\/api\/threads\/[^/]+\/fast$/.test(pathname))return method==='GET'||method==='PUT';
  if(/^\/raw\/projects\/[^/]+\/file$/.test(pathname))return method==='GET'||method==='HEAD';
  if(['/api/sidebar','/api/sidebar/pins','/api/projects','/api/threads','/api/threads/search','/api/models','/api/usage','/api/approvals','/api/codex/status','/api/codex/compatibility','/api/settings/approval-summary'].includes(pathname))return method==='GET';
  if(pathname==='/api/cloud-snapshots')return method==='GET';
  if(pathname==='/api/automations')return method==='GET'||method==='POST';
  if(pathname==='/api/automations/targets')return method==='GET';
  if(/^\/api\/automations\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(pathname))return method==='PATCH';
  if(/^\/api\/cloud\/avatar\/[a-zA-Z0-9-]{1,160}$/.test(pathname))return method==='GET';
  if(pathname==='/api/cloud-snapshots/import')return method==='POST';
  if(pathname==='/api/local-tasks')return method==='POST'||method==='GET';
  if(/^\/api\/local-tasks\/[^/]+$/.test(pathname))return method==='GET';
  if(pathname==='/api/pair/claim')return method==='POST';
  if(['/api/local-console/state','/api/local-console/statistics'].includes(pathname))return method==='GET';
  if(pathname==='/api/local-console/actions')return method==='POST';
  if(pathname==='/api/agents/health'||pathname==='/api/agents/updates')return method==='GET';
  if(['/api/mobile-management/statistics/tokens','/api/mobile-management/statistics/activity','/api/mobile-management/statistics/speed','/api/mobile-management/statistics/quota','/api/mobile-management/statistics/accounts','/api/mobile-management/sessions','/api/mobile-management/channels'].includes(pathname))return method==='GET';
  if(['/api/mobile-management/statistics/index','/api/mobile-management/statistics/quota/auto','/api/mobile-management/statistics/quota/refresh','/api/mobile-management/sessions/delete-preview','/api/mobile-management/sessions/change','/api/mobile-management/channels/accounts'].includes(pathname))return method==='POST';
  if(/^\/api\/mobile-management\/channels\/accounts\/[^/]+\/(settings|credentials|login|connect|disconnect|remove)$/.test(pathname))return method==='POST';
  if(['/api/mobile-management/assistant/catalog','/api/mobile-management/assistant/projects'].includes(pathname))return method==='GET';
  if(pathname==='/api/mobile-management/assistant/tasks')return method==='GET'||method==='POST';
  if(/^\/api\/mobile-management\/assistant\/tasks\/[A-Za-z0-9_-]{8,100}$/.test(pathname))return method==='GET';
  if(/^\/api\/mobile-management\/assistant\/tasks\/[A-Za-z0-9_-]{8,100}\/(continue|stop|approve)$/.test(pathname))return method==='POST';
  if(['/api/mobile-management/maintenance','/api/mobile-management/maintenance/report','/api/mobile-management/extensions','/api/mobile-management/harnesses'].includes(pathname))return method==='GET';
  if(pathname==='/api/mobile-management/opencode')return method==='GET';
  if(/^\/api\/mobile-management\/opencode\/(provider-preview|provider-apply|model-preview|model-apply)$/.test(pathname))return method==='POST';
  if(['/api/mobile-management/maintenance/diagnose','/api/mobile-management/maintenance/repair-preview','/api/mobile-management/maintenance/repair','/api/mobile-management/maintenance/backup','/api/mobile-management/maintenance/restore-preview','/api/mobile-management/maintenance/restore','/api/mobile-management/maintenance/cleanup-preview','/api/mobile-management/maintenance/cleanup','/api/mobile-management/maintenance/process-preview','/api/mobile-management/maintenance/process-apply','/api/mobile-management/maintenance/send-preview','/api/mobile-management/maintenance/send','/api/mobile-management/maintenance/gateway/start','/api/mobile-management/maintenance/gateway/autostart','/api/mobile-management/maintenance/backend/restart-preview','/api/mobile-management/maintenance/backend/restart','/api/mobile-management/extensions/mcp','/api/mobile-management/harnesses/switch-preview','/api/mobile-management/harnesses/switch'].includes(pathname))return method==='POST';
  const accountRoute=/^\/api\/local-console\/accounts\/(codex|agy|claude|claude-profile|deepseek|hermes|codex-relay)(?:\/([a-z-]+))?$/.exec(pathname);
  if(accountRoute){
    if(!accountRoute[2])return method==='GET';
    const actions={codex:['switch-preview','switch'],agy:['import','switch-preview','switch','history','refresh'],claude:['switch-preview','switch','import-current','import','refresh','select','save-profile','import-cc-switch'],'claude-profile':['read','delete','switch-preview','switch','save'],deepseek:['save','models','test'],hermes:['save','models','test','oauth-status','oauth-start','oauth-cancel'],'codex-relay':['save-provider','discover-models','model','delete-provider','toggle-model','model-settings','routing-preview','takeover','direct','routing-http','profile','import-providers','model-order','refresh-catalog','rebuild-catalog','test-model','compatibility']};
    return method==='POST'&&actions[accountRoute[1]].includes(accountRoute[2]);
  }
  if(['/api/threads/archived','/api/thread-sections'].includes(pathname))return method==='GET';
  if(/^\/api\/threads\/[^/]+\/close-preview$/.test(pathname))return method==='GET';
  if(/^\/api\/threads\/[^/]+\/close$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/(archive|unarchive|unread|read|move)$/.test(pathname))return method==='POST';
  if(['/api/local-console/backend/restart-preview','/api/local-console/backend/restart'].includes(pathname))return method==='POST';
  if(pathname==='/api/codex/start')return method==='POST';
  if(['/api/uploads/images','/api/uploads/files'].includes(pathname))return method==='POST';
  if(/^\/api\/uploads\/(images|files)\/[^/]+$/.test(pathname))return method==='GET';
  if(/^\/api\/threads\/[^/]+$/.test(pathname))return method==='PATCH';
  if(/^\/api\/threads\/[^/]+\/(events|history-image|activity|submission|queue)$/.test(pathname))return method==='GET'||(pathname.endsWith('/queue')&&method==='POST');
  if(/^\/api\/threads\/[^/]+\/output-file\/[^/]+\.(png|jpe?g|webp|gif)$/i.test(pathname))return method==='GET';
  if(/^\/api\/threads\/[^/]+\/queue\/[^/]+$/.test(pathname))return method==='PATCH'||method==='DELETE';
  if(/^\/api\/threads\/[^/]+\/queue\/[^/]+\/(steer|retry|move|restore|restore\/complete)$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/(resume|pin|compact)$/.test(pathname))return method==='POST';
  if(/^\/api\/threads\/[^/]+\/goal$/.test(pathname))return method==='PATCH';
  if(/^\/api\/threads\/[^/]+\/goal\/continue$/.test(pathname))return method==='POST';
  if(/^\/api\/approvals\/[^/]+\/(answer|resolve)$/.test(pathname))return method==='POST';
  if(/^\/api\/projects\/[^/]+\/(files|file|diff|diff\/files|diff\/file|diff\/file\/hunks)$/.test(pathname))return method==='GET'||(pathname.endsWith('/file')&&method==='PUT');
  if(/^\/api\/projects\/[^/]+\/diff\/(file\/(accept|revert)|file\/hunk\/(accept|revert)|files\/(accept|revert))$/.test(pathname))return method==='POST';
  return false;
}
