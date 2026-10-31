// Official Codex credit rates, not API dollar prices. Subscription speed
// weighting differs from purchased-credit billing.
export const CREDIT_RATE_SOURCE='https://learn.chatgpt.com/docs/pricing';
export const CREDIT_RATE_DATE='2026-10-26';
const rates={
  'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],
  'gpt-6-sol':[50,5,250],'gpt-6-luna':[2.5,.25,12.5],
  'gpt-5.6-sol':[100,10,500],'gpt-5.6-terra':[50,5,300],
  'gpt-5.6-luna':[5,.5,30],'daybreak-blue':[100,10,500],
  'daybreak-red':[312.5,31.25,1875],'gpt-rosalind-research':[125,12.5,625]
};
export function estimateCredits(row){
  const rate=rates[row.model],input=row.inputTokens,cached=row.cachedTokens,output=row.outputTokens;
  if(!rate||![input,cached,output].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||cached>input)return null;
  const tier=row.tier;
  if(!['standard','default','fast','priority','ultrafast'].includes(tier))return null;
  if(tier==='ultrafast'&&!['gpt-6-astra','gpt-6.1-sol'].includes(row.model))return null;
  const base=((input-cached)*rate[0]+cached*rate[1]+output*rate[2])/1e6;
  const fast=tier==='fast'||tier==='priority',ultra=tier==='ultrafast';
  return {purchased:base*(ultra?6:fast?2:1),subscription:base*(ultra?8:fast?2.5:1)};
}

// A partial local request journal can establish a lower bound, never the
// account's exact subscription budget. Accumulate only within one reset cycle.
export function subscriptionEstimate(points){
  const result={basis:'observed-lower-bound',rateDate:CREDIT_RATE_DATE,rateSource:CREDIT_RATE_SOURCE,windows:[]};
  for(const [key,label] of [['primary','5h'],['secondary','7d']]){
    const cycles=new Map();
    for(const point of points){
      const sample=point.calibration?.[key];if(!sample||!(sample.credits>0)||!(sample.percent>0)||!sample.resetAt)continue;
      const id=JSON.stringify([point.plan,sample.resetAt]),cycle=cycles.get(id)||{credits:0,percent:0,intervals:0,requests:0};
      cycle.credits+=sample.credits;cycle.percent+=sample.percent;cycle.intervals++;cycle.requests+=sample.requests;cycles.set(id,cycle);
    }
    const candidates=[...cycles.values()].filter(c=>c.percent>=5&&c.intervals>=2&&c.requests>=3)
      // Samples can have gaps. Allow rounding at both ends of each observed
      // interval rather than assume all intervals share their boundaries.
      .map(c=>({...c,total:100*c.credits/(c.percent+2*c.intervals)})).sort((a,b)=>b.total-a.total);
    const best=candidates[0];
    result.windows.push({name:label,state:best?'estimated':'collecting',minimumCredits:best?.total??null,
      observedPercent:best?.percent??0,requests:best?.requests??0,intervals:best?.intervals??0});
  }
  return result;
}

// Reconstruct non-overlapping calibration intervals from already sampled quota
// history. Short individual samples often contain only one native token event,
// which cannot establish when its cumulative delta began.
export function historicalCalibration(history,accountKey,plan,requestsForInterval,{since=0,intervalSeconds=3600}={}){
  const result=[];
  for(const key of ['primary','secondary']){
    let first=null,previous=null;
    for(const row of history){
      if(!Number.isFinite(row?.timestamp)||row.timestamp<since)continue;
      const reset=row[key+'ResetAt'],balance=row.credits?.balance,used=row[key+'UsedPercent'];
      const usable=row.accountKey===accountKey&&row.plan===plan&&reset!=null&&balance!=null&&Number.isFinite(used);
      if(!usable){first=previous=null;continue;}
      if(!first||!previous||row.timestamp<previous.timestamp||row.timestamp-previous.timestamp>900||reset!==first[key+'ResetAt']||balance!==first.credits.balance){first=row;previous=row;continue;}
      previous=row;
      if(row.timestamp-first.timestamp<intervalSeconds)continue;
      const delta=used-first[key+'UsedPercent'];
      if(delta>0&&delta<=100&&used<100){
        const requests=requestsForInterval(first.timestamp*1000,row.timestamp*1000,key,reset,balance);
        const quotes=requests.map(estimateCredits).filter(Boolean);
        if(quotes.length)result.push({plan,calibration:{[key]:{resetAt:reset,percent:delta,credits:quotes.reduce((sum,q)=>sum+q.subscription,0),requests:quotes.length}}});
      }
      first=row;
    }
  }
  return result;
}

export function creditConsumption(points){
  let consumed=0,added=0,intervals=0,previous=null;
  for(const point of points){
    const balance=point.credits?.unlimited?null:point.credits?.balance;
    if(typeof balance!=='number'||!Number.isFinite(balance)){previous=null;continue;}
    if(previous!==null){const delta=previous-balance;if(delta>=0)consumed+=delta;else added-=delta;intervals++;}
    previous=balance;
  }
  return {consumed,added,intervals,basis:'sampled-balance-deltas'};
}
