import fs from 'node:fs/promises';
import TOML from '@iarna/toml';
import {userCodexConfigPath} from '../src/services/paths.ts';
import {CodexAppServerClient} from '../src/codex/appServerClient.ts';
import {readModelCatalog} from '../src/services/modelCatalog.ts';
import {readUserSettings} from '../src/services/codexSettings.ts';
const c=new CodexAppServerClient();
try{
 const {models}=await readModelCatalog(c);const settings=await readUserSettings();
 const model=models.find(m=>m.model===settings.model)||models[0];

 const t=await c.request('thread/start',{model:model.model,cwd:process.cwd(),ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
 let text='';
 const completed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('real model probe timed out')),60000);c.on('notification',m=>{if(m.params?.threadId!==t.thread.id)return;if(m.method==='item/agentMessage/delta')text+=m.params.delta;if(m.method==='turn/completed'){clearTimeout(timer);resolve(m.params.turn)}})});
 await c.request('turn/start',{threadId:t.thread.id,model:model.model,effort:model.supportedReasoningEfforts[0]?.reasoningEffort,input:[{type:'text',text:'只回复 MODEL_PICKER_OK。不要调用任何工具，不要读取或修改任何文件。',text_elements:[]}]});
 const turn=await completed;console.log(JSON.stringify({model:model.model,status:turn.status,text,error:turn.error}));
 if(turn.status!=='completed'||!text.includes('MODEL_PICKER_OK'))process.exitCode=1;
}finally{await c.stop();}


