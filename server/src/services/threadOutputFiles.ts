import fs from 'node:fs/promises';
import path from 'node:path';
import {Marked} from 'marked';
import {fileCitationExtension} from './fileCitation.js';

const marked=new Marked({extensions:[fileCitationExtension]});

export function activityOutputImageText(event:{type:string;title?:string;detail?:string;text?:string}|undefined|null):string|null {
  if(!event||!['tool.started','tool.completed'].includes(event.type)||!/查看图片|view_image|imageview/i.test(event.title||''))return null;
  const images:string[]=[];
  marked.walkTokens(marked.lexer(event.detail||event.text||''),token=>{
    if(token.type==='image'&&token.text==='查看图片'&&!/[<>\r\n]/.test(token.href))images.push(`![查看图片](<${token.href}>)`);
  });
  return images.length?images.join('\n'):null;
}

export function storedOutputMessage(events:Array<{type:string;eventId?:string;itemId?:string;text?:string}>,eventId:string){
  const index=events.findIndex(event=>event.eventId===eventId);
  const first=events[index];
  if(first?.type!=='message.delta')return undefined;
  let text=first.text||'';
  for(let next=index+1;next<events.length;next++){
    const event=events[next];
    if(event.type!=='message.delta'||event.itemId!==first.itemId)break;
    text+=event.text||'';
  }
  return {type:'message.delta' as const,text};
}

