import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {z} from 'zod';
import {LocalConsoleClient,consoleState,consoleStatistics,registerLocalConsole} from '../src/services/localConsole.ts';

const token='a'.repeat(64);
const state={version:'0.12.0',config:{model:'example',provider:'openai',nativeCatalog:true},catalogRefresh:{automatic:true,intervalHours:6,added:['new-model']},models:[{id:'example',name:'Example',context:128000,official:true,enabled:true}],metrics:{requests:4,errors:1,activeRequests:0},accounts:{access_token:'private-account'},providers:[{key:'private-provider'}],home:'private-home',events:[{message:'private-event'}]};
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});

test('console bridge keeps credentials and administrative state on the computer',async()=>{
 const calls=[];
 const client=new LocalConsoleClient(async(url,init)=>{
  calls.push({url,init});
  assert(url.startsWith('http://127.0.0.1:25819/'));
  if(url.endsWith('/'))return new Response(`<meta name="local-token" content="${token}">`);
  assert.equal(init.headers['x-local-token'],token);return json(state);
 });
 const result=await client.state();
 assert.equal(result.config.model,'example');assert.equal(result.models[0].isDefault,true);
 assert.deepEqual(result.catalog.added,['new-model']);
 const serialized=JSON.stringify(result);
 for(const secret of [token,'private-account','private-provider','private-home','private-event'])assert(!serialized.includes(secret));
 assert.equal(calls.length,2);
});

test('console restart refreshes the process token once before retrying',async()=>{
 let rootReads=0,apiReads=0;
 const client=new LocalConsoleClient(async(url,init)=>{
  if(url.endsWith('/'))return new Response(`<meta name="local-token" content="${++rootReads===1?token:'b'.repeat(64)}">`);
  apiReads++;if(apiReads===1)return new Response('{}',{status:403});
  assert.equal(init.headers['x-local-token'],'b'.repeat(64));return json(state);
 });
 assert.equal((await client.state()).available,true);assert.equal(rootReads,2);assert.equal(apiReads,2);
});

test('Codex statistics preserve cache inclusion, price gaps, activity and daily series',()=>{
 const result=consoleStatistics({since:1,until:2,totals:{activeMinutes:30,activeDays:2,activeSessions:3,toolCalls:6},series:[{date:'2026-09-29',activeMinutes:30}],tokens:{totals:{input:100,cached:40,output:20,reasoning:10,samples:2},cost:{usd:0.002,unpricedSamples:1,date:'2026-09-29'},modelGroups:[{model:'example',input:100,cached:40,output:20,samples:2,cost:{usd:0.002,unpricedSamples:1}}],series:[{date:'2026-09-29',input:100,cached:40,output:20,samples:2}]}},'codex','week');
 assert.equal(result.totals.total,120);assert.equal(result.totals.cached,40);
 assert.equal(result.cost.unpricedRecords,1);assert.equal(result.activity.minutes,30);
 assert.equal(result.series[0].total,120);assert.equal(result.series[0].activeMinutes,30);
 assert.equal(result.models[0].usd,0.002);
});

test('other harness statistics use their actual cache and billing semantics',()=>{
 const raw={totals:{input:100,cached:40,cacheRead:40,cacheWrite:10,output:20,reasoning:5,requests:2,usd:0.01,unpriced:1,partial:1},groups:[{model:'example',input:100,cached:40,cacheRead:40,cacheWrite:10,output:20,requests:2}],modelSeries:[{date:'2026-09-29',input:50,cached:20,cacheRead:20,cacheWrite:5,output:10,requests:1},{date:'2026-09-29',input:50,cached:20,cacheRead:20,cacheWrite:5,output:10,requests:1}],coverage:{activityOnlySessions:3}};
 for(const source of ['agy','claude','zcode','grok']){
  const result=consoleStatistics(raw,source,'week');
  assert.equal(result.totals.total,['agy','claude'].includes(source)?170:120);
  assert.equal(result.series.length,1);assert.equal(result.series[0].total,result.totals.total);
  assert.equal(result.cost.usd,source==='agy'?0.01:null);
  assert.equal(result.totals.reasoning,source==='claude'?null:5);
  assert.equal(result.activity,null);assert.equal(result.coverage.activityOnlySessions,3);
 }
});

