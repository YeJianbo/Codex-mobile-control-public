import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {CodexAppServerClient} from '../src/codex/appServerClient.ts';
import {imageInputs} from '../src/services/imageUploads.ts';
import {appHome} from '../src/services/paths.ts';
import {readUserSettings} from '../src/services/codexSettings.ts';
const config=JSON.parse(await fs.readFile(path.join(appHome(),'server.json'),'utf8'));
const png=new PNG({width:64,height:64});for(let i=0;i<png.data.length;i+=4){png.data[i]=0;png.data[i+1]=0;png.data[i+2]=255;png.data[i+3]=255;}
const response=await fetch(`http://127.0.0.1:${config.port}/api/uploads/images`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'vision-probe.png',dataUrl:'data:image/png;base64,'+PNG.sync.write(png).toString('base64')})});
if(!response.ok)throw new Error('Image upload failed');
const image=await response.json();
const c=new CodexAppServerClient();
try {
  const model=(await readUserSettings()).model;
  const thread:any=await c.request('thread/start',{model,ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
  let text='';const done=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Image model probe timeout')),60000);c.on('notification',m=>{if(m.params?.threadId!==thread.thread.id)return;if(m.method==='item/agentMessage/delta')text+=m.params.delta;if(m.method==='turn/completed'){clearTimeout(timer);resolve(m.params.turn)}})});
  await c.request('turn/start',{threadId:thread.thread.id,model,effort:'low',input:[{type:'text',text:'这张图片的主要颜色是什么？只回复中文颜色名称。不要调用工具或修改文件。',text_elements:[]},...await imageInputs([image])]});
  const turn=await done;console.log(JSON.stringify({model,status:turn.status,answer:text}));
  if(turn.status!=='completed'||!text.includes('蓝'))throw new Error('Image recognition did not match the generated blue image');
} finally {await c.stop();await fs.unlink(path.join(appHome(),'uploads',image.id));}
