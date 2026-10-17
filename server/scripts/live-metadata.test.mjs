import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('device touches and approval transitions stay scoped and publish only committed changes',async()=>{
 const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'live-metadata-'));
 process.env.CODEX_MOBILE_CONTROL_HOME=home;
 const {StateStore}=await import('../dist/services/stateStore.js');const store=new StateStore();let inspect;
 try{
  await store.load();
  const device=await store.rememberDevice({name:'fixture',token:'fixture-token',userAgent:'original'});
  const other=await store.rememberDevice({name:'other',token:'other-token'});
  const revoked=await store.rememberDevice({name:'revoked',token:'revoked-token'});await store.revokeDevice(revoked.id);
  store.bindDeviceCertificate(device.id,'isolated-certificate');
  await store.upsertThread({id:'t',title:'untouched',source:'localCodex'});await store.createPairing();
  await store.appendEvent({type:'user.message',threadId:'t',eventId:'event',text:'retained'});
  const add=id=>store.addApproval({id,rpcId:id,threadId:'t',method:'fixture',approvalType:'command',title:id});
  await add('keep');await store.resolveApproval('keep','accept');
  inspect=new DatabaseSync(path.join(home,'state.sqlite'));
  const untouched=()=>({
   tables:Object.fromEntries(['threads','thread_sources','pairings','events','device_certificates'].map(table=>[table,inspect.prepare(`SELECT * FROM ${table}`).all()])),
   otherDevices:inspect.prepare('SELECT * FROM devices WHERE id<>? ORDER BY id').all(device.id),
   approval:inspect.prepare("SELECT * FROM approvals WHERE id='keep'").get(),
  });
  const initial=untouched();
  for(const table of ['threads','thread_sources','pairings','events','device_certificates'])for(const operation of ['INSERT','UPDATE','DELETE'])inspect.exec(`CREATE TRIGGER forbid_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'unrelated write'); END`);
  inspect.exec(`CREATE TRIGGER forbid_device_delete BEFORE DELETE ON devices BEGIN SELECT RAISE(ABORT,'device deletion'); END;
   CREATE TRIGGER forbid_other_device BEFORE UPDATE ON devices WHEN NEW.id='${other.id}' OR NEW.id='${revoked.id}' BEGIN SELECT RAISE(ABORT,'other device update'); END;
   CREATE TRIGGER forbid_approval_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT,'approval deletion'); END;
   CREATE TRIGGER forbid_keep_approval BEFORE INSERT ON approvals WHEN NEW.id='keep' BEGIN SELECT RAISE(ABORT,'other approval write'); END`);
  const raw=inspect.prepare('SELECT * FROM devices WHERE id=?').get(device.id);
  assert.equal((await store.touchDeviceToken('fixture-token',{name:'updated',userAgent:'next'})).name,'updated');
  const touched=inspect.prepare('SELECT * FROM devices WHERE id=?').get(device.id);
  assert.equal(touched.name,'updated');assert.equal(touched.user_agent,'next');assert.equal(touched.token_hash,raw.token_hash);
  assert.equal(touched.first_seen_at,raw.first_seen_at);assert.equal(touched.revoked_at,raw.revoked_at);
  assert(store.isValidDeviceToken('fixture-token'));assert.equal(store.certificateForToken('fixture-token'),'isolated-certificate');
  assert.equal(await store.touchDeviceToken('unknown-token'),null);assert.equal(await store.touchDeviceToken('revoked-token'),null);
  const stable=store.devices.find(row=>row.id===device.id);
  inspect.exec("CREATE TRIGGER reject_touch BEFORE UPDATE ON devices WHEN NEW.name='rejected' BEGIN SELECT RAISE(ABORT,'touch rejected'); END");
  await assert.rejects(store.touchDeviceToken('fixture-token',{name:'rejected'}),/touch rejected/);
  assert.deepEqual(store.devices.find(row=>row.id===device.id),stable);assert.deepEqual(inspect.prepare('SELECT * FROM devices WHERE id=?').get(device.id),touched);
  inspect.exec('DROP TRIGGER reject_touch');
  const first=await add('first');assert.equal(await store.resolveApproval('first','accept'),first);
  await assert.rejects(store.resolveApproval('first','decline'),/已经处理/);
  const second=await add('second');
  inspect.exec("CREATE TRIGGER reject_decline BEFORE UPDATE ON approvals WHEN NEW.id='second' AND NEW.status='declined' BEGIN SELECT RAISE(ABORT,'decline rejected'); END");
  await assert.rejects(store.resolveApproval('second','decline'),/decline rejected/);assert.equal(second.status,'pending');
  assert.equal(inspect.prepare("SELECT status FROM approvals WHERE id='second'").get().status,'pending');
  await store.expireApproval('second');assert.equal(second.status,'expired');
  inspect.exec('DROP TRIGGER reject_decline');
  inspect.exec("CREATE TRIGGER reject_add BEFORE INSERT ON approvals WHEN NEW.id='reject-add' BEGIN SELECT RAISE(ABORT,'add rejected'); END");
  await assert.rejects(add('reject-add'),/add rejected/);assert(!store.approvals.some(row=>row.id==='reject-add'));
  assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM approvals WHERE id='reject-add'").get().n,0);inspect.exec('DROP TRIGGER reject_add');
  await add('bulk-a');await add('bulk-b');
  const pending=structuredClone(store.approvals),diskPending=inspect.prepare('SELECT * FROM approvals ORDER BY id').all();
  inspect.exec("CREATE TRIGGER reject_bulk BEFORE UPDATE ON approvals WHEN NEW.id='bulk-b' AND NEW.status='expired' BEGIN SELECT RAISE(ABORT,'bulk rejected'); END");
  await assert.rejects(store.expirePendingApprovals(),/bulk rejected/);assert.deepEqual(store.approvals,pending);
  assert.deepEqual(inspect.prepare('SELECT * FROM approvals ORDER BY id').all(),diskPending);inspect.exec('DROP TRIGGER reject_bulk');
  await store.expirePendingApprovals();assert(store.approvals.filter(row=>row.id.startsWith('bulk-')).every(row=>row.status==='expired'));
  await add('replacement');await add('replacement');assert.equal(store.approvals.filter(row=>row.id==='replacement').length,1);
  await store.resolveApproval('replacement','decline');assert.deepEqual(untouched(),initial);
  store.close();await store.load();
  assert.equal(store.devices.find(row=>row.id===device.id).name,'updated');assert.equal(store.approvals.find(row=>row.id==='first').status,'accepted');
  assert.equal(store.approvals.find(row=>row.id==='replacement').status,'declined');assert(!store.isValidDeviceToken('revoked-token'));
  assert(await store.touchDeviceToken('fixture-token'));await add('after-reopen');await store.resolveApproval('after-reopen','accept');
  assert.deepEqual(untouched(),initial);
 }finally{inspect?.close();store.close();assert(path.dirname(home)===root);await fs.rm(home,{recursive:true,force:true})}
});
