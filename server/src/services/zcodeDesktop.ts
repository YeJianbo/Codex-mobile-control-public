import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {zcodeHome} from './zcodeAccount.js';

type DesktopSession={title?:string;model?:string;mode?:string;status:'running'|'completed'|'error'|'interrupted'};

/** Register the original CLI session in the desktop catalog, never copy its messages. */
export function syncZcodeDesktopSession(sessionId:string,state:DesktopSession):boolean{
  const home=zcodeHome(),storage=process.env.ZCODE_STORAGE_DIR||path.join(home,'cli');
  // The desktop cannot read an isolated CLI store through its local catalog.
  if(path.resolve(storage)!==path.resolve(home,'cli'))return false;
  const nativeFile=path.join(storage,'db','db.sqlite'),indexFile=path.join(home,'v2','tasks-index.sqlite');
  if(!fs.existsSync(nativeFile)||!fs.existsSync(indexFile))return false;
  const native=new DatabaseSync(nativeFile,{readOnly:true});
  let session:any;
  try{
    native.exec('PRAGMA busy_timeout=250');
    session=native.prepare('SELECT id,directory,workspace_id,title,title_source,time_created,time_updated,time_deleted FROM session WHERE id=?').get(sessionId);
  }finally{native.close();}
  if(!session||session.time_deleted!=null||session.workspace_id&&session.workspace_id!==session.directory)return false;
  const db=new DatabaseSync(indexFile);
  try{
    db.exec('PRAGMA busy_timeout=250; BEGIN IMMEDIATE');
    // Use the desktop's existing local host. Do not initialize or migrate its schema.
    if(!db.prepare("SELECT 1 FROM hosts WHERE host_id='local' AND kind='local'").get())return false;
    const current=db.prepare('SELECT * FROM tasks WHERE task_id=?').all(sessionId) as any[];
    if(current.some(row=>row.workspace_key!==session.directory))return false;
    const old=current[0];
    if(old?.deleted)return false;
    let projectId=old?.project_id;
    if(!old){
      projectId=(db.prepare("SELECT p.project_id FROM projects p JOIN project_roots r USING(project_id) WHERE p.host_id='local' AND p.deleted=0 AND r.root_path=? ORDER BY p.position LIMIT 1").get(session.directory) as any)?.project_id;
      if(!projectId){
        projectId=randomUUID();
        const base=path.basename(session.directory)||session.directory;let name=base;
        for(let i=2;db.prepare("SELECT 1 FROM projects WHERE host_id='local' AND deleted=0 AND name=?").get(name);i++)name=`${base} (${i})`;
        db.prepare("INSERT INTO projects(project_id,host_id,name,position,created_at,updated_at) VALUES(?,'local',?,(SELECT coalesce(min(position),1)-1 FROM projects WHERE host_id='local'),?,?)").run(projectId,name,session.time_created,session.time_updated);
        db.prepare('INSERT INTO project_roots(project_id,root_path,position,is_primary) VALUES(?,?,0,1)').run(projectId,session.directory);
      }
    }
    const title=session.title_source==='default'?(state.title?.trim().split(/\r?\n/)[0].slice(0,160)||session.title):session.title;
    const updatedAt=Math.max(session.time_updated,Date.now());
    const meta={...(old?JSON.parse(old.meta_json):{}),taskId:sessionId,workspacePath:session.directory,
      title:old?.title_overridden?old.title:title,createdAt:session.time_created,updatedAt,
      mode:state.mode||old?.mode||'build',model:state.model||old?.model,provider:'glm',status:state.status};
    if(old){
      db.prepare(`UPDATE tasks SET title=?,task_status=?,mode=?,model=?,updated_at=?,meta_json=?,
        cli_title=?,cli_title_source=?,cli_created_at=?,cli_updated_at=? WHERE workspace_key=? AND task_id=?`)
        .run(meta.title,meta.status,meta.mode,meta.model??null,updatedAt,JSON.stringify(meta),session.title,session.title_source,session.time_created,session.time_updated,session.directory,sessionId);
    }else{
      db.prepare(`INSERT INTO tasks(workspace_key,workspace_path,task_id,title,task_status,provider,mode,model,
        created_at,updated_at,meta_json,host_id,root_path,project_id,cli_title,cli_title_source,cli_created_at,cli_updated_at)
        VALUES(?,?,?,?,?,'glm',?,?,?,?,?,'local',?,?,?,?,?,?)`)
        .run(session.directory,session.directory,sessionId,meta.title,meta.status,meta.mode,meta.model??null,
          session.time_created,updatedAt,JSON.stringify(meta),session.directory,projectId,session.title,session.title_source,session.time_created,session.time_updated);
    }
    db.exec('COMMIT');return true;
  }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
}
