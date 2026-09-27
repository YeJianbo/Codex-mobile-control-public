export function isWriterOccupied(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return /active writer|正在桌面执行|当前任务仍在运行/i.test(message);
}

export function userFacingError(error:unknown):string {
  const message=error instanceof Error?error.message:String(error);
  if(/active writer/i.test(message))
    return '桌面版仍持有此会话的写入权，即使没有任务在执行。消息已保留；写入权释放后自动发送。';
  if(isWriterOccupied(error))
    return '当前任务仍在执行，消息已保留并等待本轮完成。';
  return message;
}
