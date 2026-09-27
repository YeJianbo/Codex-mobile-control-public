import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform, type Readable} from 'node:stream';
import type {FastifyInstance} from 'fastify';
import {appHome} from './paths.js';

export type FileAttachment={id:string;name:string;mime:string;size:number};
const maxSize=100*1024*1024;
const root=()=>path.join(appHome(),'uploads','files');
function directory(id:string){if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('无效的文件附件');return path.join(root(),id);}
function safeName(name:string){return path.basename(name.replaceAll('\\','/')).replace(/[\x00-\x1f<>:"|?*]/g,'_').slice(0,160)||'附件';}
function safeMime(mime:string){return /^[\w.+-]+\/[\w.+-]+$/.test(mime)?mime:'application/octet-stream';}
export async function resolveFiles(files:FileAttachment[]=[]){
  if(files.length>8)throw new Error('每条消息最多 8 个文件');
  return Promise.all(files.map(async file=>{
    const folder=directory(file.id);
    const meta=JSON.parse(await fsp.readFile(path.join(folder,'meta.json'),'utf8')) as FileAttachment;
    if(meta.id!==file.id)throw new Error('无效的文件附件');
    const absolutePath=path.join(folder,'content');
    const stat=await fsp.stat(absolutePath);
    if(stat.size!==meta.size)throw new Error('文件附件不完整');
    return {...meta,absolutePath};
  }));
}
export function filePrompt(files:Awaited<ReturnType<typeof resolveFiles>>){
  return files.length?'\n\n用户附加文件（可在本机按路径读取；若为视频，请按任务需要提取画面或元数据）：\n'+files.map(file=>`- ${JSON.stringify(file.name)}: ${file.absolutePath} (${file.mime}, ${file.size} bytes)`).join('\n'):'';
}
export function registerFileUploads(app:FastifyInstance){
  app.addContentTypeParser('application/octet-stream',(request,payload,done)=>done(null,payload));
  app.post('/api/uploads/files',async(request,reply)=>{
    const name=safeName(decodeURIComponent(String(request.headers['x-file-name']||'附件')));
    const mime=safeMime(String(request.headers['x-file-type']||'application/octet-stream'));
    const id=randomUUID(),folder=directory(id);await fsp.mkdir(folder,{recursive:true});
    let size=0;
    try{
      await pipeline(request.body as Readable,new Transform({transform(chunk:Buffer,_encoding,callback){size+=chunk.length;callback(size>maxSize?new Error('文件不能超过 100 MB'):null,chunk);}}),fs.createWriteStream(path.join(folder,'content'),{flags:'wx'}));
      if(!size)throw new Error('文件不能为空');
      const result={id,name,mime,size};await fsp.writeFile(path.join(folder,'meta.json'),JSON.stringify(result));
      return reply.code(201).send(result);
    }catch(error){await fsp.rm(folder,{recursive:true,force:true});throw error;}
  });
  app.get('/api/uploads/files/:id',async(request,reply)=>{
    const file=(await resolveFiles([{id:(request.params as {id:string}).id,name:'',mime:'',size:0}]))[0];
    const range=String(request.headers.range||'');let start=0,end=file.size-1,status=200;
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return reply.code(416).header('Content-Range',`bytes */${file.size}`).send();
      if(match[1])start=Number(match[1]);else start=Math.max(0,file.size-Number(match[2]));
      if(match[1]&&match[2])end=Math.min(end,Number(match[2]));
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.size)return reply.code(416).header('Content-Range',`bytes */${file.size}`).send();
      status=206;
    }
    const inline=/^(video|audio)\/[\w.+-]+$/.test(file.mime)||/^image\/(png|jpeg|gif|webp)$/.test(file.mime)||file.mime==='application/pdf';
    reply.code(status).header('Accept-Ranges','bytes').header('Content-Length',String(end-start+1)).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`).type(file.mime);
    if(status===206)reply.header('Content-Range',`bytes ${start}-${end}/${file.size}`);
    return reply.send(fs.createReadStream(file.absolutePath,{start,end}));
  });
}
