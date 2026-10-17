import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
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
  const two=(await f.pool.run('one','agy',[...args,'--conversation','native-id'],'workspace',input)).process;let second='';two.stdout.on('data',d=>second+=d);assert.equal(f.runs.length,1);assert.equal(f.runs[0].inputs.length,2);f.runs[0].result('second',{input_tokens:30,output_tokens:8,cache_read_tokens:15,total_tokens:38});await two;f.pool.release('one');assert(!second.includes('first'));assert(first.includes('first'));assert.deepEqual(JSON.parse(second).result.usage,{input_tokens:20,output_tokens:5,cache_read_tokens:10,total_tokens:25});
  const changed=(await f.pool.run('one','agy',[...args.slice(0,6),'--dangerously-skip-permissions','--conversation','native-id'],'workspace',input)).process;assert.equal(f.runs.length,2);assert(f.runs[1].args.includes('native-id'));f.runs[1].result();await changed;f.pool.release('one');
  const other=(await f.pool.run('two','agy',args,'workspace',input)).process;assert.equal(f.runs.length,3);await other.interrupt();await other;
});
test('AGY idle connections are bounded and expire without keeping a turn running',async t=>{
  const f=fixture(40,1);t.after(()=>f.pool.close());
  for(const id of ['one','two']){const turn=(await f.pool.run(id,'agy',args,'workspace',input)).process;f.runs.at(-1).result();await turn;f.pool.release(id);}
  await new Promise(r=>setTimeout(r,10));assert.equal(f.pool.connections.size,1);
  await new Promise(r=>setTimeout(r,60));assert.equal(f.pool.connections.size,0);
});
