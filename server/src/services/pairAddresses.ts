import os from 'node:os';
export function pairAddresses(host:string,port:number,https:boolean) {
  const scheme=https?'https':'http';
  if(host!=='0.0.0.0' && host!=='::') return [{name:host,url:`${scheme}://${host.includes(':')?'['+host+']':host}:${port}`}];
  return Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items||[])
    .filter(i=>!i.internal && i.family==='IPv4' && !i.address.startsWith('169.254.'))
    .map(i=>({name,url:`${scheme}://${i.address}:${port}`,score:/vmware|vbox|virtual|vethernet|tap|tun|meta|docker|wsl|vpn/i.test(name)?2:0})))
    .sort((a,b)=>a.score-b.score).map(({name,url})=>({name,url}));
}
