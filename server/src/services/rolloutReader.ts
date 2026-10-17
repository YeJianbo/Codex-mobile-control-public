// Shared reading semantics with the running 25819 local console.
import fs from 'node:fs';
import {createZstdDecompress} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';

// Node 24.14 accepts truncated Zstd input (nodejs/node#64592). Validate frame
// boundaries independently; the native decoder still checks compressed content.
function frameValidator(){
  let stage='magic',need=4,header=Buffer.alloc(0),skip=0,after='magic',checksum=false,frames=0;
  const next=(name:string,bytes:number)=>{stage=name;need=bytes;header=Buffer.alloc(0);};
  const blockEnd=()=>next(checksum?'checksum':'magic',4);
  return new Transform({
    transform(chunk:Buffer,encoding:BufferEncoding,done){try{
      let at=0;
      while(at<chunk.length){
        if(skip){const n=Math.min(skip,chunk.length-at);skip-=n;at+=n;if(!skip){if(after==='end')blockEnd();else next(after,after==='block'?3:4);}continue;}
        const n=Math.min(need-header.length,chunk.length-at);header=Buffer.concat([header,chunk.subarray(at,at+n)]);at+=n;if(header.length<need)continue;
        if(stage==='magic'){
          const magic=header.readUInt32LE();
          if(magic===0xfd2fb528){frames++;next('descriptor',1);}
          else if((magic>>>4)===(0x184d2a50>>>4))next('skipSize',4);
          else throw new Error('Zstandard 帧标识无效');
        }else if(stage==='descriptor'){
          const flags=header[0];if(flags&8)throw new Error('Zstandard 保留位无效');
          checksum=!!(flags&4);const single=!!(flags&32),fcs=flags>>>6;
          const bytes=(single?0:1)+[0,1,2,4][flags&3]+(fcs?[0,2,4,8][fcs]:(single?1:0));
          if(bytes)next('frameHeader',bytes);else next('block',3);
        }else if(stage==='frameHeader')next('block',3);
        else if(stage==='block'){
          const value=header.readUIntLE(0,3),type=(value>>>1)&3,last=!!(value&1);
          if(type===3)throw new Error('Zstandard 块类型无效');
          skip=type===1?1:value>>>3;after=last?'end':'block';
          if(!skip){if(last)blockEnd();else next('block',3);}
        }else if(stage==='checksum')next('magic',4);
        else if(stage==='skipSize'){skip=header.readUInt32LE();after='magic';if(!skip)next('magic',4);}
      }
      done(null,chunk);
    }catch(e){done(e instanceof Error?e:new Error(String(e)));}},
    flush(done){done(stage==='magic'&&!header.length&&!skip&&frames?null:new Error('Zstandard 文件不完整'));}
  });
}

export const canonicalRollout=(file:string)=>file.endsWith('.jsonl.zst')?file.slice(0,-4):file;
export function resolveRollout(file:string){
  const plain=canonicalRollout(file);
  for(const candidate of [plain,...(plain.endsWith('.jsonl')?[plain+'.zst']:[])]){
    try{if(fs.statSync(candidate).isFile())return fs.realpathSync(candidate);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  throw Object.assign(new Error('会话日志不存在'),{code:'ENOENT'});
}

// Decode incrementally; consumers never materialize the uncompressed file on disk.
export async function* rolloutChunks(file:string,{signal,onBytes=()=>{}}:{signal?:AbortSignal;onBytes?:(bytes:number)=>void}={}){
  const input=fs.createReadStream(file,{highWaterMark:256*1024,signal});
  input.on('data',chunk=>onBytes(chunk.length));
  if(!file.endsWith('.jsonl.zst')){try{yield* input;}finally{input.destroy();}return;}
  const decoder=createZstdDecompress({chunkSize:256*1024});
  const pumping=pipeline(input,frameValidator(),decoder,{signal});
  // Attach immediately: a caller may stop iteration before the pump finishes.
  pumping.catch(()=>{});
  try{for await(const chunk of decoder)yield chunk;await pumping;}
  finally{input.destroy();decoder.destroy();await pumping.catch(()=>{});}
}

export async function rolloutTail(file:string,limit=512*1024){
  let tail=Buffer.alloc(0);
  for await(const chunk of rolloutChunks(file,{signal:AbortSignal.timeout(5000)})){
    tail=chunk.length>=limit?Buffer.from(chunk.subarray(chunk.length-limit)):Buffer.concat([tail.subarray(Math.max(0,tail.length+chunk.length-limit)),chunk]);
  }
  return tail;
}

type Tail={buffer:Buffer;startLine:number;totalLines:number;truncated:boolean};
const tails=new Map<string,{size:number;mtime:number;tail:Tail}>();
const pending=new Map<string,Promise<Tail>>();
const MAX_TAIL=4*1024*1024,MAX_FILES=8;
export async function compressedRolloutTail(file:string):Promise<Tail>{
 const stat=await fs.promises.stat(file),cached=tails.get(file);
 if(cached?.size===stat.size&&cached.mtime===stat.mtimeMs){tails.delete(file);tails.set(file,cached);return cached.tail;}
 const existing=pending.get(file);if(existing)return existing;
 const work=(async()=>{
  const ring=Buffer.alloc(MAX_TAIL);let write=0,retainedBytes=0,bytes=0,lines=0;
  for await(const chunk of rolloutChunks(file,{signal:AbortSignal.timeout(15000)})){
   bytes+=chunk.length;for(let at=chunk.indexOf(10);at!==-1;at=chunk.indexOf(10,at+1))lines++;
   if(chunk.length>=MAX_TAIL){chunk.copy(ring,0,chunk.length-MAX_TAIL);write=0;retainedBytes=MAX_TAIL;}
   else{
    const first=Math.min(chunk.length,MAX_TAIL-write);chunk.copy(ring,write,0,first);if(first<chunk.length)chunk.copy(ring,0,first);
    write=(write+chunk.length)%MAX_TAIL;retainedBytes=Math.min(MAX_TAIL,retainedBytes+chunk.length);
   }
  }
  let buffer=retainedBytes<MAX_TAIL?Buffer.from(ring.subarray(0,retainedBytes)):Buffer.concat([ring.subarray(write),ring.subarray(0,write)]);
  const truncated=bytes>buffer.length;if(truncated){const at=buffer.indexOf(10);buffer=at<0?Buffer.alloc(0):Buffer.from(buffer.subarray(at+1));}
  let retained=0;for(let at=buffer.indexOf(10);at!==-1;at=buffer.indexOf(10,at+1))retained++;
  const tail={buffer,startLine:lines-retained,totalLines:lines,truncated};
  tails.delete(file);tails.set(file,{size:stat.size,mtime:stat.mtimeMs,tail});
  while(tails.size>MAX_FILES)tails.delete(tails.keys().next().value!);
  return tail;
 })();pending.set(file,work);
 try{return await work;}finally{if(pending.get(file)===work)pending.delete(file);}
}
