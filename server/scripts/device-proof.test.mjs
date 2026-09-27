import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign} from 'node:crypto';
import selfsigned from 'selfsigned';
import {verifyDeviceProof} from '../src/services/deviceProof.ts';

test('device proof binds method, URL, time and nonce to a registered certificate',async()=>{
  const issued=await selfsigned.generate([{name:'commonName',value:'test phone'}],{keySize:2048});
  const certificate=Buffer.from(issued.cert).toString('base64');
  const time=Date.now();
  const nonce='fresh-device-nonce-1234';
  const path='/api/projects/p/file?path=src%2Fmain.kt';
  const message=`GET\n${path}\n${time}\n${nonce}`;
  const signer=createSign('sha256');signer.update(message);signer.end();
  const headers={'x-device-time':String(time),'x-device-nonce':nonce,'x-device-signature':signer.sign(issued.private).toString('base64')};
  assert.equal(verifyDeviceProof(certificate,'GET',path,headers),true);
  assert.equal(verifyDeviceProof(certificate,'GET',path,headers),false,'replayed nonce');
  assert.equal(verifyDeviceProof(certificate,'PUT',path,{...headers,'x-device-nonce':'fresh-device-nonce-5678'}),false,'method changed');
  assert.equal(verifyDeviceProof(certificate,'GET','/api/projects/p/file?path=outside',{...headers,'x-device-nonce':'fresh-device-nonce-9012'}),false,'path changed');
  assert.equal(verifyDeviceProof(certificate,'GET',path,{...headers,'x-device-time':String(time-180000),'x-device-nonce':'fresh-device-nonce-3456'}),false,'expired proof');
});
