import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {appHome} from './paths.js';
export type ImageAttachment={id:string;name:string};
const types:Record<string,string>={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
function imagePath(id:string) {
  if(!/^[a-f\d-]{36}\.(png|jpg|gif|webp)$/.test(id))throw new Error('无效的图片附件');
  return path.join(appHome(),'uploads',id);
}
export async function imageInputs(images:ImageAttachment[]=[]) {
  if(images.length>8)throw new Error('每条消息最多 8 张图片');
  return Promise.all(images.map(async image=>{
    const data=await fs.readFile(imagePath(image.id));
    return {type:'image',url:`data:${types[image.id.split('.').pop()!]};base64,${data.toString('base64')}`};
  }));
}
export function registerImageUploads(app:FastifyInstance) {
  app.post('/api/uploads/images',{bodyLimit:8*1024*1024},async request=>{
    const body=request.body as {dataUrl?:string;name?:string};
    const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z\d+/=]+)$/.exec(body?.dataUrl||'');
    if(!match)throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
    const data=Buffer.from(match[2],'base64');
    if(!data.length||data.length>5*1024*1024)throw new Error('图片大小需小于 5 MB');
    const valid=match[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?data[0]===255&&data[1]===216&&data[2]===255:match[1]==='gif'?/^GIF8[79]a/.test(data.subarray(0,6).toString()):data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
    if(!valid)throw new Error('图片内容与格式不符');
    const id=randomUUID()+'.'+(match[1]==='jpeg'?'jpg':match[1]);
    await fs.mkdir(path.dirname(imagePath(id)),{recursive:true});await fs.writeFile(imagePath(id),data);
    return {id,name:String(body.name||'图片').slice(0,160)};
  });
  app.get('/api/uploads/images/:id',async(request,reply)=>{
    const id=(request.params as {id:string}).id;
    const bytes=await fs.readFile(imagePath(id));
    return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type(types[id.split('.').pop()!]).send(bytes);
  });
}
