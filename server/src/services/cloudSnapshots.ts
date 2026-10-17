import {promises as fs} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {appHome} from './paths.js';
import type {GatewayEvent,ThreadRecord} from '../types.js';

const timestamp=z.string().datetime({offset:true}).refine(value=>Date.parse(value)<=Date.now()+60000,'快照时间不能晚于当前时间');
const message=z.object({id:z.string().max(160).optional(),role:z.enum(['user','assistant']),text:z.string().max(100000),createdAt:timestamp.optional()}).strict();
export const cloudSnapshotImportSchema=z.object({schemaVersion:z.literal(1),snapshots:z.array(z.object({
  externalId:z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/),title:z.string().trim().min(1).max(160),
  updatedAt:timestamp,status:z.enum(['running','completed','error','interrupted','unknown']),
  contentKind:z.enum(['summary','messages']).default('summary'),
  projectPath:z.string().max(2000).optional(),messages:z.array(message).max(200),
}).strict()).min(1).max(50)}).strict();
export type CloudSnapshot=z.infer<typeof cloudSnapshotImportSchema>['snapshots'][number];
const storedSchema=cloudSnapshotImportSchema.extend({snapshots:cloudSnapshotImportSchema.shape.snapshots.element.array().max(200)});
const prefix='cloud-snapshot:';
export const isCloudSnapshot=(id:string)=>id.startsWith(prefix);
export function assertControllableThread(id:string){if(isCloudSnapshot(id)||id.startsWith('cloud:'))throw new Error('此云端会话仅供查看，请在桌面操作。');}

export class CloudSnapshots {
  private rows:CloudSnapshot[]=[];
  private loaded?:Promise<void>;
  private write=Promise.resolve();
  constructor(private file=path.join(appHome(),'cloud-snapshots.json')){}
  private load(){return this.loaded??=fs.readFile(this.file,'utf8').then(raw=>{this.rows=storedSchema.parse(JSON.parse(raw)).snapshots;}).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  async import(input:unknown){
    const validated=cloudSnapshotImportSchema.parse(input);
    const text=JSON.stringify(validated);
    if(Buffer.byteLength(text)>900000)throw new Error('快照内容过大，请分批导入（每批不超过 900 KB）。');
    if(/<(?:system|developer|environment_context|codex_delegation|recommended_plugins|INSTRUCTIONS)\b/i.test(text))throw new Error('请先移除内部指令和执行环境记录，仅导入用户可见摘要或消息。');
    if(/\bsk-[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._-]{20,}/i.test(text))throw new Error('导入内容疑似包含凭据，请删除后再导入。');
    const ids=new Set<string>();
    for(const row of validated.snapshots){if(ids.has(row.externalId))throw new Error('同一批快照包含重复会话 ID。');ids.add(row.externalId);}
    const operation=this.write.then(async()=>{
      await this.load();
      const merged=new Map(this.rows.map(row=>[row.externalId,row]));
      for(const row of validated.snapshots){const previous=merged.get(row.externalId);if(previous&&Date.parse(previous.updatedAt)>Date.parse(row.updatedAt))throw new Error('导入快照比已保存版本更旧，请确认快照时间。');merged.set(row.externalId,row);}
      const rows=[...merged.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      if(rows.length>200)throw new Error('最多保存 200 个云端快照。');
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temporary=this.file+'.tmp';
      await fs.writeFile(temporary,JSON.stringify({schemaVersion:1,snapshots:rows}),{mode:0o600});
      await fs.rename(temporary,this.file);this.rows=rows;
      return validated.snapshots.length;
    });
    this.write=operation.then(()=>{},()=>{});return operation;
  }
  async list():Promise<ThreadRecord[]>{await this.load();return this.rows.map(row=>this.record(row));}
  async read(id:string,count=200,turns?:number){await this.load();const row=this.rows.find(row=>prefix+row.externalId===id);if(!row)throw new Error('云端快照不存在，请先导入。');
    let start=Math.max(0,row.messages.length-count);
    if(turns!==undefined){start=0;let seen=0;for(let i=row.messages.length-1;i>=0;i--)if(row.messages[i].role==='user'&&++seen===turns){start=i;break;}}
    const events:GatewayEvent[]=row.messages.slice(start).map((message,index)=>({type:message.role==='user'?'user.message':'message.delta',threadId:id,text:message.text,itemId:`snapshot:${start+index}`,eventId:`snapshot:${id}:${row.updatedAt}:${start+index}`,createdAt:message.createdAt||row.updatedAt}));
    return {status:'idle',readOnly:true,snapshot:this.record(row),hasMore:start>0,events};
  }
  private record(row:CloudSnapshot):ThreadRecord{return {id:prefix+row.externalId,title:row.title,projectPath:row.projectPath,status:'idle',createdAt:row.updatedAt,updatedAt:row.updatedAt,source:'cloudSnapshot',readOnly:true,snapshotUpdatedAt:row.updatedAt,snapshotStatus:row.status,snapshotContentKind:row.contentKind,snapshotStale:Date.now()-Date.parse(row.updatedAt)>300000};}
}
