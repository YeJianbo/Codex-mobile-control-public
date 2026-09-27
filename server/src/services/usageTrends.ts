import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {appHome} from './paths.js';

type WindowSample={name:string;durationMins:number|null;remainingPercent:number|null};
type TrendRow={at:number;name:string;durationMins:number;remainingPercent:number};

export class UsageTrends {
  private db:DatabaseSync;
  constructor(){
    mkdirSync(appHome(),{recursive:true});
    this.db=new DatabaseSync(path.join(appHome(),'usage-trends.sqlite'));
    this.db.exec(`CREATE TABLE IF NOT EXISTS quota_samples (
      bucket INTEGER NOT NULL,
      name TEXT NOT NULL,
      duration_mins INTEGER NOT NULL,
      remaining_percent REAL NOT NULL,
      PRIMARY KEY(bucket,name,duration_mins)
    ); CREATE INDEX IF NOT EXISTS quota_samples_bucket ON quota_samples(bucket);`);
  }
  record(windows:WindowSample[],now=Date.now()):void{
    const bucket=Math.floor(now/300000)*300000;
    const insert=this.db.prepare('INSERT OR REPLACE INTO quota_samples(bucket,name,duration_mins,remaining_percent) VALUES (?,?,?,?)');
    for(const window of windows){
      if(window.remainingPercent===null||!Number.isFinite(window.remainingPercent))continue;
      insert.run(bucket,window.name,window.durationMins??0,window.remainingPercent);
    }
    this.db.prepare('DELETE FROM quota_samples WHERE bucket < ?').run(now-90*86400000);
  }
  read(days:number,now=Date.now()):TrendRow[]{
    return (this.db.prepare('SELECT bucket AS at,name,duration_mins AS durationMins,remaining_percent AS remainingPercent FROM quota_samples WHERE bucket >= ? ORDER BY bucket ASC').all(now-days*86400000) as TrendRow[]);
  }
  close():void{this.db.close();}
}
