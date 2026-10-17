import test from 'node:test';
import assert from 'node:assert/strict';
import {GoalCompletionTracker} from '../dist/services/codexGoals.js';
import {summarizeFileChanges,confirmedToolChanges} from '../dist/services/fileChanges.js';
import {historyToolPresentation} from '../dist/services/codexSessions.js';
import {MobileActivityHistory} from '../dist/services/mobileActivityHistory.js';
import {CodexAppServerClient} from '../dist/codex/appServerClient.js';
import {FollowupQueue} from '../dist/services/followupQueue.js';
test('remote start reports connection failure without launching the desktop',async()=>{
 let starts=0,launches=0;
 const client={start:async()=>{starts++;throw Error('offline')},launchDesktop:()=>{launches++}};
 await assert.rejects(CodexAppServerClient.prototype.startFromUser.call(client),/offline/);
 await CodexAppServerClient.prototype.startFromUser.call({...client,start:async()=>{starts++}});
 assert.equal(starts,2);assert.equal(launches,0);
});
test('queued user message dispatches once after running turn completes',async()=>{
 let status='running',sent=0;
 const queue=new FollowupQueue({readFollowups:()=>[],writeFollowup:()=>{},writeFollowupOrder:()=>{}},{canSteer:()=>false},async()=>status,async()=>{sent++;status='running'});
 try{queue.add({id:'q',threadId:'t',text:'retain',images:[],files:[]});await queue.tick();assert.equal(sent,0);status='completed';await queue.tick();await queue.tick();assert.equal(sent,1);assert.equal(queue.list('t').length,0);}finally{queue.close();}
});

test('goal completion only reports a transition of the same goal once',()=>{
 const tracker=new GoalCompletionTracker(),snapshot=status=>new Map([['t',{goalId:'g',status,objective:'test',timeUsedSeconds:62}]]);
 assert.deepEqual(tracker.accept(snapshot('complete')),[]);
 tracker.accept(snapshot('active'));assert.deepEqual(tracker.accept(null),[]);
 assert.equal(tracker.accept(snapshot('complete')).length,1);
 assert.deepEqual(tracker.accept(snapshot('complete')),[]);
 tracker.accept(snapshot('active'));assert.deepEqual(tracker.accept(new Map([['t',{goalId:'new',status:'complete'}]])),[]);
});
const event={type:'file.changed',threadId:'t',eventId:'e',files:['a.ts'],diff:'--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+line'};
test('actual raw apply_patch and exec wrappers reach the compact file card only after success',()=>{
 const patch='*** Begin Patch\n*** Add File: added.ts\n+first\n+second\n*** End Patch';
 for(const [name,input]of [['apply_patch',patch],['functions.exec',`text(await tools.apply_patch(${JSON.stringify(patch)}));`],['functions.exec',JSON.stringify({code:`await tools.apply_patch(${JSON.stringify(patch)})`})]]){
  const start={type:'tool.started',threadId:'t',eventId:'start',itemId:'call',...historyToolPresentation(name,input)};
  assert.equal(start.detail,patch);
  assert.deepEqual(summarizeFileChanges(confirmedToolChanges([start])),[]);
  const failed=confirmedToolChanges([start,{type:'tool.completed',itemId:'call',status:'ok',detail:'Script error: apply_patch verification failed'}]);
  assert.deepEqual(summarizeFileChanges(failed),[]);
  const success=confirmedToolChanges([start,{type:'tool.completed',threadId:'t',eventId:'end',itemId:'call',status:'ok',detail:'Success'}]);
  const compact=new MobileActivityHistory().compact(success);
  assert.deepEqual(compact[0].fileChanges,[{path:'added.ts',added:2,removed:0}]);
 }
});
test('file summaries do not double count repeated diff snapshots',()=>{
 assert.deepEqual(summarizeFileChanges([event,event]),[{path:'a.ts',added:2,removed:1}]);
 assert.deepEqual(summarizeFileChanges([{type:'file.changed',files:['unknown']}]),[{path:'unknown'}]);
});

test('file summaries retain paths and counts for LF, Windows, CR and mixed patch lines',()=>{
 const lines=['--- a/a.ts','+++ b/a.ts','@@ -1 +1,2 @@','-old','+new','+const label = "*** Add File: fake.ts";',
  '*** Add File: added.ts','+first','+second','*** Delete File: gone.ts','+++ /dev/null'];
 const expected=[{path:'a.ts',added:2,removed:1},{path:'added.ts',added:2,removed:0},{path:'gone.ts',added:undefined,removed:undefined}];
 for(const ending of ['\n','\r\n','\r','mixed']){
  const diff=lines.map((line,index)=>line+(ending==='mixed'?['\r\n','\n','\r'][index%3]:ending)).join('');
  const change={...event,diff};
  assert.deepEqual(summarizeFileChanges([change,change]),expected,JSON.stringify(ending));
  assert.deepEqual(new MobileActivityHistory().compact([change])[0].fileChanges,expected);
 }
 const patch='*** Begin Patch\r\n*** Add File: created.ts\r\n+one\r\n+two\r\n*** End Patch\r\n';
 assert.deepEqual(summarizeFileChanges(confirmedToolChanges([
  {type:'tool.started',itemId:'edit',detail:patch},
  {type:'tool.completed',itemId:'edit',status:'ok',detail:'Success'},
 ])),[{path:'created.ts',added:2,removed:0}]);
});
test('compacted activity retains file statistics without sending diff bodies',()=>{
 const history=new MobileActivityHistory(),compact=history.compact([event]);
 assert.equal(compact[0].diff,undefined);assert.equal(compact[0].fileChanges[0].added,2);
 assert.equal(history.group('t','e|e')[0].fileChanges[0].removed,1);
});
