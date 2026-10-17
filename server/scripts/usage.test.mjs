import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
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

test('quota history shares concurrent reads and refreshes after file or account changes',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-quota-read-'));
  const previous=process.env.CODEX_HOME,previousApp=process.env.CODEX_MOBILE_CONTROL_HOME,readFile=fs.readFile;
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const directory=path.join(home,'codexmate','local-console'),file=path.join(directory,'quota-history.jsonl');
  const at=Math.floor(Date.now()/1000)-1800;
  const row=(account,offset,used)=>JSON.stringify({accountKey:`email::${account}`,timestamp:at+offset,primaryUsedPercent:used});
  let reads=0,fail=false,reader;
  try{
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({tokens:{account_id:'A'}}));
    await fs.writeFile(file,[row('A',-2*86400,20),row('A',0,30),row('B',0,90),'malformed'].join('\n'));
    fs.readFile=async function(target,...args){if(target===file){reads++;if(fail){fail=false;throw Error('temporary read failure');}}return readFile.call(this,target,...args);};
    reader=new UsageReader({request:async()=>({rateLimits:{}})});
    const results=await Promise.all(Array.from({length:20},()=>reader.read(undefined,7)));
    assert.equal(reads,1);
    for(const result of results)assert.deepEqual(result.quotaTrend.map(row=>row.remainingPercent),[80,70]);
    assert.deepEqual((await reader.read(undefined,1)).quotaTrend.map(row=>row.remainingPercent),[70]);
    assert.equal(reads,1,'Changing the date range reuses the parsed file');
    await fs.appendFile(file,'\n'+row('A',600,40));
    assert.deepEqual((await reader.read(undefined,1)).quotaTrend.map(row=>row.remainingPercent),[70,60]);
    assert.equal(reads,2);
    await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({tokens:{account_id:'B'}}));
    assert.deepEqual((await reader.read(undefined,7)).quotaTrend.map(row=>row.remainingPercent),[10]);
    assert.equal(reads,3);
    await fs.writeFile(file,row('B',1200,55)+'\n');fail=true;
    assert.deepEqual((await reader.read()).quotaTrend,[]);
    assert.deepEqual((await reader.read()).quotaTrend.map(row=>row.remainingPercent),[45]);
    assert.equal(reads,5,'A failed read is retried instead of caching empty results or returning the old file');
    console.log(JSON.stringify({concurrentUsageReads:20,historyFileReads:1,rangeChangeExtraReads:0,appendAndAccountSwitch:true,truncateAndRetry:true}));
  }finally{
    fs.readFile=readFile;reader?.close();
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    if(previousApp===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousApp;
    assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('trend migration preserves unattributed samples and separates accounts in the same bucket',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-quota-accounts-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const file=path.join(home,'usage-trends.sqlite'),now=Date.now(),bucket=Math.floor(now/300000)*300000;
  let trends;
  try{
    const old=new DatabaseSync(file);
    old.exec('CREATE TABLE quota_samples(bucket INTEGER NOT NULL,name TEXT NOT NULL,duration_mins INTEGER NOT NULL,remaining_percent REAL NOT NULL,PRIMARY KEY(bucket,name,duration_mins)); CREATE INDEX quota_samples_bucket ON quota_samples(bucket)');
    old.prepare('INSERT INTO quota_samples VALUES (?,?,?,?)').run(bucket,'Codex',300,93);old.close();
    trends=new UsageTrends();
    const sample=remainingPercent=>[{name:'Codex',durationMins:300,remainingPercent}];
    assert.deepEqual(trends.read(1,now,'A'),[]);
    assert.deepEqual(trends.read(1,now).map(row=>row.remainingPercent),[93]);
    trends.record(sample(80),now,'A');trends.record(sample(20),now,'B');trends.record(sample(79),now,'A');
    assert.deepEqual(trends.read(1,now,'A').map(row=>row.remainingPercent),[79]);
    assert.deepEqual(trends.read(1,now,'B').map(row=>row.remainingPercent),[20]);
    trends.close();trends=new UsageTrends();
    assert.deepEqual(trends.read(1,now,'B').map(row=>row.remainingPercent),[20]);
    assert.deepEqual(trends.read(1,now).map(row=>row.remainingPercent),[93]);
    const db=new DatabaseSync(file,{readOnly:true});
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM quota_samples').get().count,3);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
  }finally{
    trends?.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(home,{recursive:true,force:true});
  }
});

test('account switches invalidate cached quota and late RPCs cannot populate the next account',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-quota-switch-')),previous=process.env.CODEX_HOME,previousApp=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_HOME=home;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  let reader,replyA,calls=0;
  const limits=usedPercent=>({rateLimits:{primary:{usedPercent,windowDurationMins:300}}});
  const select=account=>fs.writeFile(path.join(home,'auth.json'),JSON.stringify({tokens:{account_id:account}}));
  try{
    await select('A');
    reader=new UsageReader({request:async method=>{assert.equal(method,'account/rateLimits/read');calls++;return calls===1?new Promise(resolve=>{replyA=resolve}):limits(calls===2?60:10);}});
    await reader.read();assert.equal(calls,1);
    const directory=path.join(home,'codexmate','local-console');await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'quota-current.json'),JSON.stringify({accountKey:'email::B',primary:{used_percent:20,limit_window_seconds:18000}}));
    await select('B');
    const waiting=await reader.read();
    assert.equal(waiting.quota.windows[0].remainingPercent,80);assert.equal(waiting.quota.stale,true);assert.equal(calls,1);
    replyA(limits(1));await new Promise(resolve=>setImmediate(resolve));
    async function fresh(){
      for(let attempt=0;attempt<30;attempt++){
        const result=await reader.read();if(!result.quota.stale)return result;
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      throw Error('quota did not refresh');
    }
    const b=await fresh();assert.equal(b.quota.windows[0].remainingPercent,40);
    assert.deepEqual(b.quotaTrend.map(row=>row.remainingPercent),[40]);assert.equal(calls,2);
    await select('A');
    const a=await fresh();assert.equal(a.quota.windows[0].remainingPercent,90);
    assert.deepEqual(a.quotaTrend.map(row=>row.remainingPercent),[90]);assert.equal(calls,3);
    console.log(JSON.stringify({accountSwitch:'A-B-A',lateRpcDiscarded:true,trendAccountsIsolated:true}));
  }finally{
    reader?.close();if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    if(previousApp===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousApp;
    assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(home,{recursive:true,force:true});
  }
});
