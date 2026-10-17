export function editedFilePaths(name:string,input:any):string[]{
  const field:Record<string,string>={Write:'file_path',Edit:'file_path',MultiEdit:'file_path',NotebookEdit:'notebook_path',write:'file_path',search_replace:'file_path',write_to_file:'TargetFile',replace_file_content:'TargetFile',multi_replace_file_content:'TargetFile',sed_file:'TargetFile'};
  const value=field[name]?input?.[field[name]]:undefined;
  return typeof value==='string'&&value.trim()?[value]:[];
}

function lines(value:string){if(!value)return [];const result=value.split(/\r?\n/);if(result.at(-1)==='')result.pop();return result;}
export function textChangeDiff(file:string,before:string,after:string,oldStart=1,newStart=1):string{
  const oldLines=lines(before),newLines=lines(after);
  return [`--- a/${file}`,`+++ b/${file}`,`@@ -${oldLines.length?oldStart:0},${oldLines.length} +${newLines.length?newStart:0},${newLines.length} @@`,...oldLines.map(line=>'-'+line),...newLines.map(line=>'+'+line)].join('\n');
}

export function claudeFileChange(result:any):{files:string[];diff?:string}|undefined{
  if(!result||typeof result.filePath!=='string'||(!['create','update'].includes(result.type)&&!Array.isArray(result.structuredPatch)))return;
  const file=result.filePath;
  if(result.type==='create'&&typeof result.content==='string')return {files:[file],diff:textChangeDiff(file,'',result.content)};
  if(Array.isArray(result.structuredPatch)&&result.structuredPatch.length){
    const hunks=result.structuredPatch.filter((h:any)=>Array.isArray(h.lines)&&[h.oldStart,h.oldLines,h.newStart,h.newLines].every(Number.isFinite));
    if(hunks.length)return {files:[file],diff:[`--- a/${file}`,`+++ b/${file}`,...hunks.flatMap((h:any)=>[`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,...h.lines])].join('\n')};
  }
  return {files:[file]};
}

export function acpFileChanges(content:any[]):{files:string[];diff?:string}|undefined{
  const changes=content.filter(c=>c.type==='diff'&&typeof c.path==='string');
  if(!changes.length)return;
  const diffs=changes.flatMap(c=>typeof c.oldText==='string'&&typeof c.newText==='string'?[textChangeDiff(c.path,c.oldText,c.newText,c._meta?.old_line??c._meta?.details?.[0]?.old_line??1,c._meta?.new_line??c._meta?.details?.[0]?.new_line??1)]:[]);
  return {files:[...new Set(changes.map(c=>c.path))],diff:diffs.join('\n')||undefined};
}
