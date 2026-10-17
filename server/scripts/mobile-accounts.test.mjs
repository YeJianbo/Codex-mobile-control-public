import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {z} from 'zod';
import {accountResponse,LocalConsoleClient,registerLocalConsole} from '../src/services/localConsole.ts';

test('mobile account projection excludes stored credentials and paths at every depth',()=>{
 const safe=accountResponse({email:'a@example.invalid',access_token:'secret',snapshotPath:'private',items:[{id:'saved',email:'a@example.invalid',tokens:{access_token:'secret'},snapshotPath:'private'}],providers:[{id:'relay',hasKey:true,apiKey:'secret',models:['m'],modelSettings:{m:{displayName:'Model',contextWindow:1000,apiKey:'secret'}}}]});
 assert.equal(safe.items[0].id,'saved');
 assert.equal(safe.providers[0].modelSettings.m.contextWindow,1000);
 assert(!JSON.stringify(safe).includes('secret'));assert(!JSON.stringify(safe).includes('private'));
 const claude=accountResponse({apps:{claude:{activeId:'local:one',profiles:[{id:'local:one',name:'Proxy',editable:true,hasKey:true}],secret:'hidden'},unknown:{secret:'hidden'}},settings:{model:'sonnet',effortLevel:'high',env:{ANTHROPIC_BASE_URL:'https://example.invalid',ANTHROPIC_MODEL:'opus',ANTHROPIC_AUTH_TOKEN:'hidden',ANTHROPIC_API_KEY:'hidden',OTHER:'hidden'}}});
 assert.equal(claude.apps.claude.profiles[0].editable,true);assert(!claude.apps.unknown);
 assert.deepEqual(claude.settings.env,{ANTHROPIC_BASE_URL:'https://example.invalid',ANTHROPIC_MODEL:'opus'});assert(!JSON.stringify(claude).includes('hidden'));
});

test('paired account writes use fixed services and require a preview plan for switching',async()=>{
 const calls=[];
 const client=new LocalConsoleClient(async(url,init)=>{
  if(url.endsWith('/'))return new Response(`<meta name="local-token" content="${'a'.repeat(64)}">`);
  calls.push({url,body:init.body&&JSON.parse(init.body)});
  return Response.json(url.endsWith('/api/model-accounts?editable=1')?{accounts:[{app:'deepseek',provider:'ecnu',baseUrl:'https://example.invalid/v1',model:'ecnu-max',hasKey:true,apiKey:'hidden'}]}:{switched:true,id:'saved',planId:'e56f78d5-3724-4e76-b2ee-b45234506127',canSwitch:true});
 });
 const app=Fastify();app.setErrorHandler((e,_req,reply)=>reply.code(e instanceof z.ZodError?400:500).send({error:'invalid'}));registerLocalConsole(app,client);
 try{
  for(const url of ['/api/local-console/accounts/unknown','/api/local-console/accounts/codex?url=https://external.invalid']){
   const response=await app.inject({url});assert.equal(response.statusCode,400);
  }
  const before=calls.length;
  assert.equal((await app.inject({method:'POST',url:'/api/local-console/accounts/codex/switch',payload:{id:'saved'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/local-console/accounts/codex/restore',payload:{id:'saved'}})).statusCode,400);
  assert.equal(calls.length,before);
  const planId='e56f78d5-3724-4e76-b2ee-b45234506127';
  assert.equal((await app.inject({method:'POST',url:'/api/local-console/accounts/codex/switch',payload:{id:'saved',planId,accountId:'',target:''}})).statusCode,200);
  assert.deepEqual(calls.at(-1),{url:'http://127.0.0.1:25819/api/account/switch',body:{id:'saved',planId}});
  const state=(await app.inject('/api/local-console/accounts/deepseek')).json();assert.equal(state.provider,'ecnu');assert(!('apiKey'in state));
 }finally{await app.close();}
});
