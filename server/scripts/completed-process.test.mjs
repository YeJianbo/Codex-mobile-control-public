import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationBlocks,groupToolActivity,processDuration,reconnectEvents} from '../public/console-core.js';

test('reconnected compactions search other compactions instead of ordinary historical messages',t=>{
  const turns=300,events=[];let reads=0;
  for(let i=0;i<turns;i++){
    events.push({type:'turn.started',threadId:'t',turnId:String(i),eventId:'s'+i},
      {get type(){reads++;return 'user.message';},threadId:'t',eventId:'u'+i,text:'question'});
    for(let j=0;j<12;j++)events.push({type:'tool.completed',threadId:'t',eventId:`tool${i}:${j}`,itemId:`tool${i}:${j}`});
    events.push({type:'context.compaction',threadId:'t',turnId:String(i),itemId:'compact'+i,eventId:'cs'+i,status:'running'},
      {type:'context.compaction',threadId:'t',turnId:String(i),itemId:'compact'+i,eventId:'ce'+i,status:'ok'},
      {type:'turn.completed',threadId:'t',turnId:String(i),eventId:'e'+i,status:'completed'});
  }
  const result=reconnectEvents(events),visits=reads;
  assert(visits<=turns*50,`Compaction matching inspected unrelated user messages ${visits} times`);
  assert.equal(result.length,turns*16);
  const compactions=result.filter(event=>event.type==='context.compaction');
  assert.equal(compactions.length,turns);assert(compactions.every((event,index)=>event.eventId==='cs'+index&&event.status==='ok'));
  t.diagnostic(JSON.stringify({turns,events:events.length,userTypeReads:visits,outputEvents:result.length}));
});

test('completed turns do not rescan every earlier message for unfinished compactions',t=>{
  const turns=400,blocks=[];let reads=0;
  for(let i=0;i<turns;i++)blocks.push(
    {type:'turn.started',eventId:'start'+i,turnId:String(i)},
    {get type(){reads++;return 'user.message';},eventId:'u'+i,text:'question'},
    {type:'tool.started',eventId:'tool'+i,itemId:'tool'+i,title:'exec'},
    {type:'tool.completed',eventId:'done'+i,itemId:'tool'+i,status:'ok'},
    {type:'message.delta',eventId:'reply'+i,text:'answer'},
    {type:'turn.completed',eventId:'end'+i,status:'completed'},
  );
  const result=groupToolActivity(blocks),visits=reads;
  assert(visits<=turns*20,`Completed history inspected earlier user messages ${visits} times`);
  assert.equal(result.length,turns*3);
  assert.equal(result.filter(block=>block.type==='process.completed').length,turns);
  assert.equal(result.filter(block=>block.type==='message.delta').length,turns);
  t.diagnostic(JSON.stringify({turns,events:blocks.length,userTypeReads:visits,renderedBlocks:result.length}));
});

test('tracked compactions retain matching, original identities and turn-end cancellation',()=>{
  const compact=(eventId,itemId,status)=>({type:'context.compaction',eventId,itemId,status});
  const result=groupToolActivity([
    {type:'turn.started'},compact('first-start','one','running'),compact('second-start','two','running'),
    compact('first-finish','one','ok'),compact('third-start','three','running'),compact('wildcard-finish','','error'),
    {type:'turn.completed',status:'completed'},{type:'turn.started'},compact('next-start','next','running'),
  ],{running:true});
  assert.deepEqual(result.filter(block=>block.type==='context.compaction').map(({eventId,itemId,status})=>({eventId,itemId,status})),[
    {eventId:'first-start',itemId:'one',status:'ok'},
    {eventId:'second-start',itemId:'two',status:'cancelled'},
    {eventId:'third-start',itemId:'',status:'error'},
    {eventId:'next-start',itemId:'next',status:'running'},
  ]);
});

test('retry records consolidate original errors and recover only inside their own turn',()=>{
  const first={type:'error',threadId:'t',turnId:'one',eventId:'retry2',title:'正在重新连接 2/5',detail:'Reconnecting... 2/5\nos error 10054',willRetry:true};
  const next={...first,eventId:'retry3',title:'正在重新连接 3/5',detail:'Reconnecting... 3/5\nHTTP 502'};
  const errors=(...tail)=>conversationBlocks([first,first,next,...tail],'t').filter(event=>event.type==='error');
  const active=errors({type:'tool.output',threadId:'t',turnId:'one',text:'already running'});
  assert.equal(active.length,1);assert.equal(active[0].title,'正在重试');
  for(const detail of ['2/5','3/5','10054','502'])assert(active[0].detail.includes(detail));
  assert.equal(errors({type:'message.delta',threadId:'t',turnId:'one',text:'继续处理'})[0].title,'执行已恢复');
  assert.equal(errors({type:'turn.started',threadId:'t',turnId:'two'},{type:'message.delta',threadId:'t',turnId:'two',text:'next turn'})[0].title,'重试记录');
  assert.equal(errors({type:'turn.completed',threadId:'t',turnId:'one',status:'interrupted'})[0].title,'重试已停止');
  assert.deepEqual(errors({...first,eventId:'failure',title:'执行失败',willRetry:false}).map(event=>event.title),['重试未成功','执行失败']);
  assert.equal(first.title,'正在重新连接 2/5');
});
test('duration uses actual timestamps and falls back for missing times',()=>{
  assert.equal(processDuration('2026-09-28T00:00:00Z','2026-09-28T00:01:05Z'),'用时 1分 5秒');
  assert.equal(processDuration('',''),'处理过程');
  assert.equal(processDuration('2026-09-28T00:02:00Z','2026-09-28T00:01:05Z'),'处理过程');
});

