import test from 'node:test';
import assert from 'node:assert/strict';
import {ThreadEventCache} from '../public/thread-cache.js';
import {mergeEvents,retainCompleteConversationEvents} from '../public/console-core.js';

const delta=(id,threadId='active')=>({type:'message.delta',threadId,eventId:id,text:id});

test('streaming appends keep their lookup warm without reading old event IDs again',()=>{
  let reads=0;
  const history=Array.from({length:5000},(_,i)=>({type:'message.delta',threadId:'active',get eventId(){reads++;return 'old-'+i;},text:'old'}));
  const cache=new ThreadEventCache(()=>'active');cache.set('active',history);
  cache.append('active',delta('first'));const built=reads;
  for(let i=0;i<300;i++)cache.append('active',delta('new-'+i));
  assert.equal(reads,built);
  const current=cache.get('active');
  assert.equal(cache.append('active',delta('old-4999')),current);
  assert.equal(reads,built);assert.equal(current.length,5301);
  assert.equal(history.length,5000);
});

test('background appends weigh only the new event and retain exact cache accounting',()=>{
  let reads=0;
  const old={...delta('old','other'),get text(){reads++;return 'large'.repeat(1000);},files:['a.js'],fileChanges:[{path:'a.js',added:2}]};
  const cache=new ThreadEventCache(()=>'active');cache.set('other',[old]);const measured=reads;
  for(let i=0;i<40;i++)cache.append('other',{...delta('new-'+i,'other'),images:[{id:'image',name:'image.png'}]});
  assert.equal(reads,measured);
  assert.equal(cache.weights.get('other'),cache.weight(cache.get('other')));
});

test('receipts deduplicate by request while preserving other submissions and ignored ID aliases',()=>{
  const user={type:'user.message',threadId:'t',eventId:'saved',requestId:'one',text:'same'};
  const receipt={...user,eventId:'receipt'},second={...user,eventId:'second',requestId:'two'};
  const otherThread={...user,threadId:'other',eventId:'other'};
  const cache=new ThreadEventCache(()=>'t');cache.set('t',[user,receipt]);
  let expected=mergeEvents([user,receipt],[]);
  for(const event of [receipt,second,otherThread,delta('receipt','t'),second]){
    expected=mergeEvents(expected,[event]);
    assert.deepEqual(cache.append('t',event),expected);
  }
});

test('history replacement, deletion and clear discard identities from the old snapshot',()=>{
  const cache=new ThreadEventCache(()=>'active');
  cache.append('active',delta('old'));const branch=cache.get('active');
  cache.append('active',delta('later'));
  cache.set('active',branch);
  assert.deepEqual(cache.append('active',delta('later')).map(row=>row.eventId),['old','later']);
  cache.set('active',[delta('replacement')]);
  assert.deepEqual(cache.append('active',delta('old')).map(row=>row.eventId),['replacement','old']);
  cache.delete('active');assert.equal(cache.eventIndexes.size,0);
  assert.deepEqual(cache.append('active',delta('old')),[delta('old')]);
  cache.clear();assert.equal(cache.eventIndexes.size,0);assert.equal(cache.weights.size,0);
});

test('whole-turn trimming removes old identities and leaves long current turns intact',()=>{
  const user=id=>({type:'user.message',threadId:'active',eventId:id});
  const cache=new ThreadEventCache(()=>'active');
  cache.set('active',[user('old'),delta('a'),user('current'),delta('b')]);
  const previous=cache.get('active');
  assert.deepEqual(cache.append('active',delta('b'),2),previous.slice(2));
  assert.deepEqual(cache.append('active',delta('old'),3).map(row=>row.eventId),['current','b','old']);
  const long=[user('long'),...Array.from({length:30},(_,i)=>delta('long-'+i))];
  assert.equal(retainCompleteConversationEvents(long,3),long);
  cache.set('active',long);cache.append('active',delta('next'),3);
  const current=cache.get('active');assert.equal(current.length,32);
  assert.equal(cache.append('active',delta('next'),3),current);
});

test('growth and conversation selection keep inactive budgets and index eviction intact',()=>{
  let active='active';const cache=new ThreadEventCache(()=>active,1,2000);
  cache.append('active',delta('a'));cache.append('first',delta('b','first'));
  cache.append('second',delta('c','second'));assert(!cache.has('first'));assert(!cache.eventIndexes.has('first'));
  cache.append('second',{...delta('big','second'),text:'x'.repeat(2000)});
  assert(!cache.has('second'));assert(!cache.eventIndexes.has('second'));
  cache.append('active',{...delta('big'),text:'x'.repeat(2000)});assert(cache.has('active'));
  active='next';cache.append('next',delta('next','next'));
  assert(!cache.has('active'));assert(!cache.eventIndexes.has('active'));
});
