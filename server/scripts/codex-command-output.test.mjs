import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexCommandOutput} from '../dist/services/codexCommandOutput.js';

test('command bursts merge before publication without changing a single output character',()=>{
 const events=[],batch=new CodexCommandOutput(event=>events.push(event));
 const parts=Array.from({length:3000},(_,i)=>`${i} 中文\n`);
 for(const part of parts)batch.append('t','command',part);
 batch.flush();
 const output=events.filter(event=>event.type==='tool.output');
 assert.equal(output.map(event=>event.text).join(''),parts.join(''));
 assert(output.length<5);assert(output.every(event=>event.threadId==='t'&&event.itemId==='command'));
 assert.equal(events.filter(event=>event.type==='terminal.output').map(event=>event.text).join(''),parts.join(''));
 console.log(JSON.stringify({inputFragments:3000,publishedToolChunks:output.length,allCharactersPreserved:true}));
});

test('switching commands and explicit lifecycle flushes preserve event order',()=>{
 const events=[],batch=new CodexCommandOutput(event=>events.push(event));
 batch.append('t','a','first');batch.append('t','a',' second');
 batch.append('t','b','third');batch.flush();
 events.push({type:'tool.completed'});
 batch.append('other','a','fourth');batch.flush();
 assert.deepEqual(events.filter(event=>event.type!=='terminal.output'),[
  {type:'tool.output',threadId:'t',itemId:'a',text:'first second'},
  {type:'tool.output',threadId:'t',itemId:'b',text:'third'},
  {type:'tool.completed'},
  {type:'tool.output',threadId:'other',itemId:'a',text:'fourth'},
 ]);
});

test('quiet command tails flush automatically; a large frame does not accumulate unbounded parts',async()=>{
 const events=[],batch=new CodexCommandOutput(event=>events.push(event),10);
 batch.append('t','a','tail');
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(events.find(event=>event.type==='tool.output')?.text,'tail');
 const large='x'.repeat(65536);batch.append('t','a',large);batch.flush();
 assert.equal(events.filter(event=>event.type==='tool.output').at(-1).text,large);
 assert.equal(events.filter(event=>event.type==='tool.output').length,2);
});
