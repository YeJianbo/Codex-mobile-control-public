const patchEntryHeader=/^\*\*\* (?:Update|Add|Delete) File: (.+)$/;
const patchPath=value=>value.replace(/^"(.*)"$/,'$1').replaceAll('\\','/').replace(/^\.\//,'');
function sectionMatches(section,file){
  const header=section.split(/\r?\n/,1)[0]||'',target=patchPath(file),entry=patchEntryHeader.exec(header);
  if(entry)return patchPath(entry[1])===target;
  const git=header.startsWith('diff --git ');
  if(!git&&!header.startsWith('--- '))return null;
  const hunk=section.indexOf('\n@@'),metadata=hunk<0?section:section.slice(0,hunk);let recorded=false;
  for(const line of metadata.split(/\r?\n/)){
    const path=line.startsWith('--- ')?patchPath(line.slice(4).split('\t',1)[0]).replace(/^a\//,''):
      line.startsWith('+++ ')?patchPath(line.slice(4).split('\t',1)[0]).replace(/^b\//,''):
      line.startsWith('rename from ')?patchPath(line.slice(12)):line.startsWith('rename to ')?patchPath(line.slice(10)):null;
    if(path!==null){recorded=true;if(path!=='/dev/null'&&path===target)return true;}
  }
  if(recorded||!git)return false;
  return header===`diff --git a/${target} b/${target}`||header===`diff --git "a/${target}" "b/${target}"`;
}
export function filePatch(detail,file){
  const sections=detail.split(/(?=^diff --git |^\*\*\* (?:Update|Add|Delete) File:)/m);
  let identified=false;
  const selected=sections.filter(section=>{const matches=sectionMatches(section,file);if(matches!==null)identified=true;return matches===true;});
  return identified?selected.join('\n'):detail;
}
export function patchLines(detail){
  let old=null,next=null,body=false;
  return detail.split('\n').map(text=>{
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if(hunk){old=Number(hunk[1]);next=Number(hunk[2]);body=true;return {text,kind:'meta'};}
    if(text.startsWith('*** Add File:')){old=null;next=1;body=true;return {text,kind:'meta'};}
    if(text.startsWith('@@')){old=next=null;body=true;return {text,kind:'meta'};}
    if(/^(\*\*\* |diff --git|--- |\+\+\+ )/.test(text)){body=false;old=next=null;return {text,kind:'meta'};}
    const kind=body?({'+':'add','-':'del',' ':'context'}[text[0]]||'meta'):'meta';
    const row={text,kind,oldLine:kind==='del'||kind==='context'?old:null,newLine:kind==='add'||kind==='context'?next:null};
    if((kind==='del'||kind==='context')&&old!==null)old++;
    if((kind==='add'||kind==='context')&&next!==null)next++;
    return row;
  });
}
