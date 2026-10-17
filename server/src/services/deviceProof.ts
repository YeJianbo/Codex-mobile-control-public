import { X509Certificate, verify } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

const seen=new Map<string,number>();
const certificates=new Map<string,X509Certificate>();
export function verifyDeviceProof(certificateBase64:string,method:string,url:string,headers:IncomingHttpHeaders):boolean {
  const time=Number(headers['x-device-time']);
  const nonce=headers['x-device-nonce'];
  const signature=headers['x-device-signature'];
  if(!Number.isFinite(time)||Math.abs(Date.now()-time)>120_000||typeof nonce!=='string'||!/^[-_a-zA-Z0-9]{12,80}$/.test(nonce)||typeof signature!=='string')return false;
  const key=`${certificateBase64.slice(0,48)}:${nonce}`;
  const now=Date.now();
  for(const [id,expires] of seen)if(expires<now)seen.delete(id);
  if(seen.has(key))return false;
  try {
    let cert=certificates.get(certificateBase64);
    if(!cert){
      cert=new X509Certificate(Buffer.from(certificateBase64,'base64'));
      if(certificates.size>=64)certificates.delete(certificates.keys().next().value!);
      certificates.set(certificateBase64,cert);
    }
    if(Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<now)return false;
    const message=`${method.toUpperCase()}\n${url}\n${time}\n${nonce}`;
    const ok=verify('sha256',Buffer.from(message),cert.publicKey,Buffer.from(signature,'base64'));
    if(ok)seen.set(key,now+120_000);
    return ok;
  }catch{return false;}
}
