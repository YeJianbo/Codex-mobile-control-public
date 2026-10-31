import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgyCliPool} from '../src/services/agyCli.ts';

function fixture(idleMs=300000,maxIdle=4){
  const runs=[];
  const launch=(_command,args)=>{
    const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough(),inputs=[];let resolve;
    const done=new Promise(r=>resolve=r);
    const finish=()=>{stdout.end();stderr.end();resolve({exitCode:0});};stdin.on('data',value=>inputs.push(value.toString()));stdin.on('finish',finish);
    const child={stdin,stdout,stderr,then:done.then.bind(done),kill(){finish();return true;}};
    runs.push({args,inputs,child,result(text='ok',usage){stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:text,usage}})+'\n');}});return child;
  };
  const pool=new AgyCliPool(launch,undefined,idleMs,maxIdle);return {pool,runs};
}
const args=['--input-format','stream-json','--output-format','stream-json','--effort','low','--mode','accept-edits'];
const input='{"event":"user","message":{"content":"fixture"}}\n';
test('AGY live process survives terminal results, isolates turns and rebuilds changed permissions',async t=>{
  const f=fixture();t.after(()=>f.pool.close());
  const one=(await f.pool.run('one','agy',args,'workspace',input)).process;let first='';one.stdout.on('data',d=>first+=d);f.runs[0].result('first',{input_tokens:10,output_tokens:3,cache_read_tokens:5,total_tokens:13});await one;f.pool.release('one');
  const two=(await f.pool.run('one','agy',[...args,'--conversation','native-id'],'workspace',input)).process;let second='';two.stdout.on('data',d=>second+=d);assert.equal(f.runs.length,1);assert.equal(f.runs[0].inputs.length,2);f.runs[0].result('second',{input_tokens:30,output_tokens:8,cache_read_tokens:15,total_tokens:38});await two;f.pool.release('one');assert(!second.includes('first'));assert(first.includes('first'));assert.deepEqual(JSON.parse(second).result.usage,{input_tokens:30,output_tokens:8,cache_read_tokens:15,total_tokens:38});
  const changed=(await f.pool.run('one','agy',[...args.slice(0,6),'--dangerously-skip-permissions','--conversation','native-id'],'workspace',input)).process;assert.equal(f.runs.length,2);assert(f.runs[1].args.includes('native-id'));f.runs[1].result();await changed;f.pool.release('one');
  const other=(await f.pool.run('two','agy',args,'workspace',input)).process;assert.equal(f.runs.length,3);await other.interrupt();await other;
});
test('AGY idle connections are bounded and expire without keeping a turn running',async t=>{
  const f=fixture(40,1);t.after(()=>f.pool.close());
  for(const id of ['one','two']){const turn=(await f.pool.run(id,'agy',args,'workspace',input)).process;f.runs.at(-1).result();await turn;f.pool.release(id);}
  await new Promise(r=>setTimeout(r,10));assert.equal(f.pool.connections.size,1);
  await new Promise(r=>setTimeout(r,60));assert.equal(f.pool.connections.size,0);
});
test('AGY exit winning the race after a terminal result still ends the turn as success, missing results keep the exit code',async t=>{
  const launches=[];
  const launch=()=>{
    const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
    let resolveChild;const childPromise=new Promise(r=>{resolveChild=r;});
    const child={stdin,stdout,stderr,then:childPromise.then.bind(childPromise),kill(){return true;}};
    launches.push(stdout);
    stdout.on('close',()=>resolveChild({exitCode:1}));
    return child;
  };
  const pool=new AgyCliPool(launch,undefined,300000,4);t.after(()=>pool.close());
  const raced=(await pool.run('race','agy',args,'workspace',input)).process;let out='';raced.stdout.on('data',d=>out+=d);
  launches[0].write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'done'}})+'\n');
  launches[0].end();
  assert.equal((await raced).exitCode,0);
  assert.deepEqual(JSON.parse(out).result,{status:'SUCCESS',response:'done'});
  const failed=(await pool.run('fail','agy',args,'workspace',input)).process;
  launches[1].end();
  assert.equal((await failed).exitCode,1);
});
const integer=value=>{const out=[];do{const byte=value%128;value=Math.floor(value/128);out.push(byte|(value?128:0));}while(value);return Buffer.from(out);};
const number=(key,value)=>Buffer.concat([integer(key*8),integer(value)]);
const bytes=(key,value)=>{const data=Buffer.from(value);return Buffer.concat([integer(key*8+2),integer(data.length),data]);};
const transportMessage='API error (attempt 1): request failed: fetch failed: unexpected EOF';
function nativeHome(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'agy-cli-cursor-'));
  const file=path.join(home,'.gemini','antigravity-cli','conversations','nativeid.db');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE steps(idx INTEGER PRIMARY KEY,step_type INTEGER,status INTEGER,step_payload BLOB); CREATE TABLE executor_metadata(idx INTEGER PRIMARY KEY,data BLOB);');
  db.prepare('INSERT INTO steps VALUES(9,14,3,?)').run(Buffer.alloc(0));
  db.close();
  const previous={USERPROFILE:process.env.USERPROFILE,HOME:process.env.HOME};
  process.env.USERPROFILE=home;process.env.HOME=home;
  t.after(()=>{process.env.USERPROFILE=previous.USERPROFILE;process.env.HOME=previous.HOME;fs.rmSync(home,{recursive:true,force:true});});
  return file;
}
function emittingLaunch(){
  const children=[];
  const launch=()=>{
    const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
    let resolveChild;const childPromise=new Promise(r=>{resolveChild=r;});
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;stdout.end();stderr.end();resolveChild({exitCode:0});};
    stdin.on('finish',finish);
    const child={stdin,stdout,stderr,then:childPromise.then.bind(childPromise),kill(){finish();return true;}};
    children.push({stdout,emit:record=>stdout.write(JSON.stringify(record)+'\n')});
    return child;
  };
  return {children,launch};
}
// The forwarded stream carries every record; wait for the init line so the
// pool has finished processing it before the next step, without sleeping.
function forwarded(turn,marker){
  return new Promise(resolve=>{
    let text='';
    turn.stdout.on('data',function onData(chunk){
      text+=chunk.toString();
      if(text.includes(marker)){turn.stdout.off('data',onData);resolve(text);}
    });
  });
}
const lines=out=>out.trim().split('\n').map(line=>JSON.parse(line));
const resultRecord=out=>lines(out).find(record=>record.event==='result');
test('AGY init arriving before the user turn samples the native cursor and reconciles the stale error',async t=>{
  const file=nativeHome(t);
  const {children,launch}=emittingLaunch();
  const pool=new AgyCliPool(launch,undefined,300000,4);t.after(()=>pool.close());
  const turn=(await pool.run('cursor','agy',args,'workspace',input)).process;
  let out='';turn.stdout.on('data',d=>out+=d);
  const initForwarded=forwarded(turn,'"init"');
  children[0].emit({event:'init',conversation_id:'nativeid'});
  await initForwarded;
  const db=new DatabaseSync(file);
  db.prepare('INSERT INTO steps VALUES(10,14,3,?)').run(Buffer.alloc(0));
  db.prepare('INSERT INTO steps VALUES(11,15,3,?)').run(bytes(20,bytes(1,'本轮完整答复')));
  db.prepare('INSERT INTO executor_metadata VALUES(5,?)').run(Buffer.concat([number(1,4),number(3,11)]));
  db.close();
  children[0].emit({event:'result',result:{conversation_id:'nativeid',status:'ERROR',error:transportMessage,response:'本轮完整答复\n',usage:{total_tokens:100}}});
  await turn;
  assert.deepEqual(resultRecord(out).result,{conversation_id:'nativeid',status:'SUCCESS',response:'本轮完整答复\n',usage:{total_tokens:100}});
});
test('AGY late init after the user turn never recovers through a late cursor',async t=>{
  const file=nativeHome(t);
  const db=new DatabaseSync(file);
  db.prepare('INSERT INTO steps VALUES(10,14,3,?)').run(Buffer.alloc(0));
  db.prepare('INSERT INTO steps VALUES(11,15,3,?)').run(bytes(20,bytes(1,'本轮完整答复')));
  db.prepare('INSERT INTO executor_metadata VALUES(5,?)').run(Buffer.concat([number(1,4),number(3,11)]));
  db.close();
  const {children,launch}=emittingLaunch();
  const pool=new AgyCliPool(launch,undefined,300000,4);t.after(()=>pool.close());
  const turn=(await pool.run('late','agy',args,'workspace',input)).process;
  let out='';turn.stdout.on('data',d=>out+=d);
  // The cursor is sampled only when init arrives, after this turn's user step
  // and answer are already in the database, so it must never rewrite the turn.
  const initForwarded=forwarded(turn,'"init"');
  children[0].emit({event:'init',conversation_id:'nativeid'});
  await initForwarded;
  children[0].emit({event:'result',result:{conversation_id:'nativeid',status:'ERROR',error:transportMessage,response:'本轮完整答复\n',usage:{total_tokens:100}}});
  await turn;
  assert.deepEqual(resultRecord(out).result,{conversation_id:'nativeid',status:'ERROR',error:transportMessage,response:'本轮完整答复\n',usage:{total_tokens:100}});
});
