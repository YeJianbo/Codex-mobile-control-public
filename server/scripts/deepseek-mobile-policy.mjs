export const inject=['permissionPresets'];

// Resumed sessions retain native permission events. Reset only this ACP root
// before its next model step; delegated children retain their own restrictions.
export function apply(ctx){
  const preset=process.env.CMC_DSH_PERMISSION_PRESET;
  if(!['workspace-write','danger-full-access'].includes(preset))throw Error('Missing mobile permission preset');
  ctx.on('agent/pre-step',({agent},next)=>{
    if(!agent.parentAgent)ctx.permissionPresets.set(agent.session,preset);
    return next();
  });
  process.stderr.write('CMC_DSH_PERMISSION_ADAPTER_READY\n');
}
