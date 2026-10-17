export function codexErrorPresentation(error:unknown,willRetry=false){
  const value=error&&typeof error==='object'?error as Record<string,unknown>:{};
  const message=typeof value.message==='string'?value.message:typeof error==='string'?error:'任务执行失败';
  const detail=[message];
  if(typeof value.additionalDetails==='string'&&value.additionalDetails&&value.additionalDetails!==message)detail.push(value.additionalDetails);
  if(value.codexErrorInfo!=null)detail.push('错误类型：'+(typeof value.codexErrorInfo==='string'?value.codexErrorInfo:JSON.stringify(value.codexErrorInfo,null,2)));
  if(value.misalignment!=null)detail.push('说明：'+JSON.stringify(value.misalignment,null,2));
  const attempt=/(?:reconnecting|retrying|正在重新连接)\s*(\d+\s*\/\s*\d+)/i.exec(detail.join('\n'))?.[1];
  return {message,detail:detail.join('\n\n'),title:willRetry?'正在重新连接'+(attempt?' '+attempt:''):'执行失败',willRetry};
}
export function isCapacityError(error:unknown):boolean {
  const value=error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error??{});
  return /\bat[ _-]*capacity\b|server[ _-]*overloaded|model.{0,40}(?:temporarily )?overloaded|模型.{0,12}(?:容量不足|繁忙|过载)/i.test(value);
}

