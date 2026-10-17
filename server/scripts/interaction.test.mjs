import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupToolActivity,activityEntries,activitySummary,cleanActivityLabel,compactError} from '../public/console-core.js';
import {reconnectEvents} from '../public/console-core.js';

test('one compaction keeps its identity across history IDs and distinct compactions remain visible',()=>{
 const original={type:'context.compaction',threadId:'t',eventId:'history:old',itemId:'history:1',createdAt:'2026-10-11T10:31:53.995Z',status:'ok'};
 const refreshed={...original,eventId:'history:new',itemId:'history:2'};
 const tool={type:'tool.completed',threadId:'t',eventId:'tool'};
 const later={...original,eventId:'history:later',itemId:'history:3',createdAt:'2026-10-11T10:32:00Z'};
 const events=reconnectEvents([original,tool,refreshed,later]);
 assert.equal(events.filter(e=>e.type==='context.compaction').length,2);
 assert.equal(events[0].eventId,'history:old');
 assert.equal(groupToolActivity(events,{running:true}).filter(e=>e.type==='context.compaction').length,2);
 assert.equal(reconnectEvents([{...original,eventId:'live:one',itemId:'one'},refreshed,{...original,eventId:'live:two',itemId:'two'}]).filter(e=>e.type==='context.compaction').length,2);
});

test('commentary separates process segments and compaction stays visible with latest status',()=>{
  const result=groupToolActivity([{type:'tool.started',itemId:'a'},{type:'message.delta',text:'下一步'},
    {type:'tool.started',itemId:'b'},{type:'context.compaction',itemId:'c',status:'running'},
    {type:'context.compaction',itemId:'c',status:'ok'}],{running:true});
  assert.deepEqual(result.map(e=>e.type),['activity.group','message.delta','activity.group','context.compaction']);
  assert.equal(result.at(-1).status,'ok');
});

test('execution groups retain outputs and do not cross approvals or turns',()=>{
  const events=[{type:'tool.started',itemId:'a',turnId:'1'},{type:'tool.output',itemId:'a',turnId:'1',text:'output'},
    {type:'tool.completed',itemId:'a',turnId:'1'},{type:'approval.requested'},
    {type:'tool.started',itemId:'b',turnId:'1'},{type:'tool.started',itemId:'c',turnId:'2'}];
  const result=groupToolActivity(events);
  assert.equal(result.length,4);
  assert.equal(result[0].activities[1].text,'output');
  assert.equal(result[1].type,'approval.requested');
  assert.equal(events[0].type,'tool.started');
});
test('active commentary keeps one expandable process with clean unique labels',()=>{
  const events=[
    {type:'message.delta',text:'我先检查',turnId:'1'},
    {type:'reasoning.summary',text:'**Checking gateway configuration**',turnId:'1'},
    {type:'tool.started',itemId:'a',title:'exec',detail:'pwd',turnId:'1'},
    {type:'tool.completed',itemId:'a',detail:'ok',turnId:'1'},
    {type:'reasoning.summary',text:'**Checking gateway configuration**',turnId:'1'},
    {type:'reasoning.summary',text:'**Designing public access settings**',turnId:'1'},
  ];
  const blocks=groupToolActivity(events,{running:true});
  assert.equal(blocks.length,2);
  assert.equal(blocks[0].type,'message.delta');
  assert.equal(blocks[1].type,'activity.group');
  assert.deepEqual(activityEntries(blocks[1].activities).map(item=>item.title),[
    'Checking gateway configuration','运行命令','Designing public access settings',
  ]);
  assert.equal(cleanActivityLabel('**Checking gateway configuration**'),'Checking gateway configuration');
  assert.equal(groupToolActivity(events)[0].type,'message.delta');
  assert.equal(activitySummary(blocks[1].activities),'Designing public access settings');
});
test('change activity keeps file names and the latest patch for its viewer',()=>{
  const entries=activityEntries([
    {type:'file.changed',itemId:'file-1',files:['src/example.ts'],diff:'@@\n-old\n+first'},
    {type:'diff.updated',diff:'@@\n-old\n+first'},
    {type:'diff.updated',diff:'@@\n-old\n+final'},
  ]);
  assert.deepEqual(entries.map(item=>item.title),['编辑文件','查看改动']);
  assert.deepEqual(entries[0].files,['src/example.ts']);
  assert.equal(entries[1].diff,'@@\n-old\n+final');
  assert.equal(entries[1].text,'@@\n-old\n+final');
});
test('operation headings and collapsed summaries do not read command bodies',()=>{
  let reads=0;
  const events=[{type:'tool.started',itemId:'command',title:'exec',get detail(){reads++;return 'original command';}},
    {type:'tool.completed',itemId:'command',status:'error',get detail(){reads++;return 'complete output';}}];
  assert.equal(activitySummary(events),'运行命令');
  const headings=activityEntries(events,{includeDetails:false});
  assert.equal(reads,0);assert.equal(headings.length,1);
  assert.equal(headings[0].status,'error');assert.equal(headings[0].text,'');
  const loaded=activityEntries(headings[0].activities)[0];
  assert.equal(loaded.key,headings[0].key);
  assert.equal(loaded.text,'original command\ncomplete output');assert.equal(reads,2);
});
test('deferred tool fragments keep lookup IDs and loaded bodies survive metadata refreshes',async()=>{
  const {conversationBlocks,restoreActivityDetails}=await import('../public/console-core.js');
  const headers=['a','b'].map(eventId=>({type:'tool.output',threadId:'t',eventId,itemId:'cmd',detailsDeferred:true}));
  const blocks=conversationBlocks(headers,'t');
  assert.deepEqual(blocks.map(e=>e.eventId),['a','b']);assert(blocks.every(e=>!e.text));
  const complete=headers.map((e,i)=>({...e,detailsDeferred:false,text:`part-${i}`}));
  const restored=restoreActivityDetails(headers,complete);
  assert.deepEqual(restored.map(e=>e.text),['part-0','part-1']);
  assert.equal(conversationBlocks(restored,'t')[0].text,'part-0part-1');
  assert.equal(restoreActivityDetails([{...headers[0],threadId:'other'}],complete)[0].detailsDeferred,true);
  const updated=restoreActivityDetails([{...headers[0],status:'completed'}],[{...complete[0],status:'running'}]);
  assert.equal(updated[0].status,'completed');assert.equal(updated[0].text,'part-0');
});

