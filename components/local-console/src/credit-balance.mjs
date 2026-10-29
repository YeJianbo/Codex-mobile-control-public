// Purchased/workspace credits are a balance, separate from subscription windows
// and earned rate-limit reset credits. Missing data never implies zero.
export function normalizeCredits(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const raw=value.balance;
  const balance=(typeof raw==='number'||typeof raw==='string'&&raw.trim()!=='')?Number(raw):NaN;
  return {balance:Number.isFinite(balance)&&balance>=0?balance:null,
    unlimited:value.unlimited===true,hasCredits:typeof value.has_credits==='boolean'?value.has_credits:typeof value.hasCredits==='boolean'?value.hasCredits:null};
}
