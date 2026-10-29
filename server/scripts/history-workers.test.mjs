import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryWorkerPool} from '../src/services/historyWorkers.ts';

const fixture=new URL('data:text/javascript,'+encodeURIComponent(`
  import {parentPort,threadId} from 'node:worker_threads';
  let sequence=0;
  parentPort.on('message',message=>{
    const order=++sequence;
    if(message.method==='exit'){process.exit(1);return;}
    setTimeout(()=>parentPort.postMessage({id:message.id,value:{threadId,order,args:message.args}}),message.args[1]||0);
  });
`));

test('colliding conversation IDs use separate workers; each conversation keeps FIFO and deduplication',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const a=pool.call('read',['01a07e7c-8f28-7a53-9825-0152b461a685',50]);
    assert.equal(pool.call('read',['01a07e7c-8f28-7a53-9825-0152b461a685',50]),a);
    const b=pool.call('read',['01a12105-00df-7010-9297-94ba8763cf31',0]);
    const invalidate=pool.call('invalidate',['01a07e7c-8f28-7a53-9825-0152b461a685']);
    const after=pool.call('read',['01a07e7c-8f28-7a53-9825-0152b461a685',0]);
    const [first,other,cleared,last]=await Promise.all([a,b,invalidate,after]);
    assert.notEqual(first.threadId,other.threadId);
    assert.equal(first.threadId,cleared.threadId);assert.equal(first.threadId,last.threadId);
    assert.deepEqual([first.order,cleared.order,last.order],[1,2,3]);
    const status=pool.status();
    assert.equal(status.deduplicated,1);assert.equal(status.completed,4);
    assert.equal(status.lanes.reduce((sum,lane)=>sum+lane.queued+Number(lane.running),0),0);
    assert(!JSON.stringify(status).includes('01a07e7c'));
  }finally{await pool.close();}
});

test('a failed history worker is replaced and its queued conversation continues',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const failed=assert.rejects(pool.call('exit',['same']),/工作线程已退出/);
    const queued=pool.call('read',['same']);
    await failed;assert.equal((await queued).order,1);
  }finally{await pool.close();}
});

test('interactive histories run ahead of other conversations without starving older background work',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const jobs=[
      pool.call('read',['a',30],'background'),pool.call('read',['b',30],'background'),
      pool.call('read',['c'],'background'),pool.call('read',['d'],'background'),
      pool.call('read',['e']),pool.call('read',['f']),pool.call('read',['g']),
    ];
    const [, ,older, ,interactive, ,later]=await Promise.all(jobs);
    assert.equal(older.threadId,interactive.threadId);assert.equal(older.threadId,later.threadId);
    assert.deepEqual([interactive.order,older.order,later.order],[2,3,4]);
  }finally{await pool.close();}
});

test('opening an already queued background read promotes the same deduplicated job',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const earlier=[pool.call('read',['a',30],'background'),pool.call('read',['b',30],'background'),
      pool.call('read',['c'],'background'),pool.call('read',['d'],'background')];
    const queued=pool.call('read',['promoted'],'background');
    assert.equal(pool.call('read',['promoted']),queued);
    assert.equal((await queued).order,2);
    await Promise.all(earlier);
  }finally{await pool.close();}
});

test('interactive reads cannot overtake an earlier invalidation of their own conversation',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const first=pool.call('read',['same',30],'background');
    const other=pool.call('read',['other',30],'background');
    const invalidated=pool.call('invalidate',['same'],'background');
    const opened=pool.call('read',['same']);
    const [start,,clear,end]=await Promise.all([first,other,invalidated,opened]);
    assert.equal(start.threadId,clear.threadId);assert.equal(start.threadId,end.threadId);
    assert.deepEqual([start.order,clear.order,end.order],[1,2,3]);
  }finally{await pool.close();}
});

test('identical reads deduplicate only within the same invalidation boundary',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const first=pool.call('read',['same',30]);
    const clear=pool.call('invalidateCodexHistory',['same']);
    const next=pool.call('read',['same',30]);
    const nextShared=pool.call('read',['same',30]);
    const clearAgain=pool.call('invalidateCodexHistory',['same']);
    const last=pool.call('read',['same',30]);
    const lastShared=pool.call('read',['same',30]);
    const results=await Promise.all([first,clear,next,clearAgain,last,nextShared,lastShared]);
    assert.notEqual(next,first,'A post-invalidation read cannot reuse pre-invalidation work');
    assert.equal(nextShared,next,'Reads within the new boundary still share their work');
    assert.notEqual(clearAgain,clear,'Two invalidations separated by a read must both run');
    assert.notEqual(last,next);
    assert.equal(lastShared,last);
    assert.equal(new Set(results.map(result=>result.threadId)).size,1);
    assert.deepEqual(results.map(result=>result.order),[1,2,3,4,5,3,5]);
  }finally{await pool.close();}
});

test('an abandoned queued read is removed and an immediate retry keeps its own deduplication entry',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const active=[pool.call('read',['a',50]),pool.call('read',['b',50])];
    const controller=new AbortController();
    const abandoned=pool.call('read',['c'],'interactive',controller.signal);
    const cancelled=assert.rejects(abandoned,{name:'AbortError'});
    controller.abort();
    const retry=pool.call('read',['c']);
    await cancelled;
    assert.equal(pool.call('read',['c']),retry);
    assert.equal((await retry).order,2);
    await Promise.all(active);
  }finally{await pool.close();}
});

test('cancelling one consumer preserves another consumer and a shared background owner',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const active=[pool.call('read',['a',50]),pool.call('read',['b',50])];
    const first=new AbortController(),second=new AbortController(),backgroundConsumer=new AbortController();
    const cancelled=assert.rejects(pool.call('read',['shared'],'interactive',first.signal),{name:'AbortError'});
    const shared=pool.call('read',['shared'],'interactive',second.signal);
    const background=pool.call('read',['retained'],'background');
    const cancelledBackground=assert.rejects(pool.call('read',['retained'],'interactive',backgroundConsumer.signal),{name:'AbortError'});
    first.abort();backgroundConsumer.abort();
    await Promise.all([cancelled,cancelledBackground]);
    const [one,two]=await Promise.all([shared,background]);
    assert.equal(one.order,2);assert.equal(two.order,2);
    await Promise.all(active);
  }finally{await pool.close();}
});

test('cancelling a started read leaves the worker available to shared readers and subsequent calls',async()=>{
  const pool=new HistoryWorkerPool(fixture);
  try{
    const controller=new AbortController();
    const cancelled=assert.rejects(pool.call('read',['same',30],'interactive',controller.signal),{name:'AbortError'});
    controller.abort();
    const shared=pool.call('read',['same',30]);
    const after=pool.call('read',['same']);
    await cancelled;
    const [first,last]=await Promise.all([shared,after]);
    assert.equal(first.threadId,last.threadId);assert.deepEqual([first.order,last.order],[1,2]);
    const stopped=new AbortController();stopped.abort();
    await assert.rejects(pool.call('read',['unused'],'interactive',stopped.signal),{name:'AbortError'});
  }finally{await pool.close();}
});
