import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync,type StatementSync} from 'node:sqlite';
import {appHome} from './paths.js';

type WindowSample={name:string;durationMins:number|null;remainingPercent:number|null};
type TrendRow={at:number;name:string;durationMins:number;remainingPercent:number};

export class UsageTrends {
  private db:DatabaseSync;
  private insert:StatementSync;
  private prune:StatementSync;
  private select:StatementSync;
  constructor(){
    mkdirSync(appHome(),{recursive:true});
    this.db=new DatabaseSync(path.join(appHome(),'usage-trends.sqlite'));
    const table=`CREATE TABLE IF NOT EXISTS quota_samples (
      account_key TEXT NOT NULL DEFAULT '',
      bucket INTEGER NOT NULL,
      name TEXT NOT NULL,
      duration_mins INTEGER NOT NULL,
      remaining_percent REAL NOT NULL,
      PRIMARY KEY(account_key,bucket,name,duration_mins)
    );`;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const columns=this.db.prepare('PRAGMA table_info(quota_samples)').all();
      if(columns.length&&!columns.some(column=>column.name==='account_key')){
        this.db.exec('ALTER TABLE quota_samples RENAME TO quota_samples_legacy');
        this.db.exec(table);
        // Old samples have no reliable account owner; preserve them without assigning one.
        this.db.exec(`INSERT INTO quota_samples(account_key,bucket,name,duration_mins,remaining_percent)
          SELECT '',bucket,name,duration_mins,remaining_percent FROM quota_samples_legacy;
          DROP TABLE quota_samples_legacy;`);
      }else this.db.exec(table);
      this.db.exec('CREATE INDEX IF NOT EXISTS quota_samples_bucket ON quota_samples(bucket); COMMIT');
    }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}
    this.insert=this.db.prepare('INSERT OR REPLACE INTO quota_samples(account_key,bucket,name,duration_mins,remaining_percent) VALUES (?,?,?,?,?)');
    this.prune=this.db.prepare('DELETE FROM quota_samples WHERE bucket < ?');
    this.select=this.db.prepare('SELECT bucket AS at,name,duration_mins AS durationMins,remaining_percent AS remainingPercent FROM quota_samples WHERE account_key = ? AND bucket >= ? ORDER BY bucket ASC');
  }
  record(windows:WindowSample[],now=Date.now(),accountKey=''):void{
    const bucket=Math.floor(now/300000)*300000;
    for(const window of windows){
      if(window.remainingPercent===null||!Number.isFinite(window.remainingPercent))continue;
      this.insert.run(accountKey,bucket,window.name,window.durationMins??0,window.remainingPercent);
    }
    this.prune.run(now-90*86400000);
  }
  read(days:number,now=Date.now(),accountKey=''):TrendRow[]{
    return this.select.all(accountKey,now-days*86400000) as TrendRow[];
  }
  close():void{this.db.close();}
}
