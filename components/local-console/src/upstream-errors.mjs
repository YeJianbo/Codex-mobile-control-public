// AiMaMi evidence: relay/models/error_hint, proxy_server/summarize_upstream_error,
// inject_hint_into_error and record_forward_failure (1.2.3 baseline).
export function redactError(value){return String(value??'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/\bsk-[\w-]+/g,'[redacted]').replace(/(api[_-]?key|access_token|authorization)(["'\s:=]+)[^\s,;"'}]+/gi,'$1$2[redacted]').replace(/https?:\/\/\S+/g,'[upstream URL]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').slice(0,800);}
export function errorHint(status,message='',code=''){
 const text=`${message} ${code}`.toLowerCase();
 if(/insufficient_quota|insufficient quota|billing|balance|quota.*exceeded|exceeded.*quota/.test(text))return {category:'quota',hint:'上游额度或余额不足，请检查该账号／中转站的额度。',retryable:false};
 if(/context_length|too many tokens|maximum context/.test(text))return {category:'context',hint:'请求超过上游上下文限制，请压缩会话或降低上下文上限。',retryable:false};
 if(/image[_ ]generation|image_url/.test(text))return {category:'image',hint:'上游不支持当前图片或生图声明，请检查该模型能力及图片兼容设置。',retryable:false};
 if(status===401||/invalid.api.key|incorrect.api.key/.test(text))return {category:'auth',hint:'认证失败，请检查对应入口的登录状态或 API 密钥。',retryable:false};
 if(/model_not_found|model not found|does not exist|no access to model|does not have access/.test(text))return {category:'model',hint:'模型不存在或当前账号无权限，请核对模型 ID 和提供商。',retryable:false};
 if(status===403)return {category:'permission',hint:/region|country|\bip\b/.test(text)?'上游限制了当前网络出口或地区。':'上游拒绝访问，请检查账号权限和模型能力。',retryable:false};
 if(status===429)return {category:'rate_limit',hint:'上游正在限流，请按 Retry-After 等待后重试，或降低并发。',retryable:true};
 if(/stream_incomplete|response.incomplete|stream.*(interrupt|disconnect)|响应流|响应未完成/.test(text))return {category:'stream',hint:'响应流提前结束，可重试；若持续出现，请检查上游服务和网络代理。',retryable:true};
 if(status===504||/timeout|timed out/.test(text))return {category:'timeout',hint:'上游响应超时，请稍后重试并检查网络代理。',retryable:true};
 if(/certificate|tls|ssl/.test(text))return {category:'tls',hint:'TLS／证书校验失败，请检查系统时间、证书和网络代理。',retryable:false};
 if(/enotfound|eai_again|dns|resolve/.test(text))return {category:'dns',hint:'域名解析失败，请检查 DNS 和网络代理。',retryable:true};
 if(status>=500)return {category:'upstream',hint:'上游暂时不可用，请稍后重试。',retryable:true};
 return {category:'request',hint:'请核对上游返回的错误及当前模型配置。',retryable:false};
}
export function summarizeError(status,value,requestId=null){
 const error=value?.error??value?.response?.error??value;
 const message=redactError(typeof error==='string'?error:error?.message||`上游 HTTP ${status}`);
 const code=redactError(error?.code||error?.type||'').slice(0,80);
 return {status,message,code,requestId:requestId?redactError(requestId).slice(0,100):null,...errorHint(status,message,code)};
}
export async function readErrorResponse(response,limit=64*1024){
 const reader=response.body?.getReader();let size=0,chunks=[],truncated=false;
 if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){truncated=true;await reader.cancel();break;}chunks.push(value);}}finally{reader.releaseLock();}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{value={error:{message:truncated?'上游错误响应超过大小限制':`上游返回非 JSON 错误（HTTP ${response.status}）`}};}
 const summary=summarizeError(response.status,value,response.headers.get('x-request-id')||response.headers.get('request-id'));
 const original=value?.error&&typeof value.error==='object'?value.error:{};
 return {summary,body:{error:{message:`${summary.message}\n${summary.hint}${summary.requestId?'\n请求 ID：'+summary.requestId:''}`,type:redactError(original.type||'upstream_error'),code:summary.code||'upstream_error',...(typeof original.param==='string'?{param:redactError(original.param)}:{}),hint:summary.hint,request_id:summary.requestId}}};
}
