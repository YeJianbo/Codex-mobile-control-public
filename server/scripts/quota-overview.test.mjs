import test from 'node:test';
import assert from 'node:assert/strict';
import {QuotaOverview,quotaWindow,agyOverviewWindows} from '../../components/local-console/src/quota-overview.mjs';

test('AGY shared pools combine model aliases while independent or legacy quotas remain separate',()=>{
 const shared={poolId:'gemini-5h',group:'Gemini Models',window:'5h',remainingPercent:80,resetsAt:'2026-10-27T04:00:00Z'};
 const rows=agyOverviewWindows([{...shared,name:'Gemini Flash'},{...shared,name:'Gemini Pro'},
  {...shared,poolId:'gemini-weekly',window:'weekly'},
  {name:'Legacy A',remainingPercent:100},{name:'Legacy B',remainingPercent:100}]);
 assert.equal(rows.length,4);assert.equal(rows[0].name,'Gemini · 5h');assert.equal(rows[1].name,'Gemini · 7d');
 assert.equal(agyOverviewWindows([shared,{...shared,remainingPercent:70}]).length,2);
});

function fixture(overrides={}){
  return new QuotaOverview({store:{accounts:()=>({hasLogin:true,email:'current@example.test',items:[],liveUsage:{at:'2026-10-25T00:00:00Z',primary:{used_percent:35,reset_at:1792893600},secondary:null}})},
    usage:{refresh:async()=>{}},agy:{list:async()=>({items:[],current:{configured:true,quotaAccountId:'google:user-a',email:'a@example.test'}}),history:()=>({points:[]})},
    claude:{list:async()=>({items:[],current:{configured:false},currentAccountId:null}),history:()=>[],refresh:async()=>({sample:{status:'ok'}})},refreshAgy:async()=>{},...overrides});
}

test('quota projection preserves missing windows and exposes only account metadata',async()=>{
  const service=fixture(),result=await service.read('codex'),row=result.sources[0].accounts[0];
  assert.equal(row.active,true);assert.equal(row.windows.length,1);assert.equal(row.windows[0].name,'5h');assert.equal(row.windows[0].remainingPercent,65);
  assert.equal(quotaWindow({used_percent:120},'7d'),null);
  assert.equal(quotaWindow({remainingPercent:0},'7d').remainingPercent,0);
  assert(!JSON.stringify(result).includes('access_token'));
  assert.equal((await service.read('grok')).sources[0].supported,false);
});

test('AGY never attaches unowned or another login history to the current account',async()=>{
  const service=fixture({agy:{list:async()=>({items:[],current:{configured:true,quotaAccountId:'google:user-a',email:'a@example.test'}}),history:()=>({points:[
    {accountId:null,at:'2026-10-25T00:00:00Z',windows:[{name:'old',remainingPercent:90}]},
    {accountId:'google:user-b',at:'2026-10-25T00:00:01Z',windows:[{name:'other',remainingPercent:80}]},
    {accountId:'google:user-a',at:'2026-10-25T00:00:02Z',windows:[{name:'current',remainingPercent:70}]},
  ]})}});
  const rows=(await service.read('agy')).sources[0].accounts;
  assert.equal(rows.find(row=>row.active).windows[0].remainingPercent,70);
  assert.equal(rows.find(row=>row.id==='unassigned').windows[0].remainingPercent,90);
  assert(!JSON.stringify(rows).includes('other'));
});

test('AGY overview exposes a local model-pool estimate after matching samples',async()=>{
  const start=Date.parse('2026-10-25T00:00:00Z'),reset='2026-10-26T00:00:00.000Z';
  const point=(minutes,remainingPercent)=>({accountId:'google:user-a',source:'cli-live',at:new Date(start+minutes*60000).toISOString(),windows:[{name:'Gemini',group:'Gemini Models',poolId:'gemini',window:'weekly',remainingPercent,resetsAt:reset}]});
  const usage={time:start+60000,model:'gemini-3.8-flash',displayModel:'Gemini 3.8 Flash',input:1000,output:100,cached:0,cacheWrite:0,messageId:'1'};
  const service=fixture({now:()=>start+12*60000,agy:{list:async()=>({items:[],current:{configured:true,quotaAccountId:'google:user-a'}}),history:()=>({points:[point(0,80),point(10,75)]})},
    agyUsage:()=>({refresh(){},db:{prepare:()=>({all:()=>[{data:JSON.stringify(usage)}]})}})});
  const row=(await service.read('agy')).sources[0].accounts[0].windows[0];
  assert.equal(row.estimate.state,'estimated');assert.equal(row.estimate.tokens,22000);assert(row.estimate.usd>0);
});

