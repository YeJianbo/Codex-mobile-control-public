import fs from 'node:fs/promises';
import {serverConfigPath} from './configStore.js';

export const zcodeRecoveryInputPrefix='cmc-busy-recovery-';
export const zcodeRecoveryPrompt='继续刚才未完成的任务，从中断处接着执行，保留已完成的操作，不要重复执行。';
export function isZcodeRecoveryInput(message:any){
  const intent=message.metadata?.inputIntent;
  return message.role==='user'&&intent?.clientId==='legacy-session-send'&&
    message.anchor?.sourceCommandId?.startsWith(zcodeRecoveryInputPrefix)&&intent.text===zcodeRecoveryPrompt;
}
export function isZcodeBusyError(error:unknown){
  const text=error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error??{});
  return /Start Plan is busy|startPlanBusyAutoRetryExhausted|\bat[ _-]*capacity\b|server[ _-]*overloaded|model.{0,40}(?:temporarily )?overloaded|模型.{0,12}(?:容量不足|繁忙|过载)/i.test(text);
}
export async function zcodeRecoveryEnabled(){
  const config=JSON.parse(await fs.readFile(serverConfigPath(),'utf8'));
  return config.capacityAutoRetry===true;
}
export const zcodeRecoveryDelay=(attempt:number)=>Math.min(120000,15000*2**Math.min(attempt-1,3));
