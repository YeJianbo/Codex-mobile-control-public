import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistantModelCatalog} from '../src/services/assistantModelCatalog.ts';

const model=id=>({model:id,displayName:id,supportedReasoningEfforts:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={},options={}){
  const calls={codex:0,external:0,claude:0,antigravity:0};
  const loaders={codex:async()=>[model('gpt-6.1-sol')],external:async()=>({models:[],backends:[]}),claude:async()=>({models:[model('claude::sonnet')],available:true,reason:''}),antigravity:async()=>({models:[model('antigravity::gemini')],available:true,reason:''}),...overrides};
  const catalog=new AssistantModelCatalog(Object.fromEntries(Object.entries(loaders).map(([name,load])=>[name,async refresh=>{calls[name]++;return load(refresh);}])) ,{budgetMs:20,...options});
  return {catalog,calls};
}

test('a stalled AGY discovery cannot withhold Codex or Claude; concurrent polls share discovery',{timeout:1000},async()=>{
  const agy=deferred();const {catalog,calls}=fixture({antigravity:()=>agy.promise});
  const reads=await Promise.all(Array.from({length:8},()=>catalog.read()));
  for(const result of reads){
    assert.equal(result.defaultModel,'gpt-6.1-sol');
    assert(result.models.some(row=>row.model==='gpt-6.1-sol'&&row.available));
    assert(result.models.some(row=>row.model==='claude::sonnet'&&row.available));
    assert.equal(result.backends.find(row=>row.agent==='claude').reason,'');
    assert.equal(result.backends.find(row=>row.agent==='antigravity').available,false);
    assert.equal(result.loading,true);assert.deepEqual(result.pendingSources,['antigravity']);
  }
  await catalog.read();await catalog.read(true);await catalog.read();
  assert.equal(calls.antigravity,1,'polling and refresh must join an in-flight source');
  agy.resolve({models:[model('antigravity::gemini')],available:true,reason:''});await tick();
  const complete=await catalog.read();
  assert.equal(complete.loading,false);assert.deepEqual(complete.pendingSources,[]);
  assert(complete.models.some(row=>row.model==='antigravity::gemini'&&row.available));
  assert.equal(calls.antigravity,1,'a completed discovery must survive subsequent polls');
});

test('all slow sources return within the cold-read budget without cancellation or duplicate work',{timeout:1000},async()=>{
  const pending=deferred();const {catalog,calls}=fixture(Object.fromEntries(['codex','external','claude','antigravity'].map(key=>[key,()=>pending.promise])));
  const result=await catalog.read();
  assert.equal(result.defaultModel,null);assert.deepEqual(result.models,[]);assert.equal(result.loading,true);
  assert.deepEqual(result.pendingSources,['codex','external','claude','antigravity']);
  assert.deepEqual(calls,{codex:1,external:1,claude:1,antigravity:1});
});

test('failed sources have a cooldown and cannot erase healthy independent results',async()=>{
  let now=100;const {catalog,calls}=fixture({antigravity:async()=>{throw Error('ACP initialize timeout');}},{now:()=>now,ttlMs:1000});
  const first=await catalog.read();assert.equal(first.loading,false);
  assert.equal(first.backends.find(row=>row.agent==='antigravity').reason,'ACP initialize timeout');
  for(let i=0;i<10;i++)await catalog.read();
  assert.equal(calls.antigravity,1);assert.equal(calls.codex,1);
  now+=1001;const stale=await catalog.read();assert.equal(stale.defaultModel,'gpt-6.1-sol');
  await tick();assert.equal(calls.antigravity,2);assert.equal((await catalog.read()).loading,false);
  assert.equal(calls.antigravity,2);
});

test('refresh retains usable results, publishes each source separately and never replays old work',async()=>{
  const nextNative=deferred(),nextAgy=deferred();let nativeRuns=0,agyRuns=0;
  const {catalog,calls}=fixture({codex:async()=>++nativeRuns===1?[model('gpt-6.1-sol')]:nextNative.promise,antigravity:async()=>++agyRuns===1?{models:[model('antigravity::old')],available:true,reason:''}:nextAgy.promise});
  await catalog.read();const refreshing=await catalog.read(true);
  assert.equal(refreshing.defaultModel,'gpt-6.1-sol');assert.equal(refreshing.loading,true);
  await catalog.read(true);assert.equal(calls.codex,2);assert.equal(calls.antigravity,2);
  nextNative.resolve([model('gpt-6-sol')]);await tick();
  const partial=await catalog.read();assert.equal(partial.defaultModel,'gpt-6-sol');assert(!partial.models.some(row=>row.model==='gpt-6.1-sol'));
  assert(partial.pendingSources.includes('antigravity'));
  nextAgy.resolve({models:[model('antigravity::new')],available:true,reason:''});await tick();
  const completed=await catalog.read();assert.equal(completed.loading,false);
  assert(completed.models.some(row=>row.model==='antigravity::new'));assert(!completed.models.some(row=>row.model==='antigravity::old'));
  assert.equal(calls.codex,2);assert.equal(calls.antigravity,2);
});
