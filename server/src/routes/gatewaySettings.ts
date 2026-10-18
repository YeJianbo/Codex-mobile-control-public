import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {ServerConfig} from '../types.js';
import type {CodexAppServerClient} from '../codex/appServerClient.js';
import type {SessionManager} from '../services/sessionManager.js';
import {updateServerConfig} from '../services/configStore.js';
import {agentNames,configurePublicAgentAccess,publicAgentAllowed} from '../services/agentProtocol.js';
import {readRemoteAutoApproval,writeRemoteAutoApproval} from '../services/remoteApprovalSettings.js';

export function registerGatewaySettings(app:FastifyInstance,config:ServerConfig,codex:CodexAppServerClient,sessions:SessionManager):void {
  app.get('/api/settings/remote-approval',async()=>({desktopAutoApprove:await readRemoteAutoApproval(),...codex.desktopApprovalStatus()}));
  const harnessAccess=()=>({agents:Object.entries(agentNames).map(([agent,name])=>({agent,name,enabled:publicAgentAllowed(agent as keyof typeof agentNames)}))});
  app.get('/api/settings/harness-access',async()=>harnessAccess());
  app.put('/api/settings/harness-access',async request=>{
    const agents=z.object({codex:z.boolean().optional(),claude:z.boolean().optional(),antigravity:z.boolean().optional(),grok:z.boolean().optional(),deepseek:z.boolean().optional(),hermes:z.boolean().optional(),opencode:z.boolean().optional()}).strict().parse(z.object({agents:z.unknown()}).strict().parse(request.body).agents);
    await updateServerConfig(config,draft=>{draft.publicAgents={...draft.publicAgents,...agents};});
    configurePublicAgentAccess(config.publicAgents);
    return harnessAccess();
  });
  app.get('/api/settings/capacity-retry',async()=>({enabled:config.capacityAutoRetry===true,maxAttempts:null,...sessions.capacityRetryStatus()}));
  app.put('/api/settings/capacity-retry',async request=>{
    const {enabled}=z.object({enabled:z.boolean()}).parse(request.body);
    await updateServerConfig(config,draft=>{draft.capacityAutoRetry=enabled;});
    sessions.setCapacityAutoRetry(config.capacityAutoRetry===true);
    return {enabled,maxAttempts:null};
  });
  app.put('/api/settings/remote-approval',async request=>{
    const {desktopAutoApprove}=z.object({desktopAutoApprove:z.boolean()}).parse(request.body);
    await writeRemoteAutoApproval(desktopAutoApprove);
    return {desktopAutoApprove,...(desktopAutoApprove?await sessions.approvePendingAutomatically():{accepted:0,failed:0}),...codex.desktopApprovalStatus()};
  });
}
