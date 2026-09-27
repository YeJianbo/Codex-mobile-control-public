import {DatabaseSync} from 'node:sqlite';import os from 'node:os';const db=new DatabaseSync(os.homedir()+'/.codex/state_5.sqlite',{readOnly:true});
for(const name of ['projects','project_roots'])console.log(name,db.prepare('PRAGMA table_info('+name+')').all().map(x=>x.name));
console.log(db.prepare('SELECT id,title,recency_at_ms,updated_at_ms,is_pinned,section_position,project_id FROM threads WHERE archived=0 ORDER BY recency_at_ms DESC LIMIT 5').all());db.close();
