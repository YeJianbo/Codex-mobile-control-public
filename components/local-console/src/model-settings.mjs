export function validateModelSettings(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('模型设置无效');
  const result={};
  if(value.enabled!==undefined){if(typeof value.enabled!=='boolean')throw new Error('启停状态必须是布尔值');result.enabled=value.enabled;}
  if(value.route!=null){if(typeof value.route!=='object'||typeof value.route.providerId!=='string'||typeof value.route.model!=='string')throw new Error('模型路由设置无效');result.route={providerId:value.route.providerId,model:value.route.model};}
  if(value.displayName!=null && value.displayName!=='') {
    if(typeof value.displayName!=='string'||value.displayName.trim().length>160)throw new Error('菜单显示名最多 160 个字符');
    if(value.displayName.trim())result.displayName=value.displayName.trim();
  }
  if(value.contextWindow!=null && value.contextWindow!=='') {
    const n=Number(value.contextWindow);
    if(!Number.isInteger(n)||n<4096||n>2000000)throw new Error('上下文范围为 4096–2000000');
    result.contextWindow=n;
  }
  return result;
}
export function applyModelSettings(model, settings={}) {
  return {...model,...(settings.enabled===false?{visibility:'hide'}:{}),...(settings.displayName?{display_name:settings.displayName}:{}),
    ...(settings.contextWindow?{context_window:settings.contextWindow,max_context_window:settings.contextWindow}:{})};
}
