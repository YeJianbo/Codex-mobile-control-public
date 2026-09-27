import test from 'node:test';
import assert from 'node:assert/strict';
import {permittedPublicRequest as allowed} from './public-routes.mjs';

test('public API admits mobile chat, approvals, uploads and workspace files',()=>{
  for(const [method,url] of [
    ['GET','/ws?token=example'],['GET','/api/threads/t/events?count=60'],
    ['POST','/api/threads/t/queue'],['PATCH','/api/threads/t/goal'],
    ['POST','/api/approvals/a/resolve'],['POST','/api/uploads/images'],
    ['PUT','/api/projects/p/file?path=src%2Fmain.kt'],
    ['GET','/raw/projects/p/file?path=README.md'],
  ])assert.equal(allowed(method,url),true,`${method} ${url}`);
});

test('public API excludes the console, terminal, settings and project creation',()=>{
  for(const [method,url] of [
    ['GET','/console'],['GET','/console/assets/console.js'],
    ['POST','/api/projects/p/terminal/run'],['GET','/api/terminal/history'],
    ['POST','/api/projects'],['PUT','/api/config/https'],
    ['PUT','/api/settings/user/raw'],['POST','/api/codex/restart'],
    ['GET','/preview/site/p/index.html'],['GET','/downloads/android.apk'],
    ['POST','/api/projects/p/file'],['DELETE','/api/projects/p/diff/files'],
  ])assert.equal(allowed(method,url),false,`${method} ${url}`);
});
