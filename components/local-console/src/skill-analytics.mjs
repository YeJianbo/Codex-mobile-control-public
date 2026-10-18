// A read request is evidence of loading an entry point, not successful execution of a workflow.
export function skillReadRequests(payload){
  const name=String(payload.name||'');let args=payload.arguments??payload.input;
  if(typeof args==='string'){try{args=JSON.parse(args);}catch{}}
  let text='';
  if(/read_file|open_file/.test(name))text=typeof args==='object'?args?.path||args?.file_path||'':'';
  else if(/exec|shell|terminal|run_command/.test(name)){
    let source=typeof args==='string'?args:args?.cmd||args?.command||args?.code||'';
    if(/(?:^|\.)exec$/.test(name)){
      source=[...String(source).matchAll(/tools\.exec_command\(\{\s*cmd\s*:\s*("(?:\\.|[^"\\])*")/g)].map(m=>{try{return JSON.parse(m[1]);}catch{return '';}}).join('\n');
    }
    // Recognize explicit readers only; a search, catalog listing or prose mention does not count.
    if(!/@['"]|<</.test(source))text=String(source).split(/[;\n]/).filter(s=>/^\s*(?:Get-Content|cat)\s/i.test(s)).join('\n');
  }
  text=String(text).replace(/\\+/g,'/');
  return [...new Set([...text.matchAll(/(?:^|\/)([\w.-]+)\/SKILL\.md\b/gi)].map(m=>m[1]))].slice(0,50);
}
export function skillAnalytics(db,since,until){
  const totals=db.prepare("SELECT COUNT(*) reads,COUNT(DISTINCT tool) skills,COUNT(DISTINCT session) sessions FROM events WHERE kind='skill' AND time>=? AND time<=?").get(since,until);
  const ranking=db.prepare("SELECT tool name,COUNT(*) reads,COUNT(DISTINCT session) sessions,MAX(time) lastRead FROM events WHERE kind='skill' AND time>=? AND time<=? GROUP BY tool ORDER BY reads DESC,tool LIMIT 50").all(since,until);
  const recent=db.prepare("SELECT tool name,time,session FROM events WHERE kind='skill' AND time>=? AND time<=? ORDER BY time DESC LIMIT 100").all(since,until);
  const coverage=db.prepare("SELECT COUNT(*) files,SUM(CASE WHEN json_extract(state,'$.skillVersion')=1 AND json_extract(state,'$.complete')=1 THEN 1 ELSE 0 END) completed FROM files").get();
  return {totals,ranking,recent,coverage,definition:'可识别的 SKILL.md 读取请求；不代表执行成功，未重复读取的后续使用无法识别'};
}
