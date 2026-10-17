import fs from 'node:fs';
import path from 'node:path';
import type {FastifyInstance} from 'fastify';
import type {StateStore} from './stateStore.js';
import {appHome} from './paths.js';

export type UploadRef={kind:'image'|'file';id:string};
const imageId=/^[a-f\d-]{36}\.(png|jpg|gif|webp)$/;
const fileId=/^[a-f\d-]{36}$/;
const key=(ref:UploadRef)=>`${ref.kind}:${ref.id}`;
function refs(value:unknown):UploadRef[]{
  if(!Array.isArray(value)||value.length>10000)throw Error('附件列表无效');
  return [...new Map(value.map(row=>{
    if(!row||!['image','file'].includes(row.kind)||typeof row.id!=='string'||!(row.kind==='image'?imageId:fileId).test(row.id))throw Error('附件标识无效');
    return [key(row),{kind:row.kind,id:row.id} as UploadRef] as const;
  })).values()];
}
function ownerId(value:unknown){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{8,100}$/.test(value))throw Error('草稿设备标识无效');return value;}

export class UploadStorage {
  private uploading=new Set<object>();
  constructor(private store:StateStore,private busy:()=>Promise<string>){ }
  pin(owner:unknown,ref:UploadRef){if(owner)this.store.addUploadDraft(ownerId(owner),ref);}
  private protections(){
    const result=new Map<string,string>();
    for(const ref of this.store.uploadDrafts())result.set(key(ref),'待发送草稿');
    for(const row of this.store.readFollowups())if(row.status!=='sent'){
      for(const [kind,items] of [['image',row.images],['file',row.files]] as const)
        if(Array.isArray(items))for(const item of items)if(item?.id)result.set(`${kind}:${item.id}`,'发送队列或编辑中的消息');
    }
    return result;
  }
  private root(){return path.resolve(appHome(),'uploads');}
  // Only the gateway's regular files are managed; links and unknown contents
  // are excluded so a selected ID cannot reach outside the upload directory.
  private item(ref:UploadRef){
    const root=this.root();if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())return;
    const target=path.resolve(root,ref.kind==='image'?ref.id:path.join('files',ref.id));
    if(!target.startsWith(root+path.sep))throw Error('附件路径无效');
    if(!fs.existsSync(target))return;
    const stat=fs.lstatSync(target);if(stat.isSymbolicLink())return;
    let name=ref.id,size=stat.size,date=stat.birthtimeMs||stat.mtimeMs;
    let parts=[{file:target,size:stat.size}];
    if(ref.kind==='file'){
      const parent=path.join(root,'files');if(fs.lstatSync(parent).isSymbolicLink()||!stat.isDirectory())return;
      const entries=fs.readdirSync(target);if(entries.some(entry=>!['content','meta.json'].includes(entry)))return;
      const content=path.join(target,'content'),meta=path.join(target,'meta.json');
      if(!fs.existsSync(content)||!fs.existsSync(meta)||!fs.lstatSync(content).isFile()||fs.lstatSync(content).isSymbolicLink()||!fs.lstatSync(meta).isFile()||fs.lstatSync(meta).isSymbolicLink())return;
      const data=JSON.parse(fs.readFileSync(meta,'utf8'));if(data.id!==ref.id)return;
      name=String(data.name||ref.id);size=fs.statSync(content).size+fs.statSync(meta).size;
      parts=[{file:content,size:fs.statSync(content).size},{file:meta,size:fs.statSync(meta).size}];
    }else{
      if(!stat.isFile())return;
      const meta=target+'.json';
      if(fs.existsSync(meta)&&fs.lstatSync(meta).isFile()&&!fs.lstatSync(meta).isSymbolicLink()){
        try{const data=JSON.parse(fs.readFileSync(meta,'utf8'));if(data.id===ref.id)name=String(data.name||name);}catch{}
        size+=fs.statSync(meta).size;
        parts.push({file:meta,size:fs.statSync(meta).size});
      }
      if(name===ref.id){const saved=this.store.events.find(event=>event.type==='user.message'&&event.images?.some(image=>image.id===ref.id));if(saved?.type==='user.message')name=saved.images?.find(image=>image.id===ref.id)?.name||name;}
    }
    return {...ref,name,size,createdAt:new Date(date).toISOString(),target,parts};
  }
  async list(){
    const blockedReason=await this.busy()||(this.uploading.size?'附件正在上传，完成后再清理':''),protectedRefs=this.protections(),root=this.root();
    const candidates:UploadRef[]=[];
    if(fs.existsSync(root)&&!fs.lstatSync(root).isSymbolicLink()){
      for(const id of fs.readdirSync(root))if(imageId.test(id))candidates.push({kind:'image',id});
      const files=path.join(root,'files');if(fs.existsSync(files)&&!fs.lstatSync(files).isSymbolicLink())for(const id of fs.readdirSync(files))if(fileId.test(id))candidates.push({kind:'file',id});
    }
    const items=candidates.flatMap(ref=>{try{const row=this.item(ref);if(!row)return [];const {target,parts,...item}=row;return [{...item,protectedReason:protectedRefs.get(key(ref))||''}];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {items,totalBytes:items.reduce((sum,row)=>sum+row.size,0),blockedReason};
  }
  async cleanup(value:unknown){
    const selected=refs(value);if(selected.length>1000)throw Error('一次最多清理 1000 个附件');
    let deletedCount=0,deletedBytes=0;const skipped:{id:string;reason:string}[]=[],failed:{id:string;reason:string}[]=[];
    const blockedReason=await this.busy()||(this.uploading.size?'附件正在上传，完成后再清理':'');
    for(const ref of selected){
      const reason=blockedReason||this.protections().get(key(ref));
      if(reason){skipped.push({id:ref.id,reason});continue;}
      // Recheck references and delete without yielding to a concurrent upload,
      // draft sync or task submission between the final check and deletion.
      let row:ReturnType<UploadStorage['item']>;
      try{
        row=this.item(ref);if(!row){skipped.push({id:ref.id,reason:'附件已不存在或不是可管理的文件'});continue;}
        if(ref.kind==='file')fs.rmSync(row.target,{recursive:true});else{
          fs.unlinkSync(row.target);const meta=row.target+'.json';
          if(fs.existsSync(meta)&&fs.lstatSync(meta).isFile()&&!fs.lstatSync(meta).isSymbolicLink())fs.unlinkSync(meta);
        }
      }catch(error){failed.push({id:ref.id,reason:error instanceof Error?error.message:'清理失败'});}
      finally{if(row){if(!fs.existsSync(row.parts[0].file))deletedCount++;deletedBytes+=row.parts.filter(part=>!fs.existsSync(part.file)).reduce((sum,part)=>sum+part.size,0);}}
    }
    return {deletedCount,deletedBytes,skipped,failed};
  }
  register(app:FastifyInstance){
    app.addHook('onRequest',async request=>{if(request.method==='POST'&&['/api/uploads/images','/api/uploads/files'].includes(request.url.split('?')[0]))this.uploading.add(request);});
    app.addHook('onResponse',async request=>{this.uploading.delete(request);});
    app.addHook('onError',async request=>{this.uploading.delete(request);});
    app.get('/api/uploads/storage',()=>this.list());
    app.put('/api/uploads/drafts',async request=>{const body=request.body as {owner?:unknown;items?:unknown};this.store.setUploadDrafts(ownerId(body?.owner),refs(body?.items));return {ok:true};});
    app.post('/api/uploads/cleanup',request=>this.cleanup((request.body as {items?:unknown})?.items));
  }
}
