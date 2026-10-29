// Minimal native wire reader shared by usage and current-turn reconciliation.
export function agyNativeFields(bytes:Uint8Array):Map<number,number|Buffer>{
  const data=Buffer.from(bytes),values=new Map<number,number|Buffer>();let offset=0;
  const integer=()=>{
    let value=0,shift=0;
    for(let count=0;count<10&&offset<data.length;count++){
      const byte=data[offset++];value+=(byte&127)*2**shift;
      if(!(byte&128)){if(!Number.isSafeInteger(value))throw Error('Invalid generation integer');return value;}
      shift+=7;
    }
    throw Error('Truncated generation integer');
  };
  while(offset<data.length){
    const tag=integer(),field=Math.floor(tag/8),wire=tag%8;
    if(!field)throw Error('Invalid generation field');
    if(wire===0){const value=integer();if(!values.has(field))values.set(field,value);}
    else if(wire===2){
      const size=integer();if(offset+size>data.length)throw Error('Truncated generation field');
      if(!values.has(field))values.set(field,data.subarray(offset,offset+size));offset+=size;
    }else if(wire===1||wire===5){offset+=wire===1?8:4;if(offset>data.length)throw Error('Truncated generation field');}
    else throw Error('Unsupported generation wire type');
  }
  return values;
}
export function agyGenerationUsage(bytes:Uint8Array){
  // Read only generation counters; leave prompt and tool content untouched.
  const chat=agyNativeFields(bytes).get(1);if(!Buffer.isBuffer(chat))return null;
  const metadata=agyNativeFields(chat),raw=metadata.get(4);if(!Buffer.isBuffer(raw))return null;
  const usage=agyNativeFields(raw),number=(id:number)=>typeof usage.get(id)==='number'?usage.get(id) as number:0;
  const text=(value:unknown)=>Buffer.isBuffer(value)?value.toString('utf8'):'';
  return {model:text(metadata.get(19)||metadata.get(22)||metadata.get(21)),messageId:text(usage.get(7)||usage.get(11)),
    input:number(2),output:number(3),cacheWrite:number(4),cached:number(5),reasoning:number(9)};
}
