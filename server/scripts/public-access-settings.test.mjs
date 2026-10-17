import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPublicAccessSettings,updatePublicAccessSettings,updatePublicAccessPassword} from '../src/services/publicAccessSettings.ts';
async function fixture(t){const home=await fs.mkdtemp(path.join(os.tmpdir(),'public-access-config-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.writeFile(path.join(home,'public-access.json'),JSON.stringify({port:48763,passwordSha256:createHash('sha256').update('old-password').digest('hex'),proxySecret:'p'.repeat(40),publicUrl:'https://old.example.com',tunnelRelay:{enabled:false}}));await fs.writeFile(path.join(home,'public-password.txt'),'old-password\n');return home;}
test('address-only updates keep the password and preserve tunnel configuration',async t=>{
  const home=await fixture(t);await updatePublicAccessSettings({publicUrl:'https://phone.example.com/'},home);
  const raw=JSON.parse(await fs.readFile(path.join(home,'public-access.json'),'utf8'));
  assert.equal(raw.publicUrl,'https://phone.example.com');assert.equal(await fs.readFile(path.join(home,'public-password.txt'),'utf8'),'old-password\n');assert.deepEqual(raw.tunnelRelay,{enabled:false});assert.equal(raw.proxySecret,'p'.repeat(40));
});
test('queued password and address updates both survive and the old password API remains compatible',async t=>{
  const home=await fixture(t);
  await Promise.all([updatePublicAccessSettings({publicUrl:'https://phone.example.com'},home),updatePublicAccessPassword('new-password',home)]);
  const raw=JSON.parse(await fs.readFile(path.join(home,'public-access.json'),'utf8'));
  assert.equal(raw.publicUrl,'https://phone.example.com');assert.equal(raw.passwordSha256,createHash('sha256').update('new-password').digest('hex'));
  assert.equal(await fs.readFile(path.join(home,'public-password.txt'),'utf8'),'new-password\n');
  assert.deepEqual(await readPublicAccessSettings(home),{configured:true,publicUrl:'https://phone.example.com'});
});
test('invalid destinations and passwords leave both saved files unchanged',async t=>{
  const home=await fixture(t),config=await fs.readFile(path.join(home,'public-access.json'),'utf8');
  for(const input of [{publicUrl:'http://phone.example.com'},{publicUrl:'https://phone.example.com/path'},{publicUrl:'https://name:secret@phone.example.com'},{password:' short '},{}])await assert.rejects(updatePublicAccessSettings(input,home));
  assert.equal(await fs.readFile(path.join(home,'public-access.json'),'utf8'),config);assert.equal(await fs.readFile(path.join(home,'public-password.txt'),'utf8'),'old-password\n');
});
