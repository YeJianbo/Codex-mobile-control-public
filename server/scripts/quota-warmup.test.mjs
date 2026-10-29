import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QuotaWarmup,sendQuotaWarmup} from '../../components/local-console/src/quota-warmup.mjs';
import {UsageService} from '../../components/local-console/src/usage.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-warmup-'));
  t.after(()=>{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir()))throw Error('Unexpected fixture directory');fs.rmSync(dir,{recursive:true,force:true});});
  let account='A',time=2_000_000_000_000,record,available=true,sends=0,refreshes=0;
  const store={dir,data:{quotaWarmupEnabled:true},save(){}};
  const snapshot=(used,reset,primaryUsed=40,primaryReset=1000)=>({accountKey:account,at:new Date(time).toISOString(),
    secondary:{used_percent:used,reset_at:time/1000+reset,limit_window_seconds:604800},
    primary:{used_percent:primaryUsed,reset_at:time/1000+primaryReset,limit_window_seconds:18000}});
  record=snapshot(40,100);
  const usage={async refresh(){refreshes++;return record;}};
  const options={now:()=>time,identity:()=>account,idle:async()=>available,send:async()=>{sends++;return {model:'gpt-6.1-sol'};}};
  const service=new QuotaWarmup(store,usage,options);t.after(()=>service.stop());
  return {store,usage,service,options,snapshot,set record(v){record=v;},set idle(v){available=v;},set account(v){account=v;},
    advance(ms){time+=ms;},at(ms){time=ms;},get sends(){return sends;},get refreshes(){return refreshes;}};
}

test('official reset triggers once, including after process restart; a timer alone does not',async t=>{
  const f=fixture(t);await f.service.tick();assert.equal(f.sends,0);
  f.advance(101000);await f.service.tick();assert.equal(f.sends,0,'expired timestamp with unchanged official usage is not confirmation');
  f.record=f.snapshot(0,604800);await f.service.tick();assert.equal(f.sends,1);
  await f.service.tick();assert.equal(f.sends,1);
  f.record=f.snapshot(0,608400);await f.service.tick();assert.equal(f.sends,2,'an early official deadline reset is recognized even with prior zero usage');
  const restarted=new QuotaWarmup(f.store,f.usage,f.options);t.after(()=>restarted.stop());
  await restarted.tick();assert.equal(f.sends,2);
});

test('busy work postpones warming and a natural request covers the reset',async t=>{
  const f=fixture(t);await f.service.tick();f.idle=false;f.record=f.snapshot(0,604800);await f.service.tick();
  assert.equal(f.service.state().status,'waiting-idle');assert.equal(f.sends,0);
  f.record=f.snapshot(1,604800);f.idle=true;await f.service.tick();assert.equal(f.service.state().status,'covered');assert.equal(f.sends,0);
});

test('5h is optional and simultaneous selected resets share one request',async t=>{
  const f=fixture(t);await f.service.tick();f.record=f.snapshot(40,100,0,-1);await f.service.tick();assert.equal(f.sends,0);
  f.store.data.quotaWarmupWindows=['weekly','fiveHour'];f.record=f.snapshot(0,604800,0,-1);await f.service.tick();
  assert.equal(f.sends,1);assert.deepEqual(new Set(f.service.state().lastAttempt.windows),new Set(['weekly','fiveHour']));
});

test('scheduled 5h warmup starts an empty bucket and persists its slot',async t=>{
  const f=fixture(t);f.store.data.quotaWarmupWindows=['fiveHour'];
  f.store.data.quotaWarmupFiveHourSchedule={enabled:true,times:['08:00','13:00','18:00'],timeZone:'UTC'};
  f.at(Date.parse('2026-10-22T07:59:00Z'));f.record=f.snapshot(40,100,0,-1);
  await f.service.tick();assert.equal(f.sends,0);assert.equal(f.service.state().status,'waiting-time');
  f.advance(60000);await f.service.tick();assert.equal(f.sends,1);
  f.record=f.snapshot(40,100,0,18000);await f.service.tick();assert.equal(f.sends,1,'the request moving reset_at is not another reset');
  const restarted=new QuotaWarmup(f.store,f.usage,f.options);t.after(()=>restarted.stop());
  await restarted.tick();assert.equal(f.sends,1,'unchanged official bucket is not warmed again');
  f.advance(18000000);await restarted.tick();assert.equal(f.sends,2,'an elapsed zero-usage window can restart before the API moves its deadline');
  f.at(Date.parse('2026-10-22T23:00:00Z'));f.record=f.snapshot(40,100,0,-1);
  await restarted.tick();assert.equal(f.sends,2,'the end boundary is excluded');
  f.at(Date.parse('2026-10-23T08:00:00Z'));await restarted.tick();assert.equal(f.sends,3);
});

