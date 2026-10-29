import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

/** Indexed metadata only; prompts, response bodies and credentials never enter this journal. */
export class RequestJournal{
  constructor(directory,legacyFile){
    fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'request-records.sqlite');
    this.db=new DatabaseSync(this.file);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,at INTEGER NOT NULL,model TEXT,provider TEXT,session TEXT,input INTEGER,output INTEGER,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_at ON requests(at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS requests_match ON requests(model,input,output,at);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);`);
    this.put=this.db.prepare('INSERT OR IGNORE INTO requests VALUES(?,?,?,?,?,?,?,?)');
    if(!this.db.prepare("SELECT value FROM metadata WHERE key='legacy-import'").get()){
      this.db.exec('BEGIN');
      try{
        let index=0;
        for(const file of [legacyFile+'.previous',legacyFile]){
          if(!fs.existsSync(file))continue;
          for(const line of fs.readFileSync(file,'utf8').split('\n')){
            let row;try{row=JSON.parse(line);}catch{continue;}
            if(Number.isFinite(row.timestamp))this.record({...row,id:row.id||'legacy:'+index++});
          }
        }
        this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy-import','1');this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}
    }
  }
  record(row){
    const id=row.id||randomUUID(),at=row.timestampMs??row.timestamp*1000;
    const value={...row,id,purpose:row.purpose||(row.test?'test':'normal'),timestamp:Math.floor(at/1000),timestampMs:at};
    this.put.run(id,at,row.model||null,row.provider||null,row.sessionId||null,row.inputTokens??null,row.outputTokens??null,JSON.stringify(value));
    return value;
  }
  rows(since,until){return this.db.prepare('SELECT data FROM requests WHERE at>=? AND at<=? ORDER BY at,id').all(since,until).map(row=>JSON.parse(row.data));}
  close(){this.db.close();}
}
