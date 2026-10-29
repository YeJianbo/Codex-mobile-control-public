import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {bearerToken} from '../routes/auth.js';
import type {ChannelService} from './service.js';
const id=z.string().trim().min(1).max(512);
export function registerChannelRoutes(app:FastifyInstance,channels:ChannelService,adminToken:string){
  const bootstraps=new Map<string,number>(),grants=new Map<string,{expires:number;token:string}>();
  const loopback=(request:FastifyRequest)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip)&&!request.headers['x-public-proxy-secret'];
  const prune=()=>{for(const [key,expires] of bootstraps)if(expires<Date.now())bootstraps.delete(key);for(const [key,value] of grants)if(value.expires<Date.now())grants.delete(key);};
  // Channel ownership grants access to existing tasks; configure it only from the local console.
  const localAdmin=async(request:FastifyRequest,reply:any)=>{
    prune();const grant=grants.get(String(request.headers['x-channel-admin']||''));
    if(!loopback(request)||(bearerToken(request)!==adminToken&&(!grant||grant.token!==bearerToken(request))))
      return reply.code(403).send({error:'请在电脑本机控制台管理消息通道'});
  };
  const options={preHandler:localAdmin};
  app.post('/api/channels/bootstrap',{preHandler:async(request,reply)=>{if(!loopback(request)||bearerToken(request)!==adminToken)return reply.code(403).send({error:'仅本机管理程序可开启通道设置'});}},async()=>{
    prune();if(bootstraps.size>=32)throw Error('请稍后再打开管理后台');const code=randomBytes(24).toString('base64url');bootstraps.set(code,Date.now()+60000);return {code};
  });
  app.post('/api/channels/claim',async(request,reply)=>{
    prune();const {code}=z.object({code:z.string().max(100)}).parse(request.body);const token=bearerToken(request);
    if(!loopback(request)||!token||!bootstraps.delete(code))return reply.code(403).send({error:'设置授权已过期，请从电脑管理程序重新打开后台'});
    if(grants.size>=32)throw Error('管理页面过多，请关闭旧页面后重试');const grant=randomBytes(24).toString('base64url');grants.set(grant,{token,expires:Date.now()+30*60*1000});return {grant};
  });
  app.get('/api/channels',options,async()=>channels.state());
  app.post('/api/channels/accounts',options,async request=>{const data=z.object({channel:z.enum(['qq','weixin']),label:z.string().trim().min(1).max(80)}).strict().parse(request.body);return {account:channels.store.addAccount(data.channel,data.label)};});
  app.delete('/api/channels/accounts/:id',options,async request=>{await channels.remove(z.object({id}).parse(request.params).id);return {ok:true};});
  app.put('/api/channels/accounts/:id/credentials',options,async request=>{await channels.configure(z.object({id}).parse(request.params).id,request.body);return channels.state();});
  app.put('/api/channels/accounts/:id/settings',options,async request=>{const {projectPath}=z.object({projectPath:z.string().trim().max(2048)}).strict().parse(request.body);await channels.setProject(z.object({id}).parse(request.params).id,projectPath);return channels.state();});
  app.post('/api/channels/accounts/:id/login',options,async request=>{const body=z.object({verifyCode:z.string().trim().max(40).optional(),refresh:z.boolean().optional()}).strict().parse(request.body??{});return channels.login(z.object({id}).parse(request.params).id,body.verifyCode,body.refresh);});
  app.post('/api/channels/accounts/:id/pair',options,async request=>{z.object({}).strict().parse(request.body??{});return channels.qqAccess.pair(z.object({id}).parse(request.params).id);});
  app.post('/api/channels/accounts/:id/revoke-access',options,async request=>{z.object({confirm:z.literal(true)}).strict().parse(request.body);channels.qqAccess.revoke(z.object({id}).parse(request.params).id);return channels.state();});
  app.post('/api/channels/accounts/:id/:action',options,async request=>{const params=z.object({id,action:z.enum(['connect','disconnect'])}).parse(request.params);if(params.action==='connect')channels.begin(params.id);else await channels.stop(params.id);return channels.state();});
}
