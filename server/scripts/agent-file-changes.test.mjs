import test from 'node:test';
import assert from 'node:assert/strict';
import {editedFilePaths,claudeFileChange,acpFileChanges} from '../src/services/agentFileChanges.ts';
import {summarizeFileChanges} from '../src/services/fileChanges.ts';

test('Only known edit tools supply changed file candidates; reads and shell commands do not',()=>{
 assert.deepEqual(editedFilePaths('write_to_file',{TargetFile:'file.txt'}),['file.txt']);
 assert.deepEqual(editedFilePaths('Edit',{file_path:'file.txt'}),['file.txt']);
 assert.deepEqual(editedFilePaths('Read',{file_path:'file.txt'}),[]);
 assert.deepEqual(editedFilePaths('Bash',{file_path:'file.txt'}),[]);
});
test('Claude confirmed create and edit results preserve real patch lines',()=>{
 const create=claudeFileChange({type:'create',filePath:'file.txt',content:'hello\nworld\n'});
 assert.deepEqual(summarizeFileChanges([{type:'file.changed',...create}]),[{path:'file.txt',added:2,removed:0}]);
 const update=claudeFileChange({filePath:'file.txt',structuredPatch:[{oldStart:8,oldLines:1,newStart:8,newLines:1,lines:['-before','+after']}]});
 assert.match(update.diff,/@@ -8,1 \+8,1 @@/);assert.deepEqual(summarizeFileChanges([{type:'file.changed',...update}]),[{path:'file.txt',added:1,removed:1}]);
 assert.equal(claudeFileChange('Error: rejected'),undefined);
});
test('Grok ACP diff keeps path and source line offsets',()=>{
 const change=acpFileChanges([{type:'diff',path:'file.txt',oldText:'before',newText:'after\nsecond',_meta:{old_line:9,new_line:9}}]);
 assert.match(change.diff,/@@ -9,1 \+9,2 @@/);assert.deepEqual(change.files,['file.txt']);
 assert.deepEqual(summarizeFileChanges([{type:'file.changed',...change}]),[{path:'file.txt',added:2,removed:1}]);
});
