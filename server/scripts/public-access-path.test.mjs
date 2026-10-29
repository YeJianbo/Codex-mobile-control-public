import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePublicAccessUrl,publicAccessRequestTarget} from '../src/services/publicAccessUrl.ts';
import {deviceProofTarget} from '../src/services/deviceProof.ts';

const secret='test-only-prefix-'.repeat(3);
const base='https://phone.example.com/'+secret;

test('a secret prefix preserves the exact signed query and requires a segment boundary',()=>{
  assert.equal(normalizePublicAccessUrl(base+'/'),base);
  for(const target of ['/api/projects','/ws?token=x&thread=a%2Fb','/api/projects/p/file?path=src%2Fmain.kt'])
    assert.equal(publicAccessRequestTarget('/'+secret+target,base),target);
  for(const target of ['/api/projects','/'+secret+'extra/api/projects','/wrong/api/projects','/'+secret+'/../api/projects','/'+secret+'/%2e%2e/api/projects','/'+secret+'%2f/api/projects','/'+secret+'/\\api/projects','https://phone.example.com/'+secret+'/api/projects'])
    assert.equal(publicAccessRequestTarget(target,base),null,target);
  assert.equal(publicAccessRequestTarget('/api/projects','https://phone.example.com'),'/api/projects');
});

test('only the authenticated proxy can supply the external signed target',()=>{
  const raw='/'+secret+'/ws?token=x',route='/ws?token=x';
  assert.equal(deviceProofTarget(route,{'x-public-request-target':raw},'proxy'),route);
  assert.equal(deviceProofTarget(route,{'x-public-request-target':raw,'x-public-proxy-secret':'wrong'},'proxy'),route);
  assert.equal(deviceProofTarget(route,{'x-public-request-target':raw,'x-public-proxy-secret':'proxy'},'proxy'),raw);
});
