import test from 'node:test';
import assert from 'node:assert/strict';
import {ZcodeDesktopSteer} from '../dist/services/zcodeDesktopSteer.js';
import {submissionFailureKind} from '../dist/services/submissionErrors.js';

const native={sessionId:'sess_real',thread:{id:'zcode_alias',projectPath:'/project'}};
const find=async id=>id===native.thread.id?native:undefined;
const snapshot=status=>({projection:{sessionId:native.sessionId,status,currentTurnId:'turn_1'}});

test('desktop steer targets the native session on its original runtime',async()=>{
  const calls=[];
  const runtime=async(cwd,operation)=>{
    assert.equal(cwd,'/project');
    return operation(async(method,params)=>{
      calls.push({method,params});
      return method==='session/read'?snapshot('running'):{status:'accepted',result:{delivery:'guide'}};
    });
  };
  const service=new ZcodeDesktopSteer(runtime,find);
  assert.equal(await service.canSteer('zcode_alias'),true);
  await service.steer('zcode_alias','fixture');
  assert.deepEqual(calls.map(call=>call.method),['session/read','session/read','v4/command']);
  const command=calls.at(-1).params;
  assert.equal(command.sessionId,'sess_real');assert.equal(command.payload.text,'fixture');
  assert.equal(command.payload.requestedDelivery,'guide');
});

test('stopped, mismatched and unavailable sessions never submit a guide',async()=>{
  for(const projection of [snapshot('idle'),{projection:{sessionId:'other',status:'running',currentTurnId:'turn'}}]){
    const service=new ZcodeDesktopSteer(async(_cwd,operation)=>operation(async method=>{
      assert.equal(method,'session/read');return projection;
    }),find);
    assert.equal(await service.canSteer('zcode_alias'),false);
    await assert.rejects(service.steer('zcode_alias','fixture'),/不可引导/);
  }
  const offline=new ZcodeDesktopSteer(async()=>null,find);
  assert.equal(await offline.canSteer('zcode_alias'),false);
  await assert.rejects(offline.steer('zcode_alias','fixture'),/共享后端不可用/);
});

test('a lost response after submission is uncertain and must not be replayed automatically',async()=>{
  const service=new ZcodeDesktopSteer(async(_cwd,operation)=>operation(async method=>{
    if(method==='session/read')return snapshot('running');
    throw Error('connection closed');
  }),find);
  await assert.rejects(service.steer('zcode_alias','fixture'),error=>submissionFailureKind(error)==='uncertain');
});
