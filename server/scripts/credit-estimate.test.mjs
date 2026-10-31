import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCredits} from '../../components/local-console/src/credit-balance.mjs';
import {estimateCredits,subscriptionEstimate,creditConsumption,historicalCalibration} from '../../components/local-console/src/credit-estimate.mjs';
import {agyQuotaEstimates} from '../../components/local-console/src/agy-quota-estimate.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {UsageService} from '../../components/local-console/src/usage.mjs';
import {nativeCreditRequests} from '../../components/local-console/src/native-credit-meter.mjs';
test('official balance remains separate from missing or unlimited data',()=>{
  assert.equal(normalizeCredits(null),null);assert.equal(normalizeCredits({balance:'0'}).balance,0);
  assert.equal(normalizeCredits({}).balance,null);assert.equal(normalizeCredits({balance:'',unlimited:true}).unlimited,true);
  const rows=[100,90,120,115].map(balance=>({credits:{balance}}));
  assert.deepEqual(creditConsumption(rows),{consumed:15,added:30,intervals:3,basis:'sampled-balance-deltas'});
});
test('subscription and purchased credits use independent speed multipliers',()=>{
  const row={model:'gpt-6.1-sol',inputTokens:1e6,cachedTokens:0,outputTokens:1e6,tier:'standard'};
  assert.deepEqual(estimateCredits(row),{purchased:300,subscription:300});
  assert.deepEqual(estimateCredits({...row,tier:'fast'}),{purchased:600,subscription:750});
  assert.deepEqual(estimateCredits({...row,tier:'ultrafast'}),{purchased:1800,subscription:2400});
  assert.equal(estimateCredits({...row,tier:null}),null);assert.equal(estimateCredits({...row,model:'unknown'}),null);
});
test('subscription calibration needs enough observations within the same plan and reset',()=>{
  const point=(reset,percent,credits)=>({plan:'pro',calibration:{primary:{resetAt:reset,percent,credits,requests:2}}});
  assert.equal(subscriptionEstimate([point(1,3,100),point(2,3,100)]).windows[0].state,'collecting');
  const result=subscriptionEstimate([point(1,3,100),point(1,3,100)]).windows[0];
  assert.equal(result.state,'estimated');assert.equal(result.minimumCredits,2000);assert.equal(result.requests,4);
  assert.equal(subscriptionEstimate([point(1,3,100),{...point(1,3,100),plan:'plus'}]).windows[0].state,'collecting');
});

test('historical calibration never joins a different account, reset or sampling gap',()=>{
  const record=(timestamp,accountKey='account',reset=1)=>({timestamp,accountKey,plan:'pro',primaryUsedPercent:timestamp/600,primaryResetAt:reset,credits:{balance:100}});
  const points=[record(0),record(600),record(1200),record(1800),record(2400),record(3000),record(3600),record(4200,'other'),record(4800),record(6600),record(7200,'account',2)];
  const rows=historicalCalibration(points,'account','pro',()=>[{model:'gpt-6.1-sol',tier:'standard',inputTokens:1000,cachedTokens:0,outputTokens:100}]);
  assert.equal(rows.length,1);assert.equal(rows[0].calibration.primary.percent,6);
});

test('AGY estimate uses only consecutive same-account observations in the same pool and cycle',()=>{
  const start=Date.parse('2026-10-01T00:00:00Z'),reset='2026-10-02T00:00:00.000Z';
  const sample=(minutes,account,remaining)=>({at:new Date(start+minutes*60000).toISOString(),source:'cli-live',accountId:account,windows:[{poolId:'pool',window:'weekly',group:'Gemini Models',resetsAt:reset,remainingPercent:remaining}]});
  const usage=()=>[{time:start+60000,model:'gemini-3.8-flash',displayModel:'Gemini 3.8 Flash',input:1000,cached:0,cacheWrite:0,output:100,messageId:'1'}];
  const valid=agyQuotaEstimates([sample(0,'a',80),sample(10,'a',75)],'a',usage);
  assert.equal(valid.get(JSON.stringify(['pool','weekly',reset])).tokens,1100);
  assert.equal(agyQuotaEstimates([sample(0,'a',80),sample(5,'b',79),sample(10,'a',75)],'a',usage).size,0);
});

