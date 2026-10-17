import test from 'node:test';
import assert from 'node:assert/strict';
import {SidebarStatusCache} from '../dist/services/sidebarStatus.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('source updates share in-flight status work and discard its stale result',async()=>{
  const cache=new SidebarStatusCache(),first=deferred(),next=deferred();
  let reads=0;
  const thread={id:'active',status:'running',updatedAt:'one'};
  assert.equal(cache.read(thread,()=>{reads++;return first.promise;}),'running');
  await tick();assert.equal(reads,1);
  for(let i=0;i<20;i++)cache.read({...thread,updatedAt:'update-'+i,status:'completed'},()=>{reads++;return next.promise;});
  await tick();assert.equal(reads,1,'A changing source must not duplicate pending history/status reads');
  first.resolve('interrupted');await tick();
  const latest={...thread,updatedAt:'update-19',status:'completed'};
  assert.equal(cache.read(latest,()=>{reads++;return next.promise;}),'completed','Old results cannot replace newer source state');
  await tick();assert.equal(reads,2,'The next normal read rechecks the latest source without a cooldown from old work');
  next.resolve('idle');await tick();
  assert.equal(cache.read(latest,()=>{throw Error('Fresh status should be reused');}),'idle');
});

test('different threads refresh independently and failed old work releases its slot',async()=>{
  const cache=new SidebarStatusCache(),first=deferred();
  let reads=0;
  const thread={id:'first',status:'running',updatedAt:'one'};
  cache.read(thread,()=>{reads++;return first.promise;});
  cache.read({...thread,id:'second'},async()=>{reads++;return 'completed';});
  await tick();assert.equal(reads,2);
  const latest={...thread,updatedAt:'two',status:'idle'};
  assert.equal(cache.read(latest,()=>{reads++;return first.promise;}),'idle');
  await tick();assert.equal(reads,2);
  first.reject(Error('old read failed'));await tick();
  cache.read(latest,async()=>{reads++;return 'completed';});await tick();
  assert.equal(reads,3);
  assert.equal(cache.read(latest,()=>{throw Error('Retry was already completed');}),'completed');
});

test('streaming timestamps keep the five-second status-check interval',async t=>{
  let now=10000,reads=0;
  t.mock.method(Date,'now',()=>now);
  const cache=new SidebarStatusCache(),thread={id:'streaming',status:'running',updatedAt:'first'};
  const refresh=async()=>{reads++;return 'running';};
  cache.read(thread,refresh);await tick();
  for(let index=1;index<=19;index++){
    now=10000+index*250;
    assert.equal(cache.read({...thread,updatedAt:'frame-'+index},refresh),'running');await tick();
  }
  assert.equal(reads,1,'New text must not turn every sidebar request into a new status lookup');
  now=15000;cache.read({...thread,updatedAt:'frame-20'},refresh);await tick();assert.equal(reads,2);
  now=15001;assert.equal(cache.read({...thread,status:'completed',updatedAt:'finished'},refresh),'completed');
  await tick();assert.equal(reads,3,'A lifecycle transition still rechecks immediately');
});

test('timestamp changes during a pending lookup discard its result without bypassing the interval',async t=>{
  let now=10000,reads=0;
  t.mock.method(Date,'now',()=>now);
  const cache=new SidebarStatusCache(),first=deferred(),thread={id:'streaming',status:'running',updatedAt:'first'};
  const refresh=()=>{reads++;return reads===1?first.promise:Promise.resolve('running');};
  cache.read(thread,refresh);await tick();
  now=11000;const latest={...thread,updatedAt:'new-frame'};cache.read(latest,refresh);
  first.resolve('completed');await tick();
  now=14999;assert.equal(cache.read(latest,refresh),'running');await tick();assert.equal(reads,1);
  now=15000;cache.read(latest,refresh);await tick();assert.equal(reads,2);
});