test('detail restoration skips ordinary histories and reuses snapshots when nothing matches',async()=>{
  const {restoreActivityDetails}=await import('../public/console-core.js');
  let reads=0;
  const known=Array.from({length:5000},(_,i)=>({get eventId(){reads++;return 'old-'+i;},threadId:'t',type:'message.delta'}));
  const events=Array.from({length:180},(_,i)=>({eventId:'recent-'+i,threadId:'t',type:'message.delta',text:'body'}));
  assert.equal(restoreActivityDetails(events,known),events);assert.equal(reads,0);
  const missing=[{type:'tool.output',threadId:'t',eventId:'missing',detailsDeferred:true}];
  assert.equal(restoreActivityDetails(missing,[]),missing);
  assert.equal(restoreActivityDetails(missing,known),missing);
  const other=[{type:'tool.output',threadId:'other',eventId:'same',detailsDeferred:true}];
  assert.equal(restoreActivityDetails(other,[{type:'tool.output',threadId:'t',eventId:'same',text:'private body'}]),other);
  const wrongType=[{type:'file.changed',threadId:'t',eventId:'same',detailsDeferred:true}];
  assert.equal(restoreActivityDetails(wrongType,[{type:'tool.output',threadId:'t',eventId:'same',text:'tool body'}]),wrongType);
});
test('persisted JSON queue errors have useful summaries and preserve unknown messages',()=>{
  assert.equal(compactError('{"code":-32600,"message":"thread not found: t"}'),'会话连接已失效，消息已保留，请重试');
  assert.equal(compactError('{"message":"unknown failure"}'),'unknown failure');
});
test('compaction survives lagging history and ends only on a terminal event',async()=>{
 const {retainCompaction}=await import('../public/console-core.js');
 const start={type:'context.compaction',eventId:'start',itemId:'c',status:'running'};
 const tool={type:'tool.completed',eventId:'tool',status:'ok'};
 const restored=retainCompaction([start,tool],[tool]);
 assert(restored.includes(start));
 assert.equal(retainCompaction(restored,restored).filter(e=>e.type==='context.compaction').length,1);
 const done={...start,eventId:'done',status:'ok'};
 assert.deepEqual(retainCompaction([start,tool],[tool,done]),[tool,done]);
 const blocks=groupToolActivity([start,tool,done]);
 assert.equal(blocks.filter(e=>e.type==='context.compaction').length,1);
 assert.equal(blocks[0].status,'ok');
 assert.equal(groupToolActivity([start,tool,{type:'turn.completed'}])[0].status,'cancelled');
});