test('overnight slots use their saved timezone; dispatch crossing expiry is postponed',async t=>{
  const f=fixture(t);f.store.data.quotaWarmupWindows=['fiveHour'];
  f.store.data.quotaWarmupFiveHourSchedule={enabled:true,times:['22:00','01:00'],timeZone:'Asia/Singapore'};
  f.at(Date.parse('2026-10-22T13:59:00Z'));f.record=f.snapshot(40,100,0,-1);await f.service.tick();assert.equal(f.sends,0);
  f.advance(60000);await f.service.tick();assert.equal(f.sends,1);
  f.at(Date.parse('2026-10-22T21:59:00Z'));f.record=f.snapshot(40,100,0,-1);
  let admissions=0;f.service.idle=async()=>{if(++admissions===2)f.advance(60000);return true;};
  await f.service.tick();assert.equal(f.sends,1);assert.equal(f.service.state().status,'waiting-time');
});

test('invalid hours cannot partially change settings and old clients retain hours',t=>{
  const f=fixture(t),hours={enabled:true,start:'08:00',end:'23:00',timeZone:'UTC'};
  f.service.configure({enabled:false,windows:['fiveHour'],activeHours:hours});
  assert.throws(()=>f.service.configure({enabled:true,activeHours:{...hours,end:'08:00'}}),/有效/);
  assert.equal(f.service.state().enabled,false);
  f.service.configure({enabled:false,windows:['weekly']});assert.deepEqual(f.service.state().activeHours,hours);
});

test('account changes, stale quota and disabling during admission cannot send',async t=>{
  const f=fixture(t);await f.service.tick();f.record=f.snapshot(0,604800);
  f.options.idle=async()=>{f.account='B';return true;};
  const service=new QuotaWarmup(f.store,f.usage,f.options);t.after(()=>service.stop());
  await service.tick();assert.equal(f.sends,0);
  f.account='A';service.idle=async()=>{service.configure({enabled:false});return true;};
  await service.tick();assert.equal(f.sends,0);const reads=f.refreshes;await service.tick();assert.equal(f.refreshes,reads);
});

test('unknown send outcome is persisted before dispatch and never replayed',async t=>{
  const f=fixture(t);await f.service.tick();f.record=f.snapshot(0,604800);let attempts=0;
  f.service.send=async()=>{attempts++;throw Error('Connection lost');};await f.service.tick();await f.service.tick();
  assert.equal(f.service.state().status,'uncertain');assert.equal(attempts,1);
  const restarted=new QuotaWarmup(f.store,f.usage,{...f.options,send:f.service.send});t.after(()=>restarted.stop());
  await restarted.tick();assert.equal(attempts,1);
});

test('warming uses only the official account endpoint with no tools and verifies stream completion',async()=>{
  const rows=[],store={auth:()=>({tokens:{account_id:'A',access_token:'fixture'}}),models:()=>[{slug:'gpt-6.1-sol'}]};
  const usage={recordRequest:row=>rows.push(row)};
  const complete='data: '+JSON.stringify({type:'response.completed',response:{service_tier:'default',usage:{input_tokens:4,output_tokens:1}}})+'\n\n';
  await sendQuotaWarmup(store,usage,'A',new AbortController().signal,{fetchImpl:async(url,init)=>{
    assert.equal(url,'https://chatgpt.com/backend-api/codex/responses');assert.equal(init.headers['ChatGPT-Account-Id'],'A');
    const body=JSON.parse(init.body);assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.store,false);assert.equal(body.model,'gpt-6.1-sol');
    return new Response(complete,{headers:{'content-type':'text/event-stream'}});
  }});
  assert.equal(rows[0].outputTokens,undefined);assert.equal(rows[0].usage.output_tokens,1);assert.equal(rows[0].errorCode,null);
  await assert.rejects(()=>sendQuotaWarmup(store,usage,'A',new AbortController().signal,{fetchImpl:async()=>new Response('data: {}\n\n',{headers:{'content-type':'text/event-stream'}})}));
  await assert.rejects(()=>sendQuotaWarmup(store,usage,'B',new AbortController().signal),/账号已变化/);
});

test('warmup probes do not flood quota history and a concurrent normal refresh retains its sample',async t=>{
  const f=fixture(t);f.store.home=f.store.dir;
  const auth={tokens:{account_id:'A',access_token:'fixture'}};f.store.auth=()=>auth;
  fs.writeFileSync(path.join(f.store.home,'auth.json'),JSON.stringify(auth));
  const response=()=>new Response(JSON.stringify({rate_limit:{secondary_window:{used_percent:20,reset_at:2_000_600_000,limit_window_seconds:604800}}}));
  const usage=new UsageService(f.store,{fetchImpl:async()=>response()});
  await usage.refresh({recordHistory:false});assert.equal(fs.existsSync(usage.historyFile),false);
  let release;usage.fetch=()=>new Promise(resolve=>{release=resolve;});
  const probe=usage.refresh({recordHistory:false}),normal=usage.refresh();release(response());
  await Promise.all([probe,normal]);
  assert.equal(fs.readFileSync(usage.historyFile,'utf8').trim().split('\n').length,1);
});

