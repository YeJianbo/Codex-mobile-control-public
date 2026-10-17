// Runs only in the spawned OpenCode process. The native tool still performs its
// own permission checks after this hook; a gateway grant never overrides a deny.
export default async function mobilePolicy(_input,options){
  const endpoint=options?.endpoint,token=options?.token;
  if(typeof endpoint!=='string'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Missing mobile permission channel');
  const request=async(route,value,timeout)=>{
    const response=await fetch(endpoint+route,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(value),...(timeout?{signal:AbortSignal.timeout(timeout)}:{})});
    if(!response.ok)throw Error('Mobile permission channel rejected request');
    const result=await response.json();return result.allowed===true;
  };
  if(!await request('/ready',{},10000))throw Error('Mobile permission channel not ready');
  return {
    async 'tool.execute.before'(input,output){
      const allowed=await request('/approve',{sessionID:input.sessionID,callID:input.callID,tool:input.tool,args:output.args}).catch(()=>false);
      if(!allowed)throw Error('Tool execution rejected by mobile permission policy');
    },
  };
}
