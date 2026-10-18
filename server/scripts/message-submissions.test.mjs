import test from 'node:test';
import assert from 'node:assert/strict';
import {readSubmissionStatus} from '../src/services/messageSubmissions.ts';

test('confirmation reads the execution ledger and respects thread ownership',async()=>{
 const rows=new Map([['r',{state:'starting',threadId:'t'}],['f',{state:'failed',threadId:'t',error:'model unavailable'}],['q',{state:'accepted',threadId:'t'}],['u',{state:'uncertain',threadId:'t'}]]);
 const ledger={get:async id=>rows.get(id)};
 assert.equal((await readSubmissionStatus('r',[],ledger,'t')).state,'processing');
 assert.equal((await readSubmissionStatus('r',[],ledger,'other')).state,'unknown');
 assert.equal((await readSubmissionStatus('f',[],ledger,'t')).error,'model unavailable');
 assert.equal((await readSubmissionStatus('q',[],ledger,'t')).state,'accepted');
 assert.equal((await readSubmissionStatus('u',[],ledger,'t')).state,'uncertain');
});

test('a thread-created event does not prematurely confirm a turn',async()=>{
 assert.equal((await readSubmissionStatus('r',[{type:'thread.started',threadId:'t',requestId:'r'}],{get:async()=>undefined})).state,'unknown');
});

test('stored accepted message recovers confirmation after restart',async()=>{
 const events=[{type:'user.message',threadId:'t',requestId:'r',text:'hello'}],ledger={get:async()=>undefined};
 assert.deepEqual(await readSubmissionStatus('r',events,ledger),{state:'accepted',threadId:'t'});
 assert.equal((await readSubmissionStatus('r',events,ledger,'other')).state,'unknown');
});
