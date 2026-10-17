import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {ThreadEventCache} from '../public/thread-cache.js';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
const a=source.indexOf('function receiveEvent(event)'),b=source.indexOf('function queueThreadRefresh()',a);assert(a>=0&&b>a);
function fixture(){
 const frames=[],counts={controls:0,renders:0,threadRefreshes:0,clearedStops:[],notices:[]},state={threadId:'active',threads:[{id:'active',status:'idle'},{id:'other',status:'idle'}],hydrating:new Map()};
 state.events=new ThreadEventCache(()=>state.threadId);
 const context={state,readPendingSubmission:()=>null,requestAnimationFrame:callback=>frames.push(callback),updateControls(){counts.controls++;},renderConversation(){counts.renders++;context.updateControls();},
  clearPendingStop(id){counts.clearedStops.push(id);},queueThreadRefresh(){counts.threadRefreshes++;},queueCompletionNotice(event){counts.notices.push(event);}};
 vm.createContext(context);vm.runInContext('let renderQueued=false,controlsQueued=false;'+source.slice(a,b),context);
 const emit=(id,index)=>context.receiveEvent({type:'message.delta',threadId:id,eventId:'delta-'+index,itemId:'response',text:'x'});
 const flush=()=>{for(const callback of frames.splice(0))callback();};
 return {context,state,counts,frames,emit,flush};
}

test('a burst of active conversation events updates controls only through its single render',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.emit('active',i);
 assert.equal(f.state.threads[0].status,'running');assert.equal(f.counts.controls,0);assert.equal(f.frames.length,1);f.flush();assert.equal(f.counts.renders,1);assert.equal(f.counts.controls,1);
});

test('other conversation events coalesce controls without rebuilding the active conversation',()=>{
 const f=fixture();for(let i=0;i<100;i++)f.emit('other',i);
 assert.equal(f.frames.length,1);assert.equal(f.counts.controls,0);f.flush();assert.equal(f.counts.renders,0);assert.equal(f.counts.controls,1);
});

test('a pending controls refresh yields to a conversation render and accepts later updates',()=>{
 const f=fixture();f.emit('other',0);f.emit('active',1);f.flush();assert.equal(f.counts.renders,1);assert.equal(f.counts.controls,1);
 f.context.queueControlsUpdate();f.flush();assert.equal(f.counts.controls,2);
});

test('background turn start updates running state without needing body events or rendering the active conversation',()=>{
 const f=fixture(),event={type:'turn.started',threadId:'other',turnId:'turn-1',eventId:'start-1'};
 const buffered=[];f.state.hydrating.set('other',buffered);
 f.context.receiveEvent(event);
 assert.equal(f.state.threads[1].status,'running');assert.equal(f.counts.threadRefreshes,1);
 assert.deepEqual(f.counts.clearedStops,['other']);assert.equal(buffered[0],event);assert.equal(f.state.events.get('other')[0],event);
 f.flush();assert.equal(f.counts.renders,0);assert.equal(f.counts.controls,1);
});

test('active turn start refreshes its controls through one conversation render',()=>{
 const f=fixture();f.context.receiveEvent({type:'turn.started',threadId:'active',turnId:'turn-1'});
 assert.equal(f.state.threads[0].status,'running');assert.equal(f.counts.threadRefreshes,1);
 assert.equal(f.frames.length,1);f.flush();assert.equal(f.counts.renders,1);assert.equal(f.counts.controls,1);
});

test('background turn completion preserves completed, failed and interrupted status and completion handling',()=>{
 for(const status of ['completed','error','interrupted']){
  const f=fixture();f.context.receiveEvent({type:'turn.started',threadId:'other',turnId:'turn-1'});f.flush();
  const event={type:'turn.completed',threadId:'other',turnId:'turn-1',status};f.context.receiveEvent(event);
  assert.equal(f.state.threads[1].status,status);assert.equal(f.counts.threadRefreshes,2);
  assert.deepEqual(f.counts.clearedStops,['other','other']);assert.deepEqual(f.counts.notices,[event]);
  f.flush();assert.equal(f.counts.renders,0);assert.equal(f.counts.controls,2);
 }
});

test('unknown turn start refreshes the sidebar while replayed lifecycle events remain ignored',()=>{
 const f=fixture();f.context.receiveEvent({type:'turn.started',threadId:'unlisted',turnId:'turn-1'});
 assert.equal(f.counts.threadRefreshes,1);assert.equal(f.state.events.get('unlisted').length,1);
 f.flush();assert.equal(f.counts.renders,0);
 f.context.receiveEvent({type:'turn.started',threadId:'other',turnId:'old-turn',replayed:true});
 assert.equal(f.state.threads[1].status,'idle');assert.equal(f.counts.threadRefreshes,1);assert.equal(f.frames.length,0);
});
