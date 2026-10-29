import type {FastifyInstance} from 'fastify';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import type {AgentSessionPort} from '../services/agentSessions.js';
import {modelAgent,publicAgentAllowed} from '../services/agentProtocol.js';
import {readPartialPickerCatalog,readPickerModelCatalog} from '../services/modelCatalog.js';

export function registerModelDirectory(app:FastifyInstance,codex:CodexAppServerClient,agents:AgentSessionPort,publicProxySecret:string|undefined){
  app.get('/api/models',async request=>{
    const query=request.query as Record<string,string>;
    const refresh=query.refresh==='1';
    if(query.agents!=='all')return readPickerModelCatalog(codex,refresh);
    const viaPublic=publicProxySecret!=null&&request.headers['x-public-proxy-secret']===publicProxySecret;
    // Older clients keep the complete-directory response; current pickers request
    // bounded reads and follow pending sources without blocking the connection.
    const partial=query.partial==='1';
    const [primary,external]=await Promise.all([
      partial?readPartialPickerCatalog(codex,refresh):readPickerModelCatalog(codex,refresh).then(value=>({...value,pending:false})).catch(()=>({models:[],pending:false})),
      partial?agents.pickerCatalog(refresh,viaPublic):agents.models(refresh).then(async models=>({models,pending:[],backends:await agents.backends(viaPublic)})),
    ]);
    const pending=[...(primary.pending?['codex']:[]),...external.pending];
    const models=[...primary.models,...external.models].map(model=>{
      const agent=model.harness??modelAgent(model.model),backend=external.backends.find(entry=>entry.agent===agent);
      if(viaPublic&&!publicAgentAllowed(agent))return {...model,harness:agent,available:false,unavailableReason:'此助手的公网访问已关闭'};
      return {...model,harness:agent,...(backend?{available:backend.available,unavailableReason:backend.reason}:{})};
    });
    return {models,backends:external.backends,pending,source:'local-agents'};
  });
}
