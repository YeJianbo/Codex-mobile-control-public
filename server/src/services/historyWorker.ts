import {parentPort} from 'node:worker_threads';
import * as history from './codexSessions.js';
import {readZcodeNativeEvents,readZcodeNativeIndex} from './zcodeNativeSessions.js';
import {readStoredThreadEvents} from './storedThreadHistory.js';

const methods={
  readStoredThreadEvents,
  readCodexConversationPreview:history.readCodexConversationPreview,
  readZcodeNativeEvents,
  readZcodeNativeIndex,
  invalidateCodexHistory:history.invalidateCodexHistory,
  readRecentSearchEvents:history.readRecentSearchEvents,
  readCodexThreadEvents:history.readCodexThreadEvents,
  readCodexConversationEvents:history.readCodexConversationEvents,
  readCodexActivityEventsByIds:history.readCodexActivityEventsByIds,
  readCodexThreadEventById:history.readCodexThreadEventById,
  readCodexOutputEventById:history.readCodexOutputEventById,
  readCodexOutputSourceEventById:history.readCodexOutputSourceEventById,
  readCodexThreadEmbeddedImage:history.readCodexThreadEmbeddedImage,
  readCodexHistoryImageSource:history.readCodexHistoryImageSource,
};
parentPort!.on('message',async(message:{id:number;method:keyof typeof methods;args:any[];env:Record<string,string|undefined>})=>{
  try{
    for(const [key,value]of Object.entries(message.env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    const method=methods[message.method] as (...args:any[])=>Promise<unknown>;
    if(!method)throw new Error('不支持的历史读取操作');
    const value=await method(...message.args);parentPort!.postMessage({id:message.id,value});
  }catch(error){parentPort!.postMessage({id:message.id,error:error instanceof Error?error.message:'历史读取失败'});}
});
