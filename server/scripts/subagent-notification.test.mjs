import test from 'node:test';
import assert from 'node:assert/strict';
import {subagentNotificationEvent,enrichMessageSources} from '../dist/services/messageSource.js';

const wrap=value=>`<subagent_notification>\n${JSON.stringify(value)}\n</subagent_notification>`;
test('new agent_path notifications render as folded tool results with decoded Markdown',()=>{
 const body='1. 修改 [file.ts](/work/file.ts:12)\n2. 验证通过';
 const result=subagentNotificationEvent(wrap({agent_path:'child',status:{completed:body}}),'parent');
 assert.equal(result.type,'tool.completed');assert.equal(result.title,'子代理已完成');assert.equal(result.status,'ok');
 assert.equal(result.detail,body);assert.equal(result.messageSource.threadId,'child');
});
test('legacy agent IDs work; failure status is retained without turning quoted user text into a notification',()=>{
 const input=wrap({agent_id:'child',status:{errored:'fixture error'}});
 assert.equal(subagentNotificationEvent(input,'parent').status,'error');
 assert.equal(subagentNotificationEvent('请解释：\n'+input,'parent'),undefined);
 assert.equal(subagentNotificationEvent('<subagent_notification>not json</subagent_notification>','parent'),undefined);
});
test('batched subagent notifications keep both results without exposing protocol envelopes',()=>{
 const result=subagentNotificationEvent(wrap({agent_path:'a',status:{completed:'first\nresult'}})+'\n'+wrap({agent_path:'b',status:{errored:'second result'}}),'parent');
 assert.equal(result.type,'tool.completed');assert.equal(result.status,'error');
 assert(result.detail.includes('first\nresult'));assert(result.detail.includes('second result'));
 assert(!result.detail.includes('subagent_notification'));
});
test('already persisted raw notification bubbles are normalized while retaining history identity',async()=>{
 const events=await enrichMessageSources([{type:'user.message',threadId:'parent',eventId:'saved',createdAt:'2026-10-20T00:00:00Z',text:wrap({agent_path:'child',status:{completed:'done\nnext'}})}],new Map([['child','Sol 子代理']]));
 assert.equal(events[0].type,'tool.completed');assert.equal(events[0].eventId,'saved');
 assert.equal(events[0].detail,'done\nnext');assert.equal(events[0].messageSource.name,'Sol 子代理');
 assert.equal(events[0].text,undefined);
});
