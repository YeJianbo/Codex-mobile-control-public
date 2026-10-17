import {promises as fs,type Stats} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Point={offset:number;line:number};
type Saved={version:1;file:string;dev:number;ino:number;birthtime:number;size:number;mtime:number;points:Point[]};
const stride=8*1024*1024;

// This derived index only counts newlines; the native rollout stays untouched.
// Its points may fall inside a JSON line, since readers resume byte counting,
// never JSON decoding, at those offsets.
export class HistoryOffsetIndex {
  private dirty=false;
  private constructor(private readonly destination:string,private readonly saved:Saved){}

  static async open(file:string,stat:Stats,directory=path.join(process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control'),'history-offsets')):Promise<HistoryOffsetIndex>{
    const destination=path.join(directory,path.basename(file)+'.offsets.json');
    let saved:Saved={version:1,file,dev:stat.dev,ino:stat.ino,birthtime:stat.birthtimeMs,size:stat.size,mtime:stat.mtimeMs,points:[]};
    try{
      const value=JSON.parse(await fs.readFile(destination,'utf8')) as Saved;
      if(value.version===1&&value.file===file&&value.dev===stat.dev&&value.ino===stat.ino&&value.birthtime===stat.birthtimeMs&&
        value.size<=stat.size&&(value.size!==stat.size||value.mtime===stat.mtimeMs)&&Array.isArray(value.points)&&
        value.points.every((point,i)=>Number.isSafeInteger(point.offset)&&point.offset>0&&point.offset<=value.size&&
          Number.isSafeInteger(point.line)&&point.line>=0&&(!i||point.offset>value.points[i-1].offset&&point.line>=value.points[i-1].line)))saved={...saved,points:value.points};
    }catch{/* Missing or stale derived data falls back to a normal prefix scan. */}
    return new HistoryOffsetIndex(destination,saved);
  }

  before(offset:number):Point{
    let best={offset:0,line:0};
    for(const point of this.saved.points){if(point.offset>offset)break;best=point;}
    return best;
  }

  beforeLine(line:number):Point{
    let best={offset:0,line:0};
    // Points may lie inside a JSON line. Start before the preceding physical
    // line has ended, so the first requested line is always read in full.
    for(const point of this.saved.points){if(point.line>=line-1)break;best=point;}
    return best;
  }

  record(offset:number,line:number):void{
    const previous=this.saved.points.at(-1)?.offset??0;
    if(offset-previous<stride||offset>this.saved.size)return;
    this.saved.points.push({offset,line});this.dirty=true;
  }

  async save():Promise<void>{
    if(!this.dirty)return;
    // Per-rollout files and atomic replacement prevent readers from observing a
    // half-written index. Cache write failures must not prevent history access.
    const temporary=this.destination+`.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try{
      await fs.mkdir(path.dirname(this.destination),{recursive:true});
      await fs.writeFile(temporary,JSON.stringify(this.saved));
      await fs.rename(temporary,this.destination);this.dirty=false;
    }catch{await fs.unlink(temporary).catch(()=>{});}
  }
}
