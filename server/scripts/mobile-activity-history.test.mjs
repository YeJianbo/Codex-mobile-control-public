import test from 'node:test';
import assert from 'node:assert/strict';
import {MobileActivityHistory} from '../src/services/mobileActivityHistory.ts';

test('closed process ships one summary; its operation list still omits command bodies',()=>{
 const history=new MobileActivityHistory();
 const rows=[{type:'user.message',threadId:'t',text:'question',eventId:'u'},
  {type:'tool.started',threadId:'t',itemId:'cmd',title:'运行命令',detail:'sensitive command body',eventId:'a'},
  {type:'tool.completed',threadId:'t',itemId:'cmd',status:'ok',detail:'long command output',eventId:'b'},
  {type:'message.delta',threadId:'t',text:'answer',eventId:'m'},{type:'turn.completed',threadId:'t',status:'completed',eventId:'done'}];
 const result=history.compact(rows);
 assert.equal(result.length,4);assert.equal(result[1].activityCount,1);
 assert.equal(result[1].activityGroupId,'a|b');
 assert(!JSON.stringify(result).includes('sensitive command'));assert(!JSON.stringify(result).includes('long command output'));
 const operations=history.group('t','a|b');assert.equal(operations.length,2);
 assert.equal(operations[0].title,'运行命令');assert.equal(operations[0].detailsDeferred,true);
 assert(!JSON.stringify(operations).includes('long command output'));
 assert.equal(history.group('another-thread','a|b'),undefined);
 assert.equal(history.compact(rows)[1].eventId,result[1].eventId);
});

test('each patch is scanned once while group metadata preserves replacement counts',()=>{
 const history=new MobileActivityHistory();let reads=0;
 const initial='+++ b/a.ts\n@@ -1 +1 @@\n-old\n'+'+new\n'.repeat(1000);
 const final='+++ b/a.ts\n@@ -1 +1 @@\n-old\n+one\n+two\n';
 const result=history.compact([
  {type:'diff.updated',threadId:'t',eventId:'first',itemId:'edit',get diff(){reads++;return initial;}},
  {type:'file.changed',threadId:'t',eventId:'second',itemId:'edit',files:['a.ts'],get diff(){reads++;return final;}},
  {type:'tool.completed',threadId:'t',eventId:'last',itemId:'other',status:'error',fileChanges:[{path:'b.ts',added:3,removed:0},{path:'a.ts',removed:9}]},
 ]);
 assert.equal(reads,2,'one scan per raw patch, not another scan for every summary layer');
 assert.deepEqual(result[0].fileChanges,[{path:'a.ts',added:2,removed:9},{path:'b.ts',added:3,removed:0}]);
 assert.equal(result[0].status,'error');assert.equal(result[0].activityCount,2);
 const group=history.group('t','first|last');assert.equal(group.length,3);
 assert(group.every(event=>event.detailsDeferred&&!event.diff));assert.equal(reads,2);
});
