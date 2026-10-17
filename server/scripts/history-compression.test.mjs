import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {gunzipSync} from 'node:zlib';
import {registerHistoryCompression,historyCompression} from '../dist/services/historyCompression.js';

test('history compression preserves JSON, respects negotiation and leaves other routes alone',async()=>{
  const app=Fastify();await registerHistoryCompression(app);
  const content={events:Array.from({length:1200},(_,i)=>({type:'message.delta',eventId:`event-${i}`,text:`第${i}段🙂 `+'complete content '.repeat(16)}))};
  app.get('/events',{compress:historyCompression},()=>content);
  app.get('/small',{compress:historyCompression},()=>({ok:true}));
  app.get('/other',()=>content);
  try{
    const plain=await app.inject('/events');assert.equal(plain.statusCode,200);assert.equal(plain.headers['content-encoding'],undefined);
    const gzip=await app.inject({url:'/events',headers:{'accept-encoding':'br, gzip;q=0.8'}});
    assert.equal(gzip.statusCode,200);assert.equal(gzip.headers['content-encoding'],'gzip');
    assert.match(gzip.headers.vary,/accept-encoding/i);assert.deepEqual(gunzipSync(gzip.rawPayload),plain.rawPayload);
    assert.deepEqual(JSON.parse(gunzipSync(gzip.rawPayload)),content);
    const declined=await app.inject({url:'/events',headers:{'accept-encoding':'gzip;q=0, identity;q=1'}});
    assert.equal(declined.headers['content-encoding'],undefined);assert.deepEqual(declined.rawPayload,plain.rawPayload);
    for(const url of ['/small','/other']){
      const response=await app.inject({url,headers:{'accept-encoding':'gzip'}});
      assert.equal(response.headers['content-encoding'],undefined);assert.equal(response.statusCode,200);
    }
  }finally{await app.close();}
});