test('native telemetry accepts an explicitly verified official HTTPS provider alias only',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'credit-provider-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const file=path.join(home,'activity.sqlite'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE events (kind TEXT,time INTEGER,session TEXT,model TEXT,tier TEXT,input INTEGER,cached INTEGER,output INTEGER,credit_meter TEXT)');
  const insert=db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)');
  for(const provider of ['official-http','relay'])for(const time of [1,2])insert.run('token',time,provider,'gpt-6.1-sol','standard',100,0,10,JSON.stringify({account:'account',provider}));
  db.close();
  assert.equal(nativeCreditRequests(file,'account',0,3).length,0);
  assert.deepEqual(nativeCreditRequests(file,'account',0,3,[],['openai','official-http']).map(row=>row.sessionId),['official-http']);
});

test('native index preserves credit ownership and calibrates only matching official windows',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'native-credit-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const dir=path.join(home,'console'),dbFile=path.join(dir,'analytics/activity.sqlite');
  await fs.mkdir(path.dirname(dbFile),{recursive:true});await fs.mkdir(path.join(home,'sessions'));
  await fs.writeFile(path.join(home,'auth.json'),JSON.stringify({tokens:{account_id:'account'}}));
  const start=Date.now()-600000,reset=Math.floor(start/1000)+18000;
  const lines=[];
  const line=(type,payload,offset=0)=>lines.push(JSON.stringify({type,payload,timestamp:new Date(start+offset).toISOString()}));
  line('session_meta',{id:'native-session',creator_account_id:'account',model_provider:'openai'});
  line('turn_context',{model:'gpt-6.1-sol',service_tier:'standard',turn_id:'turn'});
  for(const [i,offset] of [10000,20000,30000,70000,80000,90000].entries())line('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:(i+1)*1000,cached_input_tokens:0,output_tokens:(i+1)*100}},rate_limits:{primary:{resets_at:reset},secondary:{resets_at:reset+604800},credits:{balance:'100'}}},offset);
  await fs.writeFile(path.join(home,'sessions/rollout-meter.jsonl'),lines.join('\n')+'\n');
  await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../../components/local-console/src/analytics-worker.mjs',import.meta.url),{workerData:{home,db:dbFile}});
    let failure;worker.on('message',message=>{if(message.type==='failure')failure=new Error(message.message);});worker.on('error',reject);worker.on('exit',code=>failure?reject(failure):code?reject(new Error('worker exit '+code)):resolve());
  });
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='token' AND credit_meter IS NOT NULL").get().n,6);assert.equal(db.prepare('SELECT skipped FROM files').get().skipped,0);}finally{db.close();}
  assert.equal(nativeCreditRequests(dbFile,'other',start,start+60000).length,0);
  assert.equal(nativeCreditRequests(dbFile,'account',start,start+60000,[{sessionId:'native-session'}]).length,0);
  await fs.writeFile(path.join(dir,'quota-history.jsonl'),JSON.stringify({accountKey:'account',timestamp:start/1000,plan:'pro',primaryUsedPercent:10,secondaryUsedPercent:10,primaryResetAt:reset,secondaryResetAt:reset+604800,credits:{balance:100}})+'\n');
  let now=start+60000,used=13,balance='100';
  const service=new UsageService({home,dir,data:{},auth:()=>({tokens:{access_token:'fixture',account_id:'account'}})},{now:()=>now,fetchImpl:async()=>({ok:true,json:async()=>({plan_type:'pro',credits:{balance},rate_limit:{primary_window:{used_percent:used,reset_at:reset,limit_window_seconds:18000},secondary_window:{used_percent:used,reset_at:reset+604800,limit_window_seconds:604800}}})})});
  service.journal=()=>({db:{prepare:()=>({all:()=>[]})}});
  await service.refresh();now=start+120000;used=16;
  const record=await service.refresh();assert.equal(record.subscriptionEstimate.windows[0].state,'estimated');assert.equal(record.subscriptionEstimate.windows[0].requests,4);
  now=start+180000;balance='99';await service.refresh({recordHistory:false});
  const history=service.history('account');assert.equal(history.points.at(-1).credits.balance,99);assert.equal(history.creditUsage.consumed,1);
  // Native telemetry retains the official reset used to match each window.
  const meter=nativeCreditRequests(dbFile,'account',start,start+60000)[0].nativeMeter;
  assert.equal(meter.primaryReset,reset);assert.equal(meter.provider,'openai');
});