test('late receipts and duplicate completion stay in the original turn after the next starts',()=>{
  const events=[{type:'turn.started',turnId:'one'},{type:'tool.started',itemId:'edit',turnId:'one'},
    {type:'file.changed',files:['a.kt']},{type:'message.delta',itemId:'answer',text:'done'},
    {type:'turn.completed',turnId:'one',eventId:'live:end',status:'completed'},
    {type:'user.message',text:'next'},{type:'turn.started',turnId:'two'},
    {type:'tool.started',itemId:'new',turnId:'two'},
    {type:'tool.completed',itemId:'edit'},
    {type:'file.changed',turnId:'one',files:['b.kt']},
    {type:'turn.completed',turnId:'one',eventId:'history:end',status:'completed'}]
    .map((e,i)=>({eventId:`event:${i}`,threadId:'t',...e}));
  const blocks=groupToolActivity(conversationBlocks(events,'t'),{running:true});
  assert.deepEqual(blocks.map(e=>e.type),['process.completed','message.delta','files.summary','user.message','activity.group']);
  assert.deepEqual(blocks[2].activities.flatMap(e=>e.files||[]),['a.kt','b.kt']);
  assert(blocks[0].children.flatMap(e=>e.activities||[]).some(e=>e.type==='tool.completed'&&e.itemId==='edit'));
  assert.equal(blocks.at(-1).activities[0].itemId,'new');
  assert.equal(blocks[1].text,'done');
});
test('process controls precede replies, preserving final and interrupted commentary',()=>{
  const events=[{type:'user.message',text:'fix'},{type:'message.delta',itemId:'progress',text:'checking'},{type:'tool.started',itemId:'tool'},{type:'message.delta',itemId:'final',text:'done'}].map(e=>({...e,threadId:'t'}));
  const blocks=extra=>groupToolActivity(conversationBlocks([...events,...extra],'t'),{running:true});
  assert.equal(blocks([]).length,4);
  const complete=blocks([{type:'turn.completed',threadId:'t',status:'completed'}]);
  assert.equal(complete.length,3);
  assert.equal(complete[1].type,'process.completed');
  assert.equal(complete[1].children.length,2);
  assert.equal(complete[2].text,'done');
  const timed=groupToolActivity(conversationBlocks([{type:'turn.started',threadId:'t',createdAt:'2026-09-28T00:00:00Z'},...events,{type:'turn.completed',threadId:'t',createdAt:'2026-09-28T00:01:05Z'}],'t'));
  assert.equal(timed[1].title,'用时 1分 5秒');
  assert.equal(blocks([{type:'turn.completed',threadId:'t',status:'interrupted'}]).length,4);
  assert.equal(blocks([])[1].text,'checking');
  assert.equal(blocks([])[2].type,'activity.group');
});

test('completion folds one turn containing commentary and independent operation segments',()=>{
  const events=[{type:'user.message',text:'fix'},{type:'message.delta',itemId:'intro',text:'read'},{type:'tool.completed',itemId:'read'},
    {type:'message.delta',itemId:'progress',text:'check'},{type:'tool.completed',itemId:'check'},{type:'message.delta',itemId:'final',text:'done'},
    {type:'turn.completed',status:'completed'}].map(e=>({...e,threadId:'t'}));
  const blocks=groupToolActivity(conversationBlocks(events,'t'));
  assert.deepEqual(blocks.map(e=>e.type),['user.message','process.completed','message.delta']);
  assert.deepEqual(blocks[1].children.map(e=>e.type),['message.delta','activity.group','message.delta','activity.group']);
  assert.deepEqual(blocks[1].children.filter(e=>e.type==='message.delta').map(e=>e.text),['read','check']);
  assert.deepEqual(blocks.filter(e=>e.type==='message.delta').map(e=>e.text),['done']);
});

test('steering leaves past operations in place and file changes are summarized once at completion',()=>{
  const events=[{type:'turn.started'},{type:'file.changed',eventId:'old',files:['a.kt']},
    {type:'user.message',eventId:'steer',text:'continue'},{type:'file.changed',eventId:'new',files:['b.kt']},
    {type:'message.delta',itemId:'answer',text:'done'}].map(e=>({...e,threadId:'t'}));
  const live=groupToolActivity(conversationBlocks(events,'t'),{running:true});
  assert.equal(live.filter(e=>e.type==='files.summary').length,0);
  const ended=groupToolActivity(conversationBlocks([...events,{type:'turn.completed',threadId:'t',status:'completed'}],'t'));
  assert.equal(ended.filter(e=>e.type==='files.summary').length,1);
  assert.deepEqual(ended.find(e=>e.type==='files.summary').activities.flatMap(e=>e.files||[]),['a.kt','b.kt']);
  assert(ended.findIndex(e=>e.type==='activity.group')<ended.findIndex(e=>e.eventId==='steer'));
});
