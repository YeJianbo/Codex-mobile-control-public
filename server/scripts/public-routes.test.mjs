import test from 'node:test';
import assert from 'node:assert/strict';
import {permittedPublicRequest as allowed,isPublicAndroidDownload} from './public-routes.mjs';

test('the signed Android package is downloadable while API access still needs authentication',()=>{
  for(const method of ['GET','HEAD']){
    assert.equal(allowed(method,'/downloads/android.apk'),true);
    assert.equal(isPublicAndroidDownload(method,'/downloads/android.apk?v=0.6.382'),true);
  }
  for(const [method,url] of [['POST','/downloads/android.apk'],['DELETE','/downloads/android.apk'],['GET','/downloads/other.apk'],['GET','/api/threads'],['GET','/health'],['GET','/console']]){
    assert.equal(isPublicAndroidDownload(method,url),false,`${method} ${url}`);
  }
});

test('public API admits mobile chat, approvals, uploads and workspace files',()=>{
  for(const [method,url] of [
    ['GET','/ws?token=example'],['GET','/api/threads/t/events?count=60'],
    ['GET','/api/threads/t/events?turns=10'],['GET','/api/threads/t/activity?groupId=example'],['GET','/api/threads/t/submission?requestId=example'],
    ['GET','/api/threads/search?q=example'],['GET','/api/sidebar/pins'],
    ['POST','/api/codex/start'],
    ['GET','/api/agents/health?refresh=1'],['POST','/api/local-console/backend/restart-preview'],['POST','/api/local-console/backend/restart'],
    ['GET','/api/network/openai'],['PUT','/api/network/openai/node'],['POST','/api/network/openai/test'],
    ['POST','/api/threads/t/queue'],['POST','/api/threads/t/queue/q/move'],['POST','/api/threads/t/queue/q/restore'],['POST','/api/threads/t/queue/q/restore/complete'],['POST','/api/threads/t/compact'],['PATCH','/api/threads/t/goal'],['POST','/api/threads/t/goal/continue'],
    ['POST','/api/approvals/a/resolve'],['POST','/api/uploads/images'],
    ['PUT','/api/projects/p/file?path=src%2Fmain.kt'],
    ['GET','/raw/projects/p/file?path=README.md'],
  ])assert.equal(allowed(method,url),true,`${method} ${url}`);
});

test('public API excludes the console, terminal, settings and project creation',()=>{
  for(const [method,url] of [
    ['GET','/console'],['GET','/console/assets/console.js'],['GET','/api/threads/t/goal/continue'],['PATCH','/api/threads/t/goal/continue'],
    ['POST','/api/network/openai'],['GET','/api/network/openai/node'],['PUT','/api/network/openai/test'],['PUT','/api/network/other/node'],
    ['POST','/api/threads/search'],['PATCH','/api/threads/search'],['POST','/api/sidebar/pins'],['GET','/api/threads/t/queue/q/restore'],['DELETE','/api/threads/t/queue/q/restore/complete'],['POST','/api/threads/t/queue/q/restore/delete'],
    ['POST','/api/projects/p/terminal/run'],['GET','/api/terminal/history'],
    ['POST','/api/projects'],['PUT','/api/config/https'],
    ['PUT','/api/settings/user/raw'],['POST','/api/codex/restart'],
    ['POST','/api/agents/health'],['GET','/api/local-console/backend/restart'],['PUT','/api/local-console/backend/restart-preview'],
    ['GET','/preview/site/p/index.html'],['GET','/downloads/other.apk'],
    ['POST','/api/projects/p/file'],['DELETE','/api/projects/p/diff/files'],
  ])assert.equal(allowed(method,url),false,`${method} ${url}`);
});

test('public API admits only the typed mobile console endpoints',()=>{
  for(const url of ['/api/local-console/state','/api/local-console/statistics?source=codex&range=week']){
    assert.equal(allowed('GET',url),true);assert.equal(allowed('POST',url),false);
  }
  assert.equal(allowed('POST','/api/local-console/actions'),true);
  assert.equal(allowed('GET','/api/local-console/actions'),false);
  for(const url of ['/api/state','/api/catalog/refresh','/api/providers/save','/api/local-console/proxy','/api/local-console/accounts'])assert.equal(allowed('POST',url),false);
});

test('mobile management permits explicit operation routes with their declared methods',()=>{
  for(const path of ['maintenance','maintenance/report','extensions','harnesses','opencode','sessions','channels','statistics/tokens','statistics/activity','statistics/speed','statistics/quota','statistics/accounts','assistant/catalog','assistant/projects','assistant/tasks','assistant/tasks/task-0001'])assert.equal(allowed('GET','/api/mobile-management/'+path),true,path);
  for(const path of ['maintenance/diagnose','maintenance/repair-preview','maintenance/repair','maintenance/backup','maintenance/restore-preview','maintenance/restore','maintenance/cleanup-preview','maintenance/cleanup','maintenance/process-preview','maintenance/process-apply','maintenance/send-preview','maintenance/send','maintenance/gateway/start','maintenance/gateway/autostart','maintenance/backend/restart-preview','maintenance/backend/restart','extensions/mcp','harnesses/switch-preview','harnesses/switch','sessions/delete-preview','sessions/change','channels/accounts','channels/accounts/saved/settings','channels/accounts/saved/credentials','channels/accounts/saved/login','channels/accounts/saved/connect','channels/accounts/saved/disconnect','channels/accounts/saved/remove','statistics/index','statistics/quota/auto','statistics/quota/refresh','assistant/tasks','assistant/tasks/task-0001/continue','assistant/tasks/task-0001/stop','assistant/tasks/task-0001/approve'])assert.equal(allowed('POST','/api/mobile-management/'+path),true,path);
  for(const path of ['opencode/provider-preview','opencode/provider-apply','opencode/model-preview','opencode/model-apply'])assert.equal(allowed('POST','/api/mobile-management/'+path),true,path);
  for(const [method,path] of [['GET','maintenance/repair'],['GET','opencode/provider-apply'],['PUT','opencode/model-apply'],['POST','opencode/proxy'],['GET','channels/accounts/saved/credentials'],['DELETE','channels/accounts/saved/remove'],['GET','assistant/tasks/task-1/stop'],['POST','statistics/tokens'],['POST','proxy'],['POST','maintenance/shell'],['POST','channels/accounts/saved/shell'],['POST','assistant/tasks/task-1/delete']])assert.equal(allowed(method,'/api/mobile-management/'+path),false,path);
});
