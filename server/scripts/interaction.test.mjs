import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupToolActivity,activityEntries,cleanActivityLabel,compactError} from '../public/console-core.js';

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
  assert.equal(groupToolActivity(events)[0].type,'activity.group');
});
test('persisted JSON queue errors have useful summaries and preserve unknown messages',()=>{
  assert.equal(compactError('{"code":-32600,"message":"thread not found: t"}'),'会话连接已失效，消息已保留，请重试');
  assert.equal(compactError('{"message":"unknown failure"}'),'unknown failure');
});
