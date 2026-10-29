const citation=/^:codex-file-citation\{((?:[^"{}]|"(?:\\.|[^"\\])*")*)\}/;
const attribute=/([a-zA-Z_][\w-]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;

/** Parse only local file references; the existing file resolver owns authorization. */
export function parseFileCitation(source:string){
  const match=citation.exec(source);
  if(!match)return null;
  const attrs=Object.fromEntries([...match[1]!.matchAll(attribute)].map(value=>[
    value[1],value[2]!.replace(/\\(["\\])/g,'$1'),
  ]));
  const path=attrs.path?.replace(/\\/g,'/');
  if(!path||/[\x00-\x1f]/.test(path)||path.startsWith('//')||
    (/^[a-z][a-z\d+.-]*:/i.test(path)&&!/^([a-z]:\/|file:\/\/\/)/i.test(path)))return null;
  const name=path.split('/').pop();
  if(!name)return null;
  const href=encodeURIComponent(path).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  return {raw:match[0],href,label:name};
}

// An inline tokenizer lets Markdown handle code, escaping and nested blocks.
export const fileCitationExtension={
  name:'codexFileCitation',
  level:'inline' as const,
  start(source:string){return source.indexOf(':codex-file-citation{');},
  tokenizer(source:string){
    const file=parseFileCitation(source);
    if(!file)return undefined;
    return {type:'link',raw:file.raw,href:file.href,text:file.label,
      tokens:[{type:'text',raw:file.label,text:file.label}]};
  },
};
