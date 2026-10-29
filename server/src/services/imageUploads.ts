import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {appHome} from './paths.js';
import type {UploadStorage} from './uploadStorage.js';
export type ImageAttachment={id:string;name:string};
const types:Record<string,string>={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
export function uploadedImageFormat(data:Buffer):string|undefined {
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(data[0]===255&&data[1]===216&&data[2]===255)return 'jpg';
  if(/^GIF8[79]a$/.test(data.subarray(0,6).toString()))return 'gif';
  if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return 'webp';
  return undefined;
}
function imagePath(id:string) {
  if(!/^[a-f\d-]{36}\.(png|jpg|gif|webp)$/.test(id))throw new Error('无效的图片附件');
  return path.join(appHome(),'uploads',id);
}
export function matchesUploadedImagePath(image:ImageAttachment,attachmentPath:string):boolean {
  try{
    const normalize=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
    return normalize(attachmentPath)===normalize(imagePath(image.id));
  }catch{return false;}
}
export function isUploadedImagePath(attachmentPath:string):boolean {
  return path.isAbsolute(attachmentPath)&&/^[a-f\d-]{36}\.(png|jpg|gif|webp)$/.test(path.relative(path.join(appHome(),'uploads'),path.resolve(attachmentPath)));
}
export async function uploadedImageFromPath(attachmentPath:string,name='图片'):Promise<ImageAttachment|undefined>{
  if(!isUploadedImagePath(attachmentPath))return undefined;
  const id=path.basename(attachmentPath);
  try{return (await fs.stat(imagePath(id))).isFile()?{id,name}:undefined;}catch{return undefined;}
}
export async function imageInputs(images:ImageAttachment[]=[]) {
  return Promise.all(images.map(async image=>{
    const data=await fs.readFile(imagePath(image.id));
    return {type:'image',url:`data:${types[image.id.split('.').pop()!]};base64,${data.toString('base64')}`};
  }));
}
// CLIs that only accept text blocks (Antigravity) still read local files, so an
// uploaded image can be handed over as a path instead of being rejected.
export async function resolveImageFiles(images:ImageAttachment[]=[]){
  if(images.length>8)throw new Error('每条消息最多 8 张图片');
  return Promise.all(images.map(async image=>{
    const file=imagePath(image.id);
    const stat=await fs.stat(file);
    if(!stat.isFile())throw new Error('无效的图片附件');
    return {name:image.name||path.basename(file),absolutePath:path.resolve(file),mime:types[image.id.split('.').pop()!]||'image/png',size:stat.size};
  }));
}
export async function codexImageInputs(images:ImageAttachment[]=[]) {
  return Promise.all(images.map(async image=>{
    const file=path.resolve(imagePath(image.id));
    const stat=await fs.stat(file);
    if(!stat.isFile())throw new Error('无效的图片附件');
    // App Server reads uploaded files locally; image bytes need not cross its RPC transport.
    return {type:'localImage' as const,path:file};
  }));
}
export function registerImageUploads(app:FastifyInstance,storage?:UploadStorage) {
  app.post('/api/uploads/images',{bodyLimit:8*1024*1024},async request=>{
    const body=request.body as {dataUrl?:string;name?:string};
    const match=/^data:image\/([a-z\d.+-]+);base64,([A-Za-z\d+/=]+)$/i.exec(body?.dataUrl||'');
    if(!match)throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
    const data=Buffer.from(match[2],'base64');
    if(!data.length||data.length>5*1024*1024)throw new Error('图片大小需小于 5 MB');
    const format=uploadedImageFormat(data);
    if(!format){
      if(data.subarray(4,8).toString()==='ftyp'&&/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(data.subarray(8,12).toString()))
        throw new Error('此图片实际为 HEIC 格式，请转换为 JPEG 或 PNG 后上传');
      throw new Error('图片内容与格式不符');
    }
    const id=randomUUID()+'.'+format;
    await fs.mkdir(path.dirname(imagePath(id)),{recursive:true});await fs.writeFile(imagePath(id),data);
    const result={id,name:String(body.name||'图片').slice(0,160)};
    await fs.writeFile(imagePath(id)+'.json',JSON.stringify(result));
    storage?.pin(request.headers['x-upload-owner'],{kind:'image',id});
    return result;
  });
  app.get('/api/uploads/images/:id',async(request,reply)=>{
    const id=(request.params as {id:string}).id;
    const bytes=await fs.readFile(imagePath(id));
    return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type(types[id.split('.').pop()!]).send(bytes);
  });
}
