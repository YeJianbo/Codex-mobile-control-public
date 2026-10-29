import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSideSnapshot} from '../public/console-thread-tools.js';
import {conversationBlocks} from '../public/console-core.js';

test('side snapshots replace covered fragments, retain their live suffix, and remain stable after reopening',()=>{
  const event=(id,text)=>({type:'message.delta',threadId:'side',turnId:'turn',itemId:'answer',eventId:id,text});
  const history=[{...event('history:side:two','AA'),textComplete:true}];
  const live=[event('one','A'),event('two','A'),event('three','B')];
  let merged=reconcileSideSnapshot(history,live);
  assert.equal(conversationBlocks(merged,'side')[0].text,'AAB');
  merged=reconcileSideSnapshot([{...event('history:side:three','AAB'),textComplete:true}],merged);
  assert.equal(conversationBlocks(merged,'side')[0].text,'AAB');
  assert.equal(merged.length,1);
});
