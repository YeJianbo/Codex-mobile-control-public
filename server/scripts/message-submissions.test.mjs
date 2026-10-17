import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageSubmissions} from '../src/services/messageSubmissions.ts';

test('pending duplicate does not start another send; changed payload is rejected',()=>{
 const receipts=new MessageSubmissions(),command={type:'turn.start',threadId:'t',text:'hello'};
 assert.equal(receipts.begin('r',command,'t'),true);
 assert.equal(receipts.begin('r',command,'t'),false);
 assert.equal(receipts.status('r',[],'t').state,'processing');
 assert.throws(()=>receipts.begin('r',{...command,text:'another'},'t'),/另一条消息/);
 assert.equal(receipts.status('r',[],'other').state,'unknown');
});
test('a thread-created event does not prematurely confirm a turn',()=>{
 const receipts=new MessageSubmissions();
 assert.equal(receipts.status('r',[{type:'thread.started',threadId:'t',requestId:'r'}]).state,'unknown');
});
test('stored accepted message recovers confirmation after a gateway restart',()=>{
 const receipts=new MessageSubmissions();
 assert.deepEqual(receipts.status('r',[{type:'user.message',threadId:'t',requestId:'r',text:'hello'}]),{state:'accepted',threadId:'t'});
});
test('failed and queued receipts distinguish retryable drafts from accepted messages',()=>{
 const receipts=new MessageSubmissions();receipts.begin('r',{},'t');
 receipts.finish('r',{state:'failed',threadId:'t',error:'model unavailable'});
 assert.equal(receipts.status('r',[],'t').error,'model unavailable');
 receipts.begin('q',{},'t');receipts.finish('q',{state:'accepted',threadId:'t'});
 assert.equal(receipts.status('q',[],'t').state,'accepted');
});
