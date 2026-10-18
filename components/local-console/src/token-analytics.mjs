import {tokenCosts,priceGroupKey} from './token-pricing.mjs';
const dimensionColumns=['model','tier','effort'];
export function tokenAnalytics(db,since,until,filters={}){
  const params=[since,until];let where="kind='token' AND time>=? AND time<=?";
  for(const column of dimensionColumns){const value=filters[column];if(value==null||value==='all'||value==='')continue;if(typeof value!=='string'||value.length>500)throw new Error('Token 筛选值无效');if(value==='missing')where+=` AND dim_version>=2 AND ${column} IS NULL`;else if(value==='pending')where+=' AND dim_version<2';else if(value.startsWith('v:')){where+=` AND dim_version>=2 AND ${column}=?`;params.push(value.slice(2));}else throw new Error('Token 筛选值无效');}
  const sums='COUNT(*) samples,COALESCE(SUM(input),0) input,COALESCE(SUM(cached),0) cached,COALESCE(SUM(output),0) output,COALESCE(SUM(reasoning),0) reasoning';
  const enrich=r=>({...r,total:r.input+r.output,uncached:r.cached<=r.input?r.input-r.cached:null,cacheHitRate:r.input>0&&r.cached<=r.input?r.cached/r.input:null,reasoningShare:r.output>0&&r.reasoning<=r.output?r.reasoning/r.output:null,cacheAnomaly:r.cached>r.input});
  const totals=enrich(db.prepare(`SELECT ${sums} FROM events WHERE ${where}`).get(...params));
  const series=db.prepare(`SELECT strftime('%Y-%m-%d',time/1000,'unixepoch','localtime') date,${sums} FROM events WHERE ${where} GROUP BY date ORDER BY date`).all(...params).map(enrich);
  const modelSeries=db.prepare(`SELECT strftime('%Y-%m-%d',time/1000,'unixepoch','localtime') date,strftime('%Y-%m-%dT%H',time/1000,'unixepoch','localtime') hour,model,${sums} FROM events WHERE ${where} GROUP BY date,hour,model ORDER BY hour`).all(...params).map(enrich);
  const groups=db.prepare(`SELECT model,tier,effort,CASE WHEN dim_version<2 THEN 1 ELSE 0 END pending,${sums} FROM events WHERE ${where} GROUP BY model,tier,effort,pending ORDER BY SUM(input)+SUM(output) DESC LIMIT 101`).all(...params).map(enrich);
  const modelGroups=db.prepare(`SELECT model,CASE WHEN dim_version<2 THEN 1 ELSE 0 END pending,${sums} FROM events WHERE ${where} GROUP BY model,pending ORDER BY SUM(input)+SUM(output) DESC`).all(...params).map(enrich);
  const coverage=db.prepare("SELECT COUNT(*) samples,SUM(CASE WHEN dim_version>=2 THEN 1 ELSE 0 END) enriched FROM events WHERE kind='token' AND time>=? AND time<=?").get(since,until);
  const options={};for(const column of dimensionColumns){const values=db.prepare(`SELECT DISTINCT ${column} value FROM events WHERE kind='token' AND time>=? AND time<=? AND dim_version>=2 ORDER BY value`).all(since,until);options[column]=values.map(r=>({value:r.value==null?'missing':'v:'+r.value,label:r.value??'未记录'}));if(coverage.enriched<coverage.samples)options[column].push({value:'pending',label:'待回填'});}
  const basis=filters.pricing||'codex';if(!['codex','api'].includes(basis))throw new Error('计价口径无效');const costs=tokenCosts(db,where,params,basis);for(const r of groups)r.cost=costs.groups.get(priceGroupKey(r));
  const modelCosts=new Map();for(const [key,cost] of costs.groups){const [model,,,pending]=JSON.parse(key),id=JSON.stringify([model,pending]);const sum=modelCosts.get(id)||{usd:0,pricedSamples:0,unpricedSamples:0};sum.usd+=(cost.usd||0);sum.pricedSamples+=cost.pricedSamples;sum.unpricedSamples+=cost.unpricedSamples;modelCosts.set(id,sum);}
  for(const r of modelGroups){const cost=modelCosts.get(JSON.stringify([r.model,r.pending]));r.cost=cost?{...cost,usd:cost.pricedSamples?cost.usd:null}:null;}
  return {cost:{...costs.total,basis:costs.basis,date:costs.date,source:costs.source,currency:costs.currency,rates:costs.rates},totals,series,modelSeries,groups:groups.slice(0,100),groupsTruncated:groups.length>100,modelGroups,options,coverage:{samples:coverage.samples,enriched:coverage.enriched||0},filters};
}
