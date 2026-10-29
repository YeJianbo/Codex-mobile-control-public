import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {EventHub} from '../dist/services/eventHub.js';
import {ThreadEventFocus} from '../public/console-core.js';

async function fixture(events=[]){
  const observed=[],store={events:[...events],appendEvent:async event=>store.events.push(event)};
  const hub=new EventHub(store),server=new WebSocketServer({port:0,host:'127.0.0.1'}),clients=[];
  hub.subscribe(event=>observed.push(event));
  server.on('connection',(socket,request)=>{
    const url=new URL(request.url,'http://localhost');
    hub.add(socket,()=>true,url.searchParams.has('deferred'),url.searchParams.get('streamThread')??undefined);
    socket.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='thread.focus')hub.focusStream(socket,message.threadId,message.requestId)});
  });
  await once(server,'listening');
  async function connect(query=''){
    const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/${query}`),rows=[],frames=[],signal=new EventEmitter();clients.push(socket);
    socket.on('message',raw=>{const value=JSON.parse(raw);rows.push(value);frames.push({value,bytes:raw.length});signal.emit('row')});
    const wait=async predicate=>{while(!rows.some(predicate))await once(signal,'row');return rows.find(predicate)};
    await wait(row=>row.type==='connected');return {socket,rows,frames,wait};
  }
  async function fence(...connections){const id=randomUUID();hub.publish({type:'connected',eventId:id},false);await Promise.all(connections.map(client=>client.wait(row=>row.eventId===id)))}
  async function close(){for(const socket of clients)socket.terminate();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve))}
  return {hub,store,observed,connect,fence,close};
}

test('current-thread and notification sockets omit other streams while persistence and legacy clients retain them',{timeout:10000},async()=>{
  const f=await fixture();
  try{
    const legacy=await f.connect(),focused=await f.connect('?streamThread=t0'),notifications=await f.connect('?streamThread=&deferred');
    const types=['message.delta','reasoning.summary','tool.output'];
    for(let thread=0;thread<5;thread++)for(let index=0;index<100;index++)f.hub.publish({type:types[index%3],threadId:`t${thread}`,eventId:`stream-${thread}-${index}`,text:'payload '.repeat(160)});
    for(let thread=0;thread<5;thread++)for(const type of ['approval.requested','error','turn.completed','goal.completed','usage.updated'])f.hub.publish({type,threadId:`t${thread}`,eventId:`${type}-${thread}`,text:'keep status',status:'ok'});
    f.hub.publish({type:'terminal.output',threadId:'terminal',commandId:'workspace-session',eventId:'terminal',text:'workspace output'});
    await f.fence(legacy,focused,notifications);
    const streams=client=>client.frames.filter(row=>types.includes(row.value.type));
    assert.equal(streams(legacy).length,500);assert.equal(streams(focused).length,100);assert.equal(streams(notifications).length,0);
    assert(streams(focused).every(row=>row.value.threadId==='t0'));
    for(const client of [legacy,focused,notifications]){
      for(let thread=0;thread<5;thread++)for(const type of ['approval.requested','error','turn.completed','goal.completed'])assert(client.rows.some(row=>row.eventId===`${type}-${thread}`));
      for(let thread=0;thread<5;thread++)assert.equal(client.rows.some(row=>row.eventId===`usage.updated-${thread}`),client===legacy||client===focused&&thread===0);
      assert(client.rows.some(row=>row.eventId==='terminal'));
    }
    assert.equal(f.store.events.filter(row=>types.includes(row.type)).length,500);assert.equal(f.observed.filter(row=>types.includes(row.type)).length,500);
    console.log(JSON.stringify({streamFrames:{legacy:500,selected:100,notifications:0},streamBytes:{legacy:streams(legacy).reduce((sum,row)=>sum+row.bytes,0),selected:streams(focused).reduce((sum,row)=>sum+row.bytes,0),notifications:0}}));
  }finally{await f.close()}
});

test('focus acknowledgement precedes new stream frames and empty focus leaves lifecycle delivery intact',{timeout:10000},async()=>{
  const f=await fixture();
  try{
    const client=await f.connect('?streamThread=A');
    client.socket.send(JSON.stringify({type:'thread.focus',threadId:'B',requestId:'focus-b'}));
    await client.wait(row=>row.type==='thread.focused'&&row.requestId==='focus-b');
    f.hub.publish({type:'message.delta',threadId:'A',eventId:'a',text:'old'});f.hub.publish({type:'message.delta',threadId:'B',eventId:'b',text:'new'});
    await f.fence(client);assert(!client.rows.some(row=>row.eventId==='a'));assert(client.rows.some(row=>row.eventId==='b'));
    assert(client.rows.findIndex(row=>row.requestId==='focus-b')<client.rows.findIndex(row=>row.eventId==='b'));
    client.socket.send(JSON.stringify({type:'thread.focus',threadId:'',requestId:'home'}));await client.wait(row=>row.requestId==='home');
    f.hub.publish({type:'message.delta',threadId:'B',eventId:'hidden',text:'hidden'});f.hub.publish({type:'thread.started',threadId:'new',eventId:'new-thread',requestId:'submission'});
    await f.fence(client);assert(!client.rows.some(row=>row.eventId==='hidden'));assert(client.rows.some(row=>row.eventId==='new-thread'));
  }finally{await f.close()}
});

test('replay respects focus and reconnecting without the option restores legacy delivery',{timeout:10000},async()=>{
  const f=await fixture([{type:'message.delta',threadId:'A',eventId:'saved-a',text:'a'},{type:'message.delta',threadId:'B',eventId:'saved-b',text:'b'},{type:'turn.completed',threadId:'B',eventId:'saved-done',status:'ok'}]);
  try{
    const focused=await f.connect('?streamThread=A');await f.fence(focused);
    assert(focused.rows.some(row=>row.eventId==='saved-a'&&row.replayed));assert(!focused.rows.some(row=>row.eventId==='saved-b'));
    assert(focused.rows.some(row=>row.eventId==='saved-done'&&row.replayed));
    focused.socket.terminate();
    const legacy=await f.connect();await f.fence(legacy);assert(legacy.rows.some(row=>row.eventId==='saved-b'&&row.replayed));
  }finally{await f.close()}
});

test('focused sockets omit other-thread tool lifecycles, changes, plans and compaction summaries',{timeout:10000},async()=>{
  const activities=['tool.started','tool.output','tool.completed','reasoning.summary','plan.updated','file.changed','diff.updated','context.compaction'];
  const saved=activities.flatMap(type=>['A','B'].map(threadId=>({type,threadId,eventId:`saved-${type}-${threadId}`,text:'saved detail',files:['a.kt'],status:'ok'})));
  const f=await fixture(saved);
  try{
    const legacy=await f.connect(),focused=await f.connect('?streamThread=A&deferred'),notifications=await f.connect('?streamThread=&deferred');
    for(let thread=0;thread<5;thread++)for(let index=0;index<80;index++){
      const type=activities[index%activities.length];
      f.hub.publish({type,threadId:thread===0?'A':`other-${thread}`,eventId:`activity-${thread}-${index}`,text:'detail '.repeat(120),detail:'command output',diff:'+change',files:['a.kt'],status:'ok'});
    }
    for(const type of ['user.message','thread.started','turn.started','turn.completed','approval.requested','approval.resolved','error','warning','usage.updated','goal.completed','thread.settings.updated','thread.history.changed']){
      f.hub.publish({type,threadId:'B',eventId:`status-${type}`,text:'status',title:'status',status:'ok'});
    }
    await f.fence(legacy,focused,notifications);
    const rows=client=>client.frames.filter(frame=>activities.includes(frame.value.type));
    console.log(JSON.stringify({activityFrames:{legacy:rows(legacy).length,selected:rows(focused).length,notifications:rows(notifications).length},activityBytes:{legacy:rows(legacy).reduce((sum,frame)=>sum+frame.bytes,0),selected:rows(focused).reduce((sum,frame)=>sum+frame.bytes,0),notifications:rows(notifications).reduce((sum,frame)=>sum+frame.bytes,0)}}));
    assert.equal(rows(legacy).length,416);
    assert.equal(rows(focused).length,88);
    assert.equal(rows(notifications).length,0);
    assert(rows(focused).every(frame=>frame.value.threadId==='A'));
    for(const client of [legacy,focused,notifications])for(const type of ['user.message','thread.started','turn.started','turn.completed','approval.requested','approval.resolved','error','warning','goal.completed','thread.history.changed'])assert(client.rows.some(row=>row.eventId===`status-${type}`));
    for(const client of [legacy,focused,notifications])for(const type of ['usage.updated','thread.settings.updated'])assert.equal(client.rows.some(row=>row.eventId===`status-${type}`),client===legacy);
    assert.equal(f.store.events.filter(event=>activities.includes(event.type)).length,416);
    assert.equal(f.observed.filter(event=>activities.includes(event.type)).length,400);
    focused.socket.send(JSON.stringify({type:'thread.focus',threadId:'B',requestId:'focus-activity-b'}));
    await focused.wait(row=>row.requestId==='focus-activity-b');
    for(const type of activities){f.hub.publish({type,threadId:'A',eventId:`old-${type}`,status:'ok'});f.hub.publish({type,threadId:'B',eventId:`new-${type}`,status:'ok'});}
    await f.fence(focused);
    for(const type of activities){assert(!focused.rows.some(row=>row.eventId===`old-${type}`));assert(focused.rows.some(row=>row.eventId===`new-${type}`));}
  }finally{await f.close()}
});

test('Web focus client switches acknowledged streams while preserving global receipts and lifecycle events',{timeout:10000},async()=>{
  const f=await fixture(),focus=new ThreadEventFocus();
  try{
    const legacy=await f.connect('?deferred'),web=await f.connect('?streamThread=&deferred');
    web.socket.on('message',raw=>{const row=JSON.parse(raw);if(row.type==='thread.focused')focus.acknowledge(web.socket,row.requestId,row.threadId);});
    assert(await focus.ensure(web.socket,'t0'));
    const types=['message.delta','reasoning.summary','tool.output'];
    for(let thread=0;thread<5;thread++)for(let index=0;index<60;index++)f.hub.publish({type:types[index%3],threadId:`t${thread}`,eventId:`web-${thread}-${index}`,text:'payload '.repeat(160)});
    for(const type of ['user.message','turn.completed','approval.requested','usage.updated','goal.completed'])f.hub.publish({type,threadId:'other',eventId:'global-'+type,requestId:'submission',status:'ok'});
    await f.fence(legacy,web);
    const frames=client=>client.frames.filter(frame=>types.includes(frame.value.type));
    assert.equal(frames(legacy).length,300);assert.equal(frames(web).length,60);
    for(const type of ['user.message','turn.completed','approval.requested','goal.completed'])assert(web.rows.some(row=>row.eventId==='global-'+type));
    assert(!web.rows.some(row=>row.eventId==='global-usage.updated'));
    console.log(JSON.stringify({webFocusFrames:{legacy:frames(legacy).length,current:frames(web).length},webFocusBytes:{legacy:frames(legacy).reduce((sum,row)=>sum+row.bytes,0),current:frames(web).reduce((sum,row)=>sum+row.bytes,0)}}));
    assert(await focus.ensure(web.socket,'t1'));
    f.hub.publish({type:'message.delta',threadId:'t0',eventId:'old-thread',text:'old'});f.hub.publish({type:'message.delta',threadId:'t1',eventId:'new-thread',text:'new'});
    await f.fence(web);assert(!web.rows.some(row=>row.eventId==='old-thread'));assert(web.rows.some(row=>row.eventId==='new-thread'));
    assert(await focus.ensure(web.socket,''));f.hub.publish({type:'message.delta',threadId:'t1',eventId:'hidden-thread',text:'hidden'});
    await f.fence(web);assert(!web.rows.some(row=>row.eventId==='hidden-thread'));
  }finally{focus.reset();await f.close();}
});

test('large command-output bursts do not flood focused phones or notifications; history and workspace terminals remain intact',{timeout:10000},async()=>{
  const f=await fixture([{type:'terminal.output',threadId:'other',eventId:'replay-output',text:'old output'}]);
  try{
    const legacy=await f.connect(),chat=await f.connect('?streamThread=current&deferred'),notifications=await f.connect('?streamThread=&deferred');
    for(let i=0;i<3000;i++){
      f.hub.publish({type:'terminal.output',threadId:'other',eventId:`terminal-${i}`,stream:'stdout',text:`chunk ${i}`});
      f.hub.publish({type:'tool.output',threadId:'other',itemId:'command',eventId:`tool-${i}`,text:`chunk ${i}`});
    }
    for(let i=0;i<100;i++)f.hub.publish({type:'message.delta',threadId:'current',eventId:`text-${i}`,text:`word ${i}`});
    f.hub.publish({type:'terminal.output',threadId:'terminal:workspace',commandId:'interactive',eventId:'interactive',stream:'stdout',text:'live terminal'});
    for(const type of ['approval.requested','approval.resolved','user.message','turn.completed','goal.completed'])f.hub.publish({type,threadId:'other',eventId:`notice-${type}`,status:'ok'});
    await f.fence(legacy,chat,notifications);
    for(const client of [chat,notifications]){
      assert.equal(client.rows.filter(row=>row.type==='terminal.output').length,1);
      assert(!client.rows.some(row=>row.eventId==='replay-output'||row.type==='tool.output'));
      for(const type of ['approval.requested','approval.resolved','user.message','turn.completed','goal.completed'])assert(client.rows.some(row=>row.eventId===`notice-${type}`));
      assert.equal(client.socket.readyState,WebSocket.OPEN);
    }
    assert.deepEqual(chat.rows.filter(row=>row.type==='message.delta').map(row=>row.text),Array.from({length:100},(_,i)=>`word ${i}`));
    assert.equal(notifications.rows.filter(row=>row.type==='message.delta').length,0);
    assert.equal(legacy.rows.filter(row=>row.type==='terminal.output').length,3002);
    assert.equal(f.store.events.filter(row=>row.type==='tool.output').length,3000);
    assert.equal(f.observed.filter(row=>row.type==='terminal.output').length,3001);
    console.log(JSON.stringify({commandBurstFrames:6000,unrelatedCommandFramesToChat:0,unrelatedCommandFramesToNotifications:0,orderedMessageChunks:100,interactiveTerminalPreserved:true}));
  }finally{await f.close();}
});
