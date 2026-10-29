import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import {EventHub} from '../dist/services/eventHub.js';

test('a host stall gets a fresh heartbeat, while a silent peer is closed on the next ordinary check',()=>{
  class Socket extends EventEmitter {
    OPEN=1;readyState=1;bufferedAmount=0;pings=0;terminated=false;
    send(_data,callback){callback?.();}
    ping(){this.pings++;}
    terminate(){this.terminated=true;this.readyState=3;}
  }
  const stalls=[],diagnostics=[];
  const hub=new EventHub({events:[]},()=>false,row=>diagnostics.push(row),row=>stalls.push(row)),socket=new Socket();
  try{
    hub.add(socket);hub.checkHeartbeats();assert.equal(socket.pings,1);
    hub.lastHeartbeatAt=performance.now()-50000;
    hub.checkHeartbeats();assert.equal(socket.terminated,false);assert.equal(socket.pings,2);
    assert.equal(stalls.length,1);assert(stalls[0].delayMs>=24000);assert.equal(stalls[0].connections,1);
    assert(Number.isFinite(stalls[0].rssMb));
    hub.lastHeartbeatAt=performance.now()-25000;hub.checkHeartbeats();
    assert.equal(socket.terminated,true);assert(diagnostics.some(row=>row.cause==='heartbeat_timeout'));
    const responsive=new Socket();hub.add(responsive);hub.checkHeartbeats();responsive.emit('pong');hub.checkHeartbeats();assert.equal(responsive.terminated,false);
  }finally{clearInterval(hub.heartbeatTimer);}
});

test('ephemeral lifecycle and approvals reach only the socket focused on that side conversation',()=>{
  class Socket extends EventEmitter {
    OPEN=1;readyState=1;bufferedAmount=0;events=[];
    send(raw,callback){this.events.push(JSON.parse(raw));callback?.();}
  }
  const hub=new EventHub({events:[],isEphemeral:id=>id==='side'}),side=new Socket(),main=new Socket(),notifications=new Socket(),legacy=new Socket();
  try{
    hub.add(side,()=>true,false,'side');hub.add(main,()=>true,false,'parent');hub.add(notifications,()=>true,true,'');hub.add(legacy);
    for(const type of ['user.message','message.delta','approval.requested','error','turn.completed','thread.started'])hub.publish({type,threadId:'side',text:'side',eventId:type},false);
    assert.equal(side.events.filter(event=>event.threadId==='side').length,6);
    for(const socket of [main,notifications,legacy])assert.equal(socket.events.some(event=>event.threadId==='side'),false);
  }finally{clearInterval(hub.heartbeatTimer);}
});
