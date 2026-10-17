import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('metadata leaves replay untouched while migration and history replacements still persist',async()=>{
  const root=path.resolve(os.tmpdir()),home=await fs.mkdtemp(path.join(root,'state-metadata-')),previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  const store=new StateStore();let inspect;
  try{
    const legacy=[
      {type:'user.message',threadId:'codex-fixture',turnId:'prior',eventId:'prior',text:'keep',createdAt:'2026-10-15T00:00:00Z'},
      {type:'user.message',threadId:'codex-fixture',turnId:'last',eventId:'edit',text:'replace',createdAt:'2026-10-15T00:01:00Z'},
      {type:'message.delta',threadId:'codex-fixture',turnId:'last',eventId:'answer',text:'old answer',createdAt:'2026-10-15T00:01:01Z'},
      {type:'terminal.output',threadId:'terminal:fixture',commandId:'fixture',eventId:'terminal',stream:'stdout',status:'running',command:'fixture',text:'started',createdAt:'2026-10-15T00:02:00Z'},
      {type:'user.message',threadId:'opencode-fixture',eventId:'external',text:'external',createdAt:'2026-10-15T00:03:00Z'},
    ];
    await fs.writeFile(path.join(home,'state.json'),JSON.stringify({devices:[],pairings:[],threads:[],approvals:[],events:legacy}));
    await store.load();inspect=new DatabaseSync(path.join(home,'state.sqlite'));
    const replay=()=>inspect.prepare('SELECT seq,payload FROM events ORDER BY seq').all();
    const initial=replay();assert.equal(initial.length,legacy.length);
    inspect.exec("CREATE TRIGGER forbid_metadata_event_insert BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'metadata rewrote replay'); END; CREATE TRIGGER forbid_metadata_event_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'metadata deleted replay'); END");
    const device=await store.rememberDevice({name:'fixture',token:'fixture-token'});
    assert(await store.touchDeviceToken('fixture-token',{name:'updated fixture'}));
    const rotated=await store.rotateDeviceToken('fixture-token');assert(rotated);
    assert(await store.touchDeviceToken(rotated.token));await store.revokeDevice(device.id);
    await store.upsertThread({id:'codex-fixture',status:'running',title:'before'});
    await store.updateThread('codex-fixture',{title:'after'});await store.createPairing();
    for(let i=0;i<3;i++)await store.addApproval({id:`approval-${i}`,rpcId:i,method:'fixture',threadId:'codex-fixture',approvalType:'command',title:'fixture'});
    await store.resolveApproval('approval-0','accept');await store.expireApproval('approval-1');await store.expirePendingApprovals();
    assert.deepEqual(replay(),initial);assert.deepEqual(store.events,legacy);
    inspect.exec('DROP TRIGGER forbid_metadata_event_insert; DROP TRIGGER forbid_metadata_event_delete');
    store.close();await store.load();assert.deepEqual(store.events,legacy);
    assert.equal(store.threads.find(row=>row.id==='codex-fixture').title,'after');
    assert.equal(store.isValidDeviceToken(rotated.token),false);
    assert.equal(store.approvals.find(row=>row.id==='approval-0').status,'accepted');
    assert.equal(store.approvals.filter(row=>row.status==='expired').length,2);
    await store.removeTurnEvents('codex-fixture','last');await store.deleteThread('opencode-fixture');
    assert.equal(await store.closeDanglingTerminalCommands(),1);
    const remaining=JSON.parse(JSON.stringify(store.events));store.close();await store.load();
    assert.deepEqual(store.events,remaining);
    assert(!store.events.some(event=>['edit','answer','external'].includes(event.eventId)));
    assert(store.events.some(event=>event.eventId==='prior'));
    assert.equal(store.terminalCommands().find(row=>row.commandId==='fixture').status,'stopped');
  }finally{inspect?.close();store.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;assert(path.resolve(home).startsWith(root+path.sep));await fs.rm(home,{recursive:true,force:true})}
});
