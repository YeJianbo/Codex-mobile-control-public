import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import type {SessionManager} from './sessionManager.js';
import type {StateStore} from './stateStore.js';

/** Each operation stays scoped to the same authorized local thread. */
export function registerThreadToolsRoutes(app:FastifyInstance,dependencies:{codex:CodexAppServerClient;sessions:SessionManager;store:StateStore;authorize:(request:FastifyRequest,threadId:string)=>Promise<void>}){
  const {codex,sessions,store,authorize}=dependencies;
  const identity=async(request:FastifyRequest)=>{
    const {threadId}=z.object({threadId:z.string().uuid()}).parse(request.params);
    await authorize(request,threadId);return threadId;
  };
  app.post('/api/threads/:threadId/fork',async request=>{
    const threadId=await identity(request);
    const body=z.object({ephemeral:z.boolean().default(false),lastTurnId:z.string().min(1).max(256).optional(),beforeTurnId:z.string().min(1).max(256).optional()}).strict().parse(request.body??{});
    return sessions.forkThread(threadId,body);
  });
  app.post('/api/threads/:threadId/side/close',async request=>{
    const threadId=await identity(request);await sessions.closeSideThread(threadId);return {ok:true};
  });
  app.get('/api/threads/:threadId/background-terminals',async request=>{
    const threadId=await identity(request);
    const query=z.object({cursor:z.string().max(2048).optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(request.query);
    return codex.request('thread/backgroundTerminals/list',{threadId,...query});
  });
  app.post('/api/threads/:threadId/background-terminals/terminate',async request=>{
    const threadId=await identity(request);
    const body=z.object({processId:z.string().min(1).max(256)}).strict().parse(request.body);
    return codex.request('thread/backgroundTerminals/terminate',{threadId,...body});
  });
  app.post('/api/threads/:threadId/review',async request=>{
    const threadId=await identity(request);
    const target=z.discriminatedUnion('type',[
      z.object({type:z.literal('uncommittedChanges')}).strict(),
      z.object({type:z.literal('baseBranch'),branch:z.string().min(1).max(256)}).strict(),
      z.object({type:z.literal('commit'),sha:z.string().regex(/^[a-fA-F0-9]{7,64}$/)}).strict(),
      z.object({type:z.literal('custom'),instructions:z.string().min(1).max(200000)}).strict(),
    ]).parse(request.body);
    if(store.threads.find(thread=>thread.id===threadId)?.status==='running')throw Error('请等当前任务结束后开始审阅');
    await sessions.resumeThread(threadId);
    return codex.request('review/start',{threadId,target,delivery:'inline'});
  });
}
