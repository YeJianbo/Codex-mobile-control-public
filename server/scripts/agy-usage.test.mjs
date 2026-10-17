import test from 'node:test';
import assert from 'node:assert/strict';
import {AgyUsageReader,agyQuotaWindows} from '../src/services/agyUsage.ts';
const record={status:'SUCCESS',command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets:[{window:'5h',remaining_fraction:.09,reset_time:'2026-10-18T03:45:27Z'},{window:'weekly',remaining_fraction:1}]},{name:'Claude and GPT models',buckets:[{window:'5h',remaining_fraction:.5}]}]}}};
test('AGY quota keeps exact fractions, reset times and model group; caches concurrent reads and stale failures',async()=>{
  const rows=agyQuotaWindows(record);assert.equal(rows[0].durationMins,300);assert.equal(rows[0].remainingPercent,9);assert.equal(rows[0].resetsAt,Date.parse('2026-10-18T03:45:27Z')/1000);assert.equal(rows[1].durationMins,10080);
  let calls=0,failed=false;const reader=new AgyUsageReader(async()=>'agy',async(_command,args)=>{calls++;assert.deepEqual(args,['-p','/usage','--output-format','json']);await new Promise(r=>setTimeout(r,5));if(failed)throw Error('timeout');return {exitCode:0,stdout:JSON.stringify(record)};});
  const [gemini,claude]=await Promise.all([reader.read('antigravity::gemini-next'),reader.read('claude-opus')]);assert.equal(calls,1);assert.equal(gemini.windows.length,2);assert.equal(claude.windows.length,1);assert.equal(claude.windows[0].remainingPercent,50);assert.equal(gemini.stale,false);
  assert.deepEqual(await reader.read('gemini-next'),gemini);assert.equal(calls,1);failed=true;reader.readAt=0;await reader.read('gemini-next');await reader.pending;
  const stale=await reader.read('gemini-next');assert.equal(stale.stale,true);assert.deepEqual(stale.windows,gemini.windows);assert.equal(calls,2);
  assert.throws(()=>agyQuotaWindows({status:'FAILED'}));assert.deepEqual(agyQuotaWindows({status:'SUCCESS',command:{name:'usage',data:{groups:[{buckets:[{remaining_fraction:2},{remaining_fraction:'0.2'}]}]}}}),[]);
});
