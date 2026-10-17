import test from 'node:test';
import assert from 'node:assert/strict';
import {compactionSummary,foldCompactionSummaries} from '../dist/services/contextCompaction.js';
import {mergeMobileThreadEvents} from '../dist/services/mobileHistory.js';
import {SessionManager} from '../dist/services/sessionManager.js';
import {EventEmitter} from 'node:events';
import {reconnectEvents} from '../public/console-core.js';

test('completed-only compaction matches a unique history summary across gateway and web',()=>{
 const history={type:'context.compaction',threadId:'t',eventId:'history:marker',itemId:'history:42',status:'ok',createdAt:'2026-10-16T12:52:13.586Z',text:'## 当前任务\n\n保留的完整摘要'};
 const live={...history,eventId:'live:done',itemId:'compact-1',createdAt:'2026-10-16T12:52:13.603Z',text:history.text+'<oai-mem-citation>source</oai-mem-citation>'};
 for(const fold of [foldCompactionSummaries,reconnectEvents]){
  const one=fold([history,live]);assert.equal(one.length,1);assert.equal(one[0].itemId,'compact-1');
  const second={...live,eventId:'live:other',itemId:'compact-2'};
  assert.equal(fold([history,live,second]).length,3,'multiple live identities stay ambiguous');
  const later={...history,eventId:'history:later',createdAt:'2026-10-16T12:54:00Z'};
  assert.equal(fold([history,live,later]).length,3,'two markers cannot claim one item');
  const boundary={type:'turn.started',threadId:'t',turnId:'next',createdAt:'2026-10-16T12:53:00Z'};
  assert.equal(fold([live,boundary,later]).length,3,'identical summaries in different lifecycle windows remain distinct');
  assert.equal(fold([history,{...live,turnId:'other'}, {...history,eventId:'history:turn',turnId:'mine'}]).filter(e=>e.type==='context.compaction').length,2);
  assert.equal(fold([history,{...live,threadId:'other'}]).length,2);
 }
 assert.equal(history.itemId,'history:42','cached input is immutable');
});

test('compaction folds only its real summary, including citation-stripped streamed output',()=>{
  const text='## 当前任务\n\n实际摘要';
  const message=(text,itemId='summary')=>({type:'message.delta',threadId:'t',itemId,text});
  const compact={type:'context.compaction',threadId:'t',text,status:'ok',createdAt:'2026-10-15T00:00:03Z'};
  const normal=message('## 当前任务\n\n这是正常回复','normal');
  const citation='<oai-mem-citation>reference</oai-mem-citation>';
  assert.deepEqual(foldCompactionSummaries([normal,message('## 当前任务\n\n'),message('实际摘要'+citation),compact]),[normal,compact]);
  assert.deepEqual(foldCompactionSummaries([normal,compact]),[normal,compact]);
  const input={type:'user.message',threadId:'t',text:'继续'};
  assert.deepEqual(foldCompactionSummaries([message(text),input,compact]),[message(text),input,compact]);
  assert.deepEqual(foldCompactionSummaries([message(text),{...compact,threadId:'other'}]),[message(text),{...compact,threadId:'other'}]);
  const live=message(text);live.createdAt='2026-10-15T00:00:02Z';
  assert.deepEqual(mergeMobileThreadEvents([compact],[live]),[compact]);
  assert.equal(compactionSummary(text),text);
});

test('a literal unclosed citation truncated by native compaction folds the complete source, not an ordinary reply',()=>{
 const prefix='## 当前任务与授权\n\n精确的摘要内容\n最终引用格式 `';
 const original=prefix+'<oai-mem-citation>`。保留的其余摘要。';
 const normal={type:'message.delta',threadId:'t',itemId:'normal',text:'## 当前任务与授权\n\n正常回复仍要显示'};
 const chunks=[{type:'message.delta',threadId:'t',itemId:'summary',text:original.slice(0,30)},
  {type:'message.delta',threadId:'t',itemId:'summary',text:original.slice(30)}];
 const compact={type:'context.compaction',threadId:'t',text:prefix,status:'ok'};
 assert.deepEqual(foldCompactionSummaries([normal,...chunks,compact]),[normal,{...compact,text:original}]);
 const complete={...chunks[0],text:original,textComplete:true};
 assert.deepEqual(foldCompactionSummaries([complete,compact]),[{...compact,text:original}]);
 assert.deepEqual(foldCompactionSummaries([normal,compact]),[normal,compact]);
 assert.equal(compact.text,prefix,'do not mutate shared cached input');
});

test('live compaction keeps generated agent deltas inside its fold and leaves other threads untouched',()=>{
 const codex=new EventEmitter(),events=[];
 const manager=new SessionManager(codex,{publish:event=>events.push(event)},{threads:[],approvals:[]});
 const emit=(method,params)=>codex.emit('notification',{method,params});
 emit('item/started',{threadId:'t',item:{type:'contextCompaction',id:'compact-1'}});
 emit('item/agentMessage/delta',{threadId:'t',itemId:'summary',delta:'内部摘要第一段'});
 emit('item/agentMessage/delta',{threadId:'other',itemId:'answer',delta:'另一会话的正常回复'});
 emit('item/agentMessage/delta',{threadId:'t',itemId:'summary',delta:'第二段'});
 emit('item/completed',{threadId:'t',item:{type:'contextCompaction',id:'compact-1'}});
 assert.equal(events.filter(event=>event.type==='message.delta'&&event.threadId==='t').length,0);
 assert.equal(events.find(event=>event.type==='message.delta').text,'另一会话的正常回复');
 assert.equal(events.filter(event=>event.type==='context.compaction').at(-1).text,'内部摘要第一段第二段');
 emit('item/agentMessage/delta',{threadId:'t',itemId:'normal',delta:'压缩后的正常回复'});
 assert.equal(events.at(-1).type,'message.delta');assert.equal(events.at(-1).text,'压缩后的正常回复');
});
