import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionManager} from '../src/services/sessionManager.ts';

test('retry notification keeps the running turn and preserves complete error details',()=>{
 const codex=new EventEmitter(),events=[],threads=[{id:'t',status:'running'}];
 new SessionManager(codex,{publish:e=>events.push(e)},{threads,approvals:[],upsertThread:async row=>{Object.assign(threads[0],row);return threads[0]}});
 const error={message:'stream disconnected before completion: IO error (os error 10054)',additionalDetails:'Reconnecting 4/5\n远程主机强迫关闭了一个现有的连接。',codexErrorInfo:{streamDisconnected:{httpStatusCode:502}}};
 codex.emit('notification',{method:'error',params:{threadId:'t',turnId:'turn',willRetry:true,error}});
 assert.equal(threads[0].status,'running');assert.equal(events[0].willRetry,true);assert.equal(events[0].title,'正在重新连接 4/5');
 assert(events[0].detail.includes(error.message));assert(events[0].detail.includes(error.additionalDetails));assert(events[0].detail.includes('502'));
 codex.emit('notification',{method:'turn/completed',params:{threadId:'t',turn:{id:'turn',status:'failed',error}}});
 assert.equal(threads[0].status,'error');assert.equal(events.at(-1).willRetry,false);assert.equal(events.at(-1).detail,events[0].detail);
});