test('hourly model points retain time and cache semantics without flattening into daily totals',()=>{
 const points=[{date:'2026-10-14',hour:'2026-10-14T08',model:'first',input:80,cached:50,output:20,samples:1},{date:'2026-10-14',hour:'2026-10-14T09',model:'second',input:40,cached:10,output:10,samples:1}];
 const result=consoleStatistics({tokens:{modelSeries:points,series:points}},'codex','today');
 assert.deepEqual(result.modelSeries.map(p=>[p.hour,p.model,p.total]),[['2026-10-14T08','first',100],['2026-10-14T09','second',50]]);
 assert.equal(result.series.length,1);assert.equal(result.series[0].total,150);
 const fallback=consoleStatistics({modelSeries:[{...points[0],hour:'2026-10-13T08',requests:1}]},'agy','today');
 assert.equal(fallback.modelSeries[0].hour,null);assert.equal(fallback.modelSeries[0].total,150);
});

test('paired endpoints validate actions and statistics without exposing a general proxy',async()=>{
 const calls=[];
 const client=new LocalConsoleClient(async(url,init)=>{
  if(url.endsWith('/'))return new Response(`<meta name="local-token" content="${token}">`);
  calls.push({url,init});return json(state);
 });
 const app=Fastify();app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof z.ZodError?400:500).send({error:'invalid'}));
 app.addHook('preHandler',async(req,reply)=>{if(req.headers.authorization!=='Bearer paired')return reply.code(401).send({error:'unauthorized'});});
 registerLocalConsole(app,client);
 try{
  assert.equal((await app.inject('/api/local-console/state')).statusCode,401);
  const headers={authorization:'Bearer paired'};
  for(const payload of [{action:'restore',id:'backup'},{action:'toggle',id:'example',enabled:'false'},{action:'refresh',url:'https://external.invalid'}, {action:'default',id:''}]){
   assert.equal((await app.inject({method:'POST',url:'/api/local-console/actions',headers,payload})).statusCode,400);
  }
  assert.equal((await app.inject({url:'/api/local-console/statistics?source=unknown',headers})).statusCode,400);
  assert.equal((await app.inject({url:'/api/local-console/statistics?range=week&url=https://external.invalid',headers})).statusCode,400);
  assert.equal(calls.length,0);
  const response=await app.inject({method:'POST',url:'/api/local-console/actions',headers,payload:{action:'toggle',id:'example',enabled:false}});
  assert.equal(response.statusCode,200);
  assert.equal(calls[0].url,'http://127.0.0.1:25819/api/model/toggle');
  assert.deepEqual(JSON.parse(calls[0].init.body),{id:'example',enabled:false});
  assert.equal(calls[1].url,'http://127.0.0.1:25819/api/state');
 }finally{await app.close();}
});

test('backend restart proxies only a validated preview plan and filters process details',async()=>{
 const calls=[],planId='123e4567-e89b-42d3-a456-426614174000';
 const client=new LocalConsoleClient(async(url,init)=>{
  if(url.endsWith('/'))return new Response(`<meta name="local-token" content="${token}">`);
  calls.push({url,body:JSON.parse(init.body)});
  return json({planId,canRestart:false,blockingThreads:[{id:'private-thread',title:'private-title'}],running:true,token:'private-token',restarted:url.endsWith('/restart')});
 });
 const app=Fastify();app.setErrorHandler((error,_req,reply)=>reply.code(error instanceof z.ZodError?400:500).send({error:'invalid'}));registerLocalConsole(app,client);
 try{
  const preview=await app.inject({method:'POST',url:'/api/local-console/backend/restart-preview',payload:{}});
  assert.equal(preview.statusCode,200);assert.equal(preview.json().blockingCount,1);assert(!preview.body.includes('private'));
  assert.equal((await app.inject({method:'POST',url:'/api/local-console/backend/restart',payload:{planId:'bad'}})).statusCode,400);
  const restarted=await app.inject({method:'POST',url:'/api/local-console/backend/restart',payload:{planId}});
  assert.equal(restarted.json().restarted,true);
  assert.deepEqual(calls.map(c=>c.url),['http://127.0.0.1:25819/api/backend/restart-preview','http://127.0.0.1:25819/api/backend/restart']);
  assert.deepEqual(calls[1].body,{planId});
 }finally{await app.close();}
});
test('offline and incomplete console data return an error instead of a zero summary',async()=>{
 for(const fetchImpl of [async()=>{throw Error('secret credential in low-level error');},async url=>url.endsWith('/')?new Response(`<meta name="local-token" content="${token}">`):json({})]){
  const app=Fastify();registerLocalConsole(app,new LocalConsoleClient(fetchImpl));
  try{const response=await app.inject('/api/local-console/statistics');assert([502,503].includes(response.statusCode));assert(!response.body.includes('secret credential'));assert(!response.body.includes('"total":0'));}finally{await app.close();}
 }
});
