export const PRICE_DATE='2026-10-27';
export const PRICE_SOURCE='https://developers.openai.com/api/docs/pricing';
// USD per million tokens; current list prices, not historical billing or reseller charges.
export const TOKEN_PRICES={
  'gpt-6-astra':{input:10,cached:1,output:50,fast:2},
  'gpt-6.1-sol':{input:2,cached:.1,output:10,fast:2},
  'gpt-6.1-terra':{input:1,cached:.05,output:5,fast:2},
  'gpt-6-sol':{input:2,cached:.2,output:10,fast:2},
  'gpt-6-luna':{input:.1,cached:.01,output:.5,fast:2},
  'gpt-5.6-sol':{input:4,cached:.4,output:20,fast:2},
  'gpt-5.6-terra':{input:2,cached:.2,output:12,fast:2},
  'gpt-5.6-luna':{input:.2,cached:.02,output:1.2,fast:2},
  'gpt-5.5':{input:5,cached:.5,output:30,sessionLong:true},
  'gpt-5.4':{input:2.5,cached:.25,output:15,sessionLong:true},
};
export function priceModel(model){const id=String(model||'').split('::').at(-1);return id==='gpt-5.6'?'gpt-5.6-sol':id;}
export const priceGroupKey=r=>JSON.stringify([r.model,r.tier,r.effort,Number(r.pending)||0]);
export const CODEX_PRICE_SOURCE='https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing';
// User-specified subscription estimate: GPT-6 cache reads cost twice the API rate.
const codexCacheMultiplier=model=>/^gpt-6(?:[.-]|$)/.test(model)?2:1;
export function estimateTokenCost(row,basis='api'){
  const model=priceModel(row.model),rate=TOKEN_PRICES[model];
  if(!rate||row.pending||row.invalid||row.cached>row.input)return null;
  const codex=basis==='codex'&&!String(row.model).includes('::');const tier=row.tier;let multiplier=1;
  if(tier==='fast'||tier==='priority'){if(codex)multiplier=model==='gpt-5.4'?2:2.5;else {if(!rate.fast)return null;multiplier=rate.fast;}}
  else if(tier==='flex'||tier==='batch'){if(codex)return null;multiplier=.5;}
  else if(tier&&!['standard','default','auto'].includes(tier))return null;
  const exemption=codex&&['gpt-6-astra','gpt-6.1-sol'].includes(model)&&!!row.longContext;const long=!!row.longContext&&!exemption,im=long?2:1,om=long?1.5:1;
  const input=(row.input-row.cached)*rate.input*im*multiplier/1e6;
  const cached=row.cached*rate.cached*(codex?codexCacheMultiplier(model):1)*im*multiplier/1e6;
  const output=row.output*rate.output*om*multiplier/1e6;
  return {usd:input+cached+output,inputUsd:input,cachedUsd:cached,outputUsd:output,assumedStandard:!tier||tier==='auto',longContext:long,pricingModel:model,codex,exemption};
}
export function tokenCosts(db,where,params,basis='api'){
  const oldLong=new Set(db.prepare("SELECT session,model FROM events WHERE kind='token' AND input>272000 AND (model LIKE '%gpt-5.4' OR model LIKE '%gpt-5.5') GROUP BY session,model").all().map(r=>JSON.stringify([r.session,r.model])));
  const rows=db.prepare(`SELECT session,model,tier,effort,CASE WHEN dim_version<2 THEN 1 ELSE 0 END pending,CASE WHEN input>272000 THEN 1 ELSE 0 END longContext,CASE WHEN cached>input THEN 1 ELSE 0 END invalid,COUNT(*) samples,SUM(input) input,SUM(cached) cached,SUM(output) output FROM events WHERE ${where} GROUP BY session,model,tier,effort,pending,longContext,invalid`).all(...params);
  const empty=()=>({usd:0,inputUsd:0,cachedUsd:0,outputUsd:0,pricedSamples:0,unpricedSamples:0,pricedTokens:0,unpricedTokens:0,assumedStandardSamples:0,longContextSamples:0,astraExemptSamples:0,solExemptSamples:0,codexSamples:0,apiSamples:0});
  const total=empty(),groups=new Map();
  for(const row of rows){if(TOKEN_PRICES[priceModel(row.model)]?.sessionLong)row.longContext=oldLong.has(JSON.stringify([row.session,row.model]));const key=priceGroupKey(row),group=groups.get(key)||empty();groups.set(key,group);const price=estimateTokenCost(row,basis),tokens=row.input+row.output;
    for(const target of [total,group]){if(!price){target.unpricedSamples+=row.samples;target.unpricedTokens+=tokens;continue;}for(const k of ['usd','inputUsd','cachedUsd','outputUsd'])target[k]+=price[k];target.pricedSamples+=row.samples;target.pricedTokens+=tokens;if(price.assumedStandard)target.assumedStandardSamples+=row.samples;if(price.longContext)target.longContextSamples+=row.samples;if(price.exemption){if(price.pricingModel==='gpt-6-astra')target.astraExemptSamples+=row.samples;else if(price.pricingModel==='gpt-6.1-sol')target.solExemptSamples+=row.samples;}if(price.codex)target.codexSamples+=row.samples;else target.apiSamples+=row.samples;}
  }
  for(const r of [total,...groups.values()])if(!r.pricedSamples)r.usd=null;
  return {total,groups,basis,date:PRICE_DATE,source:basis==='codex'?CODEX_PRICE_SOURCE:PRICE_SOURCE,rates:Object.entries(TOKEN_PRICES).map(([model,rate])=>({model,...rate,cached:rate.cached*(basis==='codex'?codexCacheMultiplier(model):1)})),currency:'USD'};
}