export function localOutputPath(href:string,cwd:string):string {
  const link=href.replace(/^file:\/\//i,'').replaceAll('\\','/').replace(/^\/\/\?\//,'');
  let file=decodeURIComponent(link.split('#')[0].split('?')[0]).replace(/^file:\/\//i,'').replaceAll('\\','/').replace(/^\/\/\?\//,'').replace(/^\/([a-z]:\/)/i,'$1');
  if(/^[a-z][a-z\d+.-]*:/i.test(file)&&!/^[a-z]:\//i.test(file))throw new Error('不是本地文件链接');
  file=file.replace(/:\d+(?::\d+)?$/,'');
  if(!path.isAbsolute(file)&&!cwd)throw new Error('无法确定会话工作目录');
  return path.resolve(cwd||'.',file);
}

// A paired LAN client can read a visible output link; this is never a persistent project grant.
async function resolveReferencedOutput(text:string,href:string,cwd:string){
  const requested=localOutputPath(href,cwd);
  const normalize=(file:string)=>process.platform==='win32'?file.toLowerCase():file;
  const links:string[]=[];
  marked.walkTokens(marked.lexer(text),token=>{if(token.type==='link'||token.type==='image')links.push(token.href);});
  const referenced=links.some(href=>{try{return normalize(localOutputPath(href,cwd))===normalize(requested);}catch{return false;}});
  if(!referenced)throw new Error('文件不是这条可见回复中的链接');
  const absolutePath=await fs.realpath(requested);
  return {absolutePath,fileName:path.basename(requested),stat:await fs.stat(absolutePath)};
}

export class OutputDirectoryError extends Error {
  constructor(){super('链接指向目录');}
}

function outputFile(file:{absolutePath:string;fileName:string;stat:import('node:fs').Stats}){
  if(file.stat.isDirectory())throw new OutputDirectoryError();
  if(!file.stat.isFile())throw new Error('路径不是普通文件');
  if(file.stat.size>50*1024*1024)throw new Error('文件超过 50 MB，请在电脑上打开');
  return {absolutePath:file.absolutePath,fileName:file.fileName};
}

export async function resolveThreadOutputFile(text:string,href:string,cwd:string){
  return outputFile(await resolveReferencedOutput(text,href,cwd));
}

// A directory link grants read-only descendants for this reply, never a project grant.
async function resolveDirectoryEntry(text:string,href:string,cwd:string,relative:string){
  const root=await resolveReferencedOutput(text,href,cwd);
  if(!root.stat.isDirectory())throw new Error('链接不是目录');
  return directoryEntry(root.absolutePath,relative);
}

async function directoryEntry(root:string,relative:string){
  const portable=relative.replaceAll('\\','/');
  if(path.isAbsolute(portable)||/^[a-z][a-z\d+.-]*:/i.test(portable)||portable.split('/').includes('..'))throw new Error('路径超出链接目录');
  const absolutePath=await fs.realpath(path.resolve(root,portable));
  const within=path.relative(root,absolutePath);
  if(within==='..'||within.startsWith('..'+path.sep)||path.isAbsolute(within))throw new Error('路径超出链接目录');
  return {absolutePath,fileName:path.basename(absolutePath),stat:await fs.stat(absolutePath)};
}

export async function resolveThreadDirectoryFile(text:string,href:string,cwd:string,relative:string){
  return outputFile(await resolveDirectoryEntry(text,href,cwd,relative));
}

export async function listThreadOutputDirectory(text:string,href:string,cwd:string,relative:string){
  const root=await resolveReferencedOutput(text,href,cwd);
  if(!root.stat.isDirectory())throw new Error('链接不是目录');
  const directory=await directoryEntry(root.absolutePath,relative);
  if(!directory.stat.isDirectory())throw new Error('路径不是目录');
  const children=await fs.readdir(directory.absolutePath,{withFileTypes:true});
  const files=await Promise.all(children.map(async child=>{
    const childPath=path.posix.join(relative.replaceAll('\\','/'),child.name);
    // Resolve each child too: junctions and symlinks must stay inside the linked root.
    try{const file=await directoryEntry(root.absolutePath,childPath);
      if(!file.stat.isDirectory()&&!file.stat.isFile())return null;
      return {name:child.name,path:childPath,kind:file.stat.isDirectory()?'directory':'file',size:file.stat.size,modifiedAt:file.stat.mtime.toISOString()};
    }catch{return null;}
  }));
  return {files:files.filter(file=>file!==null).sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='directory'?-1:1)};
}

// Public fallback images retain the same project boundary as /raw/projects.
// A visible reply does not grant public access to files outside those roots.
export async function resolvePublicOutputImage(text:string,href:string,cwd:string,projectPaths:string[]){
  const requested=localOutputPath(href,cwd);
  if(!/\.(png|jpe?g|webp|gif)$/i.test(requested))throw new Error('公网会话输出只支持图片');
  const normalize=(file:string)=>process.platform==='win32'?file.toLowerCase():file;
  let referenced=false;
  marked.walkTokens(marked.lexer(text),token=>{
    if(token.type==='image')try{if(normalize(localOutputPath(token.href,cwd))===normalize(requested))referenced=true;}catch{}
  });
  if(!referenced)throw new Error('图片不是这条可见回复中的图片');
  const file=await resolveThreadOutputFile(text,href,cwd);
  let allowed=false;
  for(const root of projectPaths){
    const real=await fs.realpath(root).catch(()=>null);
    if(real&&normalize(file.absolutePath).startsWith(normalize(real.endsWith(path.sep)?real:real+path.sep))){allowed=true;break;}
  }
  if(!allowed)throw new Error('图片不在已授权项目中');
  if((await fs.stat(file.absolutePath)).size>20*1024*1024)throw new Error('图片超过 20 MB');
  const handle=await fs.open(file.absolutePath,'r');const header=Buffer.alloc(16);
  try{await handle.read(header,0,header.length,0);}finally{await handle.close();}
  const mime=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png'
    :header[0]===255&&header[1]===216&&header[2]===255?'image/jpeg'
    :['GIF87a','GIF89a'].includes(header.subarray(0,6).toString('ascii'))?'image/gif'
    :header.subarray(0,4).toString('ascii')==='RIFF'&&header.subarray(8,12).toString('ascii')==='WEBP'?'image/webp':null;
  if(!mime)throw new Error('文件不是支持的图片格式');
  return {...file,mime};
}

// The visible Markdown link grants only its referenced images inside that document's directory.
export async function resolveMarkdownOutputImage(text:string,source:string,href:string,cwd:string){
  if(!/\.(md|markdown)$/i.test(localOutputPath(source,cwd)))throw new Error('关联来源不是 Markdown 文件');
  const document=await resolveThreadOutputFile(text,source,cwd);
  if((await fs.stat(document.absolutePath)).size>5*1024*1024)throw new Error('Markdown 超过 5 MB');
  const markdown=await fs.readFile(document.absolutePath,'utf8');
  const directory=path.dirname(document.absolutePath);
  return resolvePublicOutputImage(markdown,href,directory,[directory]);
}