test('Claude overview uses each account history instead of the account selected on another page',async()=>{
  const service=fixture({claude:{list:async()=>({items:[{id:'saved',name:'Saved',active:false}],current:{name:'Native',configured:true},currentAccountId:'native-owner',selectedId:'saved'}),history:()=>[
    {accountId:'saved',at:'2026-10-25T00:00:00Z',status:'ok',windows:[{name:'7d',remainingPercent:10}]},
    {accountId:'native-owner',at:'2026-10-25T00:00:00Z',status:'ok',windows:[{name:'5h',remainingPercent:60}]},
    {accountId:'native-owner',at:'2026-10-25T00:01:00Z',status:'unavailable',reason:'rate limited',windows:[]},
  ]}});
  const rows=(await service.read('claude')).sources[0].accounts,current=rows.find(row=>row.active);
  assert.equal(current.windows[0].remainingPercent,60);assert.equal(current.stale,true);assert.equal(current.reason,'rate limited');
  assert.equal(rows.find(row=>row.id==='saved').windows[0].remainingPercent,10);
});

test('refresh jobs deduplicate; source polling shares native credential reads without refreshing again',async()=>{
  let finish,refreshes=0,reads=0;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const service=fixture({refreshAgy:()=>{refreshes++;return waiting;},agy:{list:async()=>{reads++;return {items:[],current:{configured:false}};},history:()=>({points:[]})}});
  service.refresh('agy');service.refresh('agy');await new Promise(resolve=>setImmediate(resolve));
  const results=await Promise.all([service.read('agy'),service.read('agy'),service.read('codex')]);
  assert.equal(refreshes,1);assert.equal(reads,1);assert.equal(results[0].sources[0].refreshing,true);assert.equal(results[2].sources[0].accounts.length,1);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await service.read('agy')).sources[0].refreshing,false);assert.equal(reads,2);assert.equal(refreshes,1);
  assert.throws(()=>service.refresh('grok'),/不支持/);
});

test('AGY refresh failure marks the last successful sample and a later success clears it',async()=>{
  let fail=true;
  const point={accountId:'google:user-a',at:'2026-10-25T00:00:00Z',windows:[{name:'Gemini',remainingPercent:70}]};
  const service=fixture({refreshAgy:async()=>{if(fail)throw Error('quota unavailable');},agy:{
    list:async()=>({items:[],current:{configured:true,quotaAccountId:point.accountId}}),history:()=>({points:[point]}),
  }});
  service.refresh('agy');await new Promise(resolve=>setImmediate(resolve));
  const row=(await service.read('agy')).sources[0].accounts[0];
  assert.equal(row.stale,true);assert.equal(row.reason,'quota unavailable');assert.equal(Date.parse(row.updatedAt),Date.parse(point.at));assert.equal(row.windows[0].remainingPercent,70);
  fail=false;service.refresh('agy');await new Promise(resolve=>setImmediate(resolve));
  const recovered=(await service.read('agy')).sources[0].accounts[0];
  assert.equal(recovered.stale,false);assert.equal(recovered.reason,null);
});

test('source catalog exposes refresh capabilities without reading accounts or querying providers',()=>{
  const service=fixture({store:{accounts:()=>{throw Error('must not read credentials');}}});
  const sources=service.catalog().sources;
  assert.equal(sources.find(source=>source.source==='codex').supported,true);
  assert.equal(sources.find(source=>source.source==='grok').refreshable,false);
  service.refreshers.grok=async()=>{};
  assert.equal(service.catalog().sources.find(source=>source.source==='grok').supported,true);
});
