import assert from 'node:assert/strict';
import test from 'node:test';
import {patchLines,filePatch} from '../public/patch-view.js';

test('file selection uses whole paths and never falls back to sibling files',()=>{
 const detail='*** Begin Patch\n*** Update File: a.kt\n@@\n-old\n+selected\n*** Add File: a.kt.bak\n+sibling\n*** Update File: src/a.kt\n@@\n+other-directory\n*** End Patch';
 const selected=filePatch(detail,'a.kt');assert.ok(selected.includes('+selected'));assert.ok(!selected.includes('+sibling'));assert.ok(!selected.includes('+other-directory'));
 assert.equal(filePatch(detail,'missing.kt'),'');assert.ok(filePatch(detail,'src/a.kt').includes('+other-directory'));
 assert.equal(filePatch('@@\n-old\n+new','a.kt'),'@@\n-old\n+new');
});

test('git file selection reads quoted paths, rename metadata and deletion paths',()=>{
 const detail='diff --git "a/space name.kt" "b/space name.kt"\r\n--- "a/space name.kt"\r\n+++ "b/space name.kt"\r\n@@ -1 +1 @@\r\n-old\r\n+selected\r\ndiff --git a/deleted.kt b/deleted.kt\n--- a/deleted.kt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\ndiff --git a/old.kt b/new.kt\nsimilarity index 100%\nrename from old.kt\nrename to new.kt\n';
 assert.ok(filePatch(detail,'space name.kt').includes('+selected'));assert.ok(!filePatch(detail,'space name.kt').includes('-removed'));
 assert.ok(filePatch(detail,'deleted.kt').includes('-removed'));assert.ok(!filePatch(detail,'deleted.kt').includes('+selected'));
 assert.equal(filePatch(detail,'old.kt'),filePatch(detail,'new.kt'));assert.ok(filePatch(detail,'new.kt').includes('rename to new.kt'));assert.equal(filePatch(detail,'missing.kt'),'');
 const unified='--- a/src/a.kt\told time\n+++ b/src/a.kt\tnew time\n@@ -1 +1 @@\n-old\n+new';
 assert.equal(filePatch(unified,'src\\a.kt'),unified);assert.equal(filePatch(unified,'a.kt'),'');
});
test('patch viewer preserves exact code and original/new line numbers',()=>{
 const rows=patchLines('@@ -36,2 +36,2 @@\n same\n-old\n+new');
 assert.deepEqual(rows.slice(1).map(r=>[r.text,r.oldLine,r.newLine]),[[' same',36,36],['-old',37,null],['+new',null,37]]);
});
test('apply_patch missing line positions remain unknown and file selection excludes siblings',()=>{
 const detail='*** Begin Patch\n*** Update File: a.kt\n@@\n-old\n+new\n*** Add File: b.kt\n+other\n*** End Patch';
 const patch=filePatch(detail,'a.kt');assert.ok(!patch.includes('other'));
 assert.equal(patchLines(patch).find(r=>r.kind==='add').newLine,null);
 assert.equal(patchLines(filePatch(detail,'b.kt')).find(r=>r.kind==='add').newLine,1);
});