test('04/09/14/19 daily plan skips midnight; restart does not replay',async t=>{
  const f=fixture(t);f.store.data.quotaWarmupWindows=['fiveHour'];
  f.store.data.quotaWarmupFiveHourSchedule={enabled:true,times:['04:00','09:00','14:00','19:00'],timeZone:'UTC'};
  f.at(Date.parse('2026-10-22T03:59:00Z'));f.record=f.snapshot(40,100,0,-1);await f.service.tick();assert.equal(f.sends,0);
  for(const [index,hour] of ['04','09','14','19'].entries()){
    f.at(Date.parse('2026-10-22T'+hour+':00:00Z'));f.record=f.snapshot(40,100,0,-1);await f.service.tick();assert.equal(f.sends,index+1);
    f.record=f.snapshot(40,100,0,18000);await f.service.tick();assert.equal(f.sends,index+1);
  }
  const restarted=new QuotaWarmup(f.store,f.usage,f.options);t.after(()=>restarted.stop());await restarted.tick();assert.equal(f.sends,4);
  f.at(Date.parse('2026-10-23T00:00:00Z'));f.record=f.snapshot(40,100,0,-1);await restarted.tick();assert.equal(f.sends,4);
  f.at(Date.parse('2026-10-23T04:00:00Z'));await restarted.tick();assert.equal(f.sends,5);
});

test('plan waits for actual reset; a normal request covers a due slot',async t=>{
  const f=fixture(t);f.store.data.quotaWarmupWindows=['fiveHour'];
  f.store.data.quotaWarmupFiveHourSchedule={enabled:true,times:['04:00','09:00','14:00','19:00'],timeZone:'Asia/Singapore'};
  f.at(Date.parse('2026-10-22T01:00:00Z'));f.record=f.snapshot(40,100,20,600);await f.service.tick();assert.equal(f.sends,0);assert.equal(f.service.state().status,'waiting-reset');
  f.advance(600000);f.record=f.snapshot(40,100,0,-1);await f.service.tick();assert.equal(f.sends,1);
  f.at(Date.parse('2026-10-22T06:00:00Z'));f.record=f.snapshot(40,100,5,18000);await f.service.tick();assert.equal(f.sends,1);assert.equal(f.service.state().lastAttempt.state,'covered');
});

test('invalid plan/model never partially saves; older clients retain the new fields',t=>{
  const f=fixture(t),plan={enabled:true,times:['04:00','09:00','14:00','19:00'],timeZone:'UTC'};
  f.store.models=()=>[{slug:'gpt-6.1-sol'},{slug:'gpt-6-astra'},{slug:'relay::gpt-6-astra'}];
  f.service.configure({enabled:false,windows:['fiveHour'],fiveHourSchedule:plan,model:'gpt-6-astra'});
  assert.throws(()=>f.service.configure({enabled:true,fiveHourSchedule:{...plan,times:['25:00']}}),/有效/);
  assert.throws(()=>f.service.configure({enabled:true,model:'relay::gpt-6-astra'}),/官方/);assert.equal(f.service.state().enabled,false);
  f.service.configure({enabled:false,windows:['weekly']});assert.deepEqual(f.service.state().fiveHourSchedule,plan);assert.equal(f.service.state().model,'gpt-6-astra');
});

test('selected model is used exactly, recorded and never silently replaced',async()=>{
  const rows=[],store={data:{quotaWarmupModel:'gpt-6-astra'},auth:()=>({tokens:{account_id:'A',access_token:'fixture'}}),models:()=>[{slug:'gpt-6.1-sol'},{slug:'gpt-6-astra'}]};
  const usage={recordRequest:row=>rows.push(row)};
  await sendQuotaWarmup(store,usage,'A',new AbortController().signal,{fetchImpl:async(_,init)=>{
    assert.equal(JSON.parse(init.body).model,'gpt-6-astra');
    return new Response('data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:4,output_tokens:1}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  assert.equal(rows[0].model,'gpt-6-astra');store.models=()=>[{slug:'gpt-6.1-sol'}];
  await assert.rejects(()=>sendQuotaWarmup(store,usage,'A',new AbortController().signal,{fetchImpl:()=>{throw Error('must not dispatch');}}),/已不可用/);
});
