import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reconcileAgyTurnResult} from '../src/services/agyTurnResult.ts';

const integer=value=>{const out=[];do{const byte=value%128;value=Math.floor(value/128);out.push(byte|(value?128:0));}while(value);return Buffer.from(out);};
const number=(key,value)=>Buffer.concat([integer(key*8),integer(value)]);
const bytes=(key,value)=>{const data=Buffer.from(value);return Buffer.concat([integer(key*8+2),integer(data.length),data]);};
const message='There was a network issue connecting to the server, please try again.';
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'agy-result-test-')),file=path.join(directory,'native.db'),db=new DatabaseSync(file);
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 db.exec('CREATE TABLE steps(idx INTEGER PRIMARY KEY,step_type INTEGER,status INTEGER,step_payload BLOB); CREATE TABLE executor_metadata(idx INTEGER PRIMARY KEY,data BLOB);');
 const insert=(idx,type,payload=Buffer.alloc(0))=>db.prepare('INSERT INTO steps VALUES(?,?,3,?)').run(idx,type,payload);
 insert(2,17,bytes(24,bytes(3,bytes(1,message))));insert(10,14);insert(11,15,bytes(20,bytes(1,'本轮完整答复')));
 db.prepare('INSERT INTO executor_metadata VALUES(5,?)').run(Buffer.concat([number(1,4),number(3,11)]));
 const before={session:'isolated',file,step:9,executor:4};
 const result={conversation_id:'isolated',status:'ERROR',error:message,response:'本轮完整答复\n',usage:{total_tokens:100}};
 return {db,insert,before,result};
}
test('a completed native turn corrects a CLI error copied from an older turn without editing history',t=>{
 const f=fixture(t),fixed=reconcileAgyTurnResult(f.result,f.before);
 assert.equal(fixed.status,'SUCCESS');assert.equal(fixed.error,undefined);assert.equal(fixed.response,f.result.response);assert.deepEqual(fixed.usage,f.result.usage);
 assert.equal(f.result.status,'ERROR');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM steps WHERE step_type=17').get().n,1);
});
test('a new error remains a failure even when the turn also contains complete response text',t=>{
 const f=fixture(t);f.insert(12,17,bytes(24,bytes(3,bytes(1,message))));
 assert.equal(reconcileAgyTurnResult(f.result,f.before),f.result);
});
test('a recovered TLS attempt cannot override the matching completed native response',t=>{
 const f=fixture(t),result={...f.result,error:'API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": local error: tls: bad record MAC'};
 assert.equal(reconcileAgyTurnResult(result,f.before).status,'SUCCESS');
 f.insert(12,17,bytes(24,bytes(3,bytes(1,result.error))));
 assert.equal(reconcileAgyTurnResult(result,f.before),result);
});
test('a stale TLS error with no final response is reconciled only against its completed streamed step',t=>{
 const f=fixture(t),result={...f.result,response:'',error:'API error (attempt 1): request failed: local error: tls: bad record MAC'};
 const fixed=reconcileAgyTurnResult(result,f.before,new Map([['11','本轮完整答复']]));
 assert.equal(fixed.status,'SUCCESS');assert.equal(fixed.response,'本轮完整答复');
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['11','不完整']])),result);
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['12','本轮完整答复']])),result);
 f.insert(12,17,bytes(24,bytes(3,bytes(1,result.error))));
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['11','本轮完整答复']])),result);
});
test('a recovered EOF from the native error detail field 2 does not turn a complete answer into a failure',t=>{
 const f=fixture(t),error='API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": EOF';
 f.db.prepare('DELETE FROM steps WHERE idx=11').run();
 f.insert(11,17,bytes(24,bytes(3,bytes(2,error))));f.insert(12,15,bytes(20,bytes(1,'本轮完整答复')));
 f.db.prepare('UPDATE executor_metadata SET data=?').run(Buffer.concat([number(1,4),number(3,12)]));
 const result={...f.result,response:'',error};
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['12','本轮完整答复']])).status,'SUCCESS');
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['12','不完整']])),result);
 f.insert(13,17,bytes(24,bytes(3,bytes(2,error))));
 assert.equal(reconcileAgyTurnResult(result,f.before,new Map([['12','本轮完整答复']])),result);
});
test('native failure and stale completion cannot turn an explicit CLI failure into success',t=>{
 const f=fixture(t);
 assert.equal(reconcileAgyTurnResult(f.result,{...f.before,step:11,executor:5}),f.result);
 f.db.prepare('UPDATE executor_metadata SET data=?').run(Buffer.concat([number(1,1),number(3,11),bytes(12,'TLS timeout')]));
 assert.equal(reconcileAgyTurnResult(f.result,f.before),f.result);
});
test('missing evidence, another conversation, mismatched text and unrelated errors remain failures',t=>{
 const f=fixture(t);
 for(const result of [{...f.result,response:'不完整'},{...f.result,error:'another failure'},{...f.result,conversation_id:'other'}])assert.equal(reconcileAgyTurnResult(result,f.before),result);
 assert.equal(reconcileAgyTurnResult(f.result),f.result);
});
