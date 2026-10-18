import fs from 'node:fs';
import {createZstdDecompress} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';

// Node 24.14 accepts truncated Zstd input (nodejs/node#64592). Validate frame
// boundaries independently; the native decoder still checks compressed content.
function frameValidator(){
  let stage='magic',need=4,header=Buffer.alloc(0),skip=0,after='magic',checksum=false,frames=0;
  const next=(name,bytes)=>{stage=name;need=bytes;header=Buffer.alloc(0);};
  const blockEnd=()=>next(checksum?'checksum':'magic',4);
  return new Transform({
    transform(chunk,encoding,done){try{
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
    }catch(e){done(e);}},
    flush(done){done(stage==='magic'&&!header.length&&!skip&&frames?null:new Error('Zstandard 文件不完整'));}
  });
}

export const canonicalRollout=file=>file.endsWith('.jsonl.zst')?file.slice(0,-4):file;
export function resolveRollout(file){
  const plain=canonicalRollout(file);
  for(const candidate of [plain,...(plain.endsWith('.jsonl')?[plain+'.zst']:[])]){
    try{if(fs.statSync(candidate).isFile())return fs.realpathSync.native(candidate);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  throw Object.assign(new Error('会话日志不存在'),{code:'ENOENT'});
}

// Decode incrementally; consumers never materialize the uncompressed file on disk.
export async function* rolloutChunks(file,{signal,onBytes=()=>{}}={}){
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

export async function rolloutTail(file,limit=512*1024){
  let tail=Buffer.alloc(0);
  for await(const chunk of rolloutChunks(file,{signal:AbortSignal.timeout(5000)})){
    tail=chunk.length>=limit?Buffer.from(chunk.subarray(chunk.length-limit)):Buffer.concat([tail.subarray(Math.max(0,tail.length+chunk.length-limit)),chunk]);
  }
  return tail;
}
