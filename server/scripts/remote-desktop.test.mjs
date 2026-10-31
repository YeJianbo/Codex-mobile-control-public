import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {DesktopControl,isLocalDesktopSocket} from '../dist/services/desktopControl.js';
import {permittedPublicRequest} from './public-routes.mjs';

test('remote desktop is restricted to direct LAN connections',()=>{
  const request=(address,headers={},encrypted=true)=>({socket:{remoteAddress:address,encrypted},headers});
  for(const address of ['127.0.0.1','::1','::ffff:192.168.1.12','10.3.4.5','fd00::1'])assert.equal(isLocalDesktopSocket(request(address)),true,address);
  for(const address of ['1.1.1.1','100.64.0.1','2001:4860:4860::8888'])assert.equal(isLocalDesktopSocket(request(address)),false,address);
  assert.equal(isLocalDesktopSocket(request('127.0.0.1',{'x-public-proxy-secret':'present'})),false);
  assert.equal(isLocalDesktopSocket(request('127.0.0.1',{'x-forwarded-for':'192.168.1.5'})),false);
  assert.equal(isLocalDesktopSocket(request('192.168.1.12',{},false)),false);
  assert.equal(isLocalDesktopSocket(request('127.0.0.1',{},false)),true);
  assert.equal(permittedPublicRequest('POST','/api/desktop/session'),false);
  assert.equal(permittedPublicRequest('GET','/ws/desktop'),false);
});

test('VNC server binds loopback and forwards a real RFB handshake through WebSocket',{skip:process.platform!=='win32',timeout:15000},async()=>{
  const desktop=new DesktopControl();const wss=new WebSocketServer({host:'127.0.0.1',port:0});
  await once(wss,'listening');
  try{
    const session=await desktop.create('owner','127.0.0.1');
    wss.on('connection',ws=>desktop.attach(session.id,'owner','127.0.0.1',ws,()=>true));
    const client=new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
    const [message,binary]=await once(client,'message');
    assert.equal(binary,true);assert.match(message.toString(),/^RFB 003\./);
    client.close();await once(client,'close');
  }finally{desktop.close();for(const client of wss.clients)client.terminate();await new Promise(resolve=>wss.close(resolve));}
});
