import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAnswerText,conversationBlocks} from '../public/console-core.js';

const reference='<oai-mem-citation>\n<citation_entries>\nMEMORY.md:596-601|note=[release workflow]\n</citation_entries>\n<rollout_ids>\n01a07e7c-8f28-7a53-9825-0152b461a685\n</rollout_ids>\n</oai-mem-citation>';
test('assistant prose, history and selection omit reference metadata while user text remains literal',()=>{
 const source='已更新。\n\n'+reference;
 const original=[{type:'user.message',threadId:'t',text:source},{type:'message.delta',threadId:'t',text:source}];
 const result=conversationBlocks(original,'t');
 assert.equal(result[0].text,source);assert.equal(result[1].text,'已更新。');assert.equal(original[1].text,source);
});
test('streamed reference fragments cannot leak their body before closing tags arrive',()=>{
 for(const end of [reference.indexOf('MEMORY.md')+20,reference.indexOf('</citation_entries>')+10,reference.length]){
  const source='完成。\n\n'+reference.slice(0,end);
  assert.equal(visibleAnswerText(source),'完成。');
 }
});
test('literal reference examples in fenced code and ordinary file paths remain unchanged',()=>{
 const source='示例：\n```xml\n'+reference+'\n```\n\n文件 MEMORY.md:596-601';
 assert.equal(visibleAnswerText(source),source);
 assert.equal(visibleAnswerText('普通回复\n'),'普通回复\n');
});
