import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {quotaWindows,tokenCounts,UsageReader} from '../src/services/usage.ts';
import {UsageTrends} from '../src/services/usageTrends.ts';

test('quota periods and missing values are preserved; percentages are remaining',()=>{
  const windows=quotaWindows({rateLimits:{primary:{usedPercent:23,windowDurationMins:10080,resetsAt:1900000000},secondary:{usedPercent:null}}});
  assert.equal(windows[0].remainingPercent,77);assert.equal(windows[0].durationMins,10080);
  assert.equal(windows[1].remainingPercent,null);
  assert.equal(quotaWindows({rateLimits:{primary:{usedPercent:10}},rateLimitsByLimitId:{codex:{primary:{usedPercent:20}}}}).length,1);
  assert.equal(tokenCounts({}).total,null);
  assert.equal(tokenCounts({total_token_usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20,reasoning_output_tokens:5,total_tokens:120}}).total,120);
});
test('token snapshot updates incrementally and cache fallback uses the active account only',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-usage-')),previous=process.env.CODEX_HOME,previousApp=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const readers=[];
  try{
    const sessions=path.join(home,'sessions');await fs.mkdir(sessions);
    const threadId='usage-'+Date.now(),file=path.join(sessions,'rollout-'+threadId+'.jsonl');
    const row=n=>JSON.stringify({type:'event_msg',timestamp:'2026-09-27T12:00:00Z',payload:{type:'token_count',info:{total_token_usage:{total_tokens:n,input_tokens:n-20,output_tokens:20},last_token_usage:{total_tokens:200},model_context_window:128000}}})+'\n';
    await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:threadId}})+'\n'+row(1000));
    const reader=new UsageReader({request:async()=>({rateLimits:{primary:{usedPercent:3,windowDurationMins:10080}}})});readers.push(reader);
    assert.equal((await reader.read(threadId)).tokens.total,1000);
    await fs.appendFile(file,row(1200));assert.equal((await reader.read(threadId)).tokens.total,1200);
    const directory=path.join(home,'codexmate','local-console');await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({tokens:{account_id:'active'}}));
    const saved={accountKey:'email::active',at:'2026-09-27T00:00:00Z',primary:{used_percent:9,limit_window_seconds:604800}};
    await fs.writeFile(path.join(directory,'quota-current.json'),JSON.stringify(saved));
    const historyAt=Math.floor((Date.now()-30*60000)/1000);
    await fs.writeFile(path.join(directory,'quota-history.jsonl'),[
      {accountKey:'email::active',timestamp:historyAt,primaryUsedPercent:null,secondaryUsedPercent:33},
      {accountKey:'email::other',timestamp:historyAt,primaryUsedPercent:1,secondaryUsedPercent:2},
      {accountKey:'email::active',timestamp:historyAt+300,primaryUsedPercent:20,secondaryUsedPercent:null},
    ].map(JSON.stringify).join('\n'));
    const failed=()=>{const value=new UsageReader({request:async()=>{throw Error('offline')}});readers.push(value);return value;};
    const result=await failed().read();assert.equal(result.quota.source,'local-console-cache');assert.equal(result.quota.windows[0].remainingPercent,91);assert.equal(result.quota.stale,true);
    assert.deepEqual(result.quotaTrend.filter(row=>row.at<=historyAt*1000+300000).map(row=>[row.durationMins,row.remainingPercent]),[[10080,67],[300,80]]);
    await fs.writeFile(path.join(directory,'quota-current.json'),JSON.stringify({...saved,accountKey:'other'}));
    assert.equal((await failed().read()).quota.windows.length,0);
  }finally{readers.forEach(reader=>reader.close());if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;if(previousApp===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousApp;if(path.dirname(home)===os.tmpdir())await fs.rm(home,{recursive:true,force:true});}
});
test('quota trend stores real samples, replaces the same five-minute bucket and filters time ranges',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-trend-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const trends=new UsageTrends();const now=Date.now();
  try{
    trends.record([{name:'Codex',durationMins:10080,remainingPercent:90}],now-2*86400000);
    trends.record([{name:'Codex',durationMins:10080,remainingPercent:80}],now);
    trends.record([{name:'Codex',durationMins:10080,remainingPercent:79}],now);
    assert.deepEqual(trends.read(1,now).map(row=>row.remainingPercent),[79]);
    assert.deepEqual(trends.read(7,now).map(row=>row.remainingPercent),[90,79]);
  }finally{trends.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
