import test from 'node:test';
import assert from 'node:assert/strict';
import {GoalRunClock,groupToolActivity} from '../public/console-core.js';

test('diff-only entry is omitted while the file summary retains its patch',()=>{
 const diff={type:'diff.updated',eventId:'diff',files:['a.kt'],diff:'--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new'};
 for(const status of ['', 'completed','interrupted']){
  const blocks=groupToolActivity([{type:'message.delta',text:'done'},diff,...(status?[{type:'turn.completed',status}]:[])]);
  assert.deepEqual(blocks.map(b=>b.type),['message.delta','files.summary']);
  assert.equal(blocks[1].activities[0].diff,diff.diff);
 }
 const mixed=groupToolActivity([{type:'tool.completed',text:'checked'},diff]);
 assert.equal(mixed[0].type,'activity.group');
 const deferred=groupToolActivity([{...diff,activityGroupId:'a|b'}]);
 assert.equal(deferred[0].type,'activity.group');
});
test('goal timer advances across unchanged snapshots and freezes across pause',()=>{
 const clock=new GoalRunClock();
 assert.equal(clock.sample(10,true,0),10);
 assert.equal(clock.sample(10,true,2500),12);
 assert.equal(clock.sample(11,false,3000),13);
 assert.equal(clock.sample(11,false,30000),13);
 assert.equal(clock.sample(11,true,30000),13);
 assert.equal(clock.sample(11,true,32000),15);
 assert.equal(clock.sample(20,false,33000),20);
 assert.equal(new GoalRunClock().sample(undefined,true,0),null);
});
test('one aggregate file card per turn survives separate activity segments and completion',()=>{
 const files=[{path:'a.kt',added:2,removed:1},{path:'b.kt',added:1,removed:0}];
 const events=[{type:'user.message',text:'fix'},{type:'tool.completed',eventId:'a',fileChanges:files},{type:'message.delta',text:'checking'},{type:'tool.completed',eventId:'b',fileChanges:[...files].reverse()},{type:'message.delta',text:'done'}];
 for(const status of ['', 'completed','interrupted']){
  const blocks=groupToolActivity([...events,...(status?[{type:'turn.completed',status}]:[])]);
  assert.equal(blocks.filter(b=>b.type==='files.summary').length,1);
  assert.equal(blocks.at(-1).activities.length,2);
 }
 assert.equal(groupToolActivity([...events,{type:'turn.completed',status:'completed'},...events]).filter(b=>b.type==='files.summary').length,2);
});
