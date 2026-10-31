import {agyPrice} from './agy-usage.mjs';

// AGY's local usage records do not contain account IDs. These are estimates
// from local activity between quota observations, not account billing data.
export function agyQuotaEstimates(points, accountId, readUsage) {
  const totals = new Map();
  const samples = points.filter(p => p.source === 'cli-live' && Number.isFinite(Date.parse(p.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const pairs=[];
  for (let i = 1; i < samples.length; i++) {
    const a=samples[i-1], b=samples[i], start=Date.parse(a.at), end=Date.parse(b.at);
    if (accountId && a.accountId===accountId && b.accountId===accountId && end>start && end-start<=2*3600000) pairs.push({a,b,start,end});
  }
  if (!pairs.length) return totals;
  // Read the local index once, not once per sample interval.
  const allRows=readUsage(pairs[0].start,pairs.at(-1).end).sort((a,b)=>a.time-b.time);
  let cursor=0;const seen=new Set();
  for (const {a,b,start,end} of pairs) {
    const usage = {gemini: [], other: []}, rows=[];
    while(cursor<allRows.length && allRows[cursor].time<=start)cursor++;
    while(cursor<allRows.length && allRows[cursor].time<=end)rows.push(allRows[cursor++]);
    for (const r of rows) {
      const id = r.messageId && JSON.stringify([r.model, r.messageId]);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const name = `${r.model || ''} ${r.displayModel || ''}`;
      const group = /gemini/i.test(name) ? 'gemini' : /claude|gpt/i.test(name) ? 'other' : null;
      if (group) usage[group].push(r);
    }
    for (const before of a.windows || []) {
      const after = (b.windows || []).find(w => w.poolId && w.poolId === before.poolId && w.window === before.window && w.resetsAt === before.resetsAt);
      if (!after || !before.resetsAt) continue;
      const delta = before.remainingPercent - after.remainingPercent;
      if (!(delta > 0 && delta <= 100)) continue;
      const group = /gemini/i.test(before.group || '') ? 'gemini' : /claude|gpt/i.test(before.group || '') ? 'other' : null;
      if (!group || !usage[group].length) continue;
      const key = JSON.stringify([before.poolId, before.window, before.resetsAt]);
      const total = totals.get(key) || {percent: 0, tokens: 0, usd: 0, priced: 0, partial: false, intervals: 0};
      total.percent += delta; total.intervals++;
      for (const row of usage[group]) {
        total.tokens += ['input', 'cached', 'cacheWrite', 'output'].reduce((n, k) => n + Math.max(0, Number(row[k]) || 0), 0);
        const price = agyPrice(row); if (price) { total.usd += price.usd; total.priced++; total.partial ||= price.partial; } else total.partial = true;
      }
      totals.set(key, total);
    }
  }
  return totals;
}
