import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {appHome} from '../services/paths.js';
import type {ChannelAccount,ChannelBinding} from './types.js';

export class ChannelStore {
  private database?:DatabaseSync;
  constructor(private readonly file=path.join(appHome(),'channels.sqlite')){}
  private db(){
    if(!this.database){
      mkdirSync(path.dirname(this.file),{recursive:true});
      const db=new DatabaseSync(this.file);
      db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS channel_accounts(id TEXT PRIMARY KEY,channel TEXT NOT NULL,label TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS channel_bindings(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,chatId TEXT NOT NULL,senderId TEXT NOT NULL,threadId TEXT NOT NULL,UNIQUE(accountId,chatId,senderId));
        CREATE TABLE IF NOT EXISTS channel_requests(accountId TEXT NOT NULL,messageId TEXT NOT NULL,chatId TEXT NOT NULL,senderId TEXT NOT NULL,threadId TEXT NOT NULL,requestId TEXT NOT NULL UNIQUE,PRIMARY KEY(accountId,chatId,senderId,messageId));
        CREATE TABLE IF NOT EXISTS channel_private(accountId TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(accountId,key));`);
      this.database=db;
    }
    return this.database;
  }
  accounts(){return this.db().prepare('SELECT * FROM channel_accounts ORDER BY rowid').all() as ChannelAccount[];}
  account(id:string){return this.db().prepare('SELECT * FROM channel_accounts WHERE id=?').get(id) as ChannelAccount|undefined;}
  addAccount(channel:ChannelAccount['channel'],label:string){const row={id:randomUUID(),channel,label};this.db().prepare('INSERT INTO channel_accounts VALUES(?,?,?)').run(row.id,channel,label);return row;}
  bindings(){return this.db().prepare('SELECT * FROM channel_bindings ORDER BY rowid').all() as ChannelBinding[];}
  bind(input:Omit<ChannelBinding,'id'>){
    const existing=this.db().prepare('SELECT id FROM channel_bindings WHERE accountId=? AND chatId=? AND senderId=?').get(input.accountId,input.chatId,input.senderId) as {id:string}|undefined;
    const row={...input,id:existing?.id??randomUUID()};
    this.db().prepare('INSERT INTO channel_bindings VALUES(?,?,?,?,?) ON CONFLICT(accountId,chatId,senderId) DO UPDATE SET threadId=excluded.threadId').run(row.id,row.accountId,row.chatId,row.senderId,row.threadId);return row;
  }
  unbind(id:string){this.db().prepare('DELETE FROM channel_bindings WHERE id=?').run(id);}
  removeAccount(id:string){this.db().prepare('DELETE FROM channel_accounts WHERE id=?').run(id);}
  resetIdentity(id:string){const db=this.db();db.exec('BEGIN');try{for(const table of ['channel_bindings','channel_requests'])db.prepare(`DELETE FROM ${table} WHERE accountId=?`).run(id);db.prepare("DELETE FROM channel_private WHERE accountId=? AND key<>'projectPath'").run(id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  privateValue<T>(accountId:string,key:string):T|undefined{const row=this.db().prepare('SELECT value FROM channel_private WHERE accountId=? AND key=?').get(accountId,key) as {value:string}|undefined;return row?JSON.parse(row.value) as T:undefined;}
  putPrivate(accountId:string,key:string,value:unknown){this.db().prepare('INSERT INTO channel_private VALUES(?,?,?) ON CONFLICT(accountId,key) DO UPDATE SET value=excluded.value').run(accountId,key,JSON.stringify(value));}
  assignRequest(accountId:string,requestId:string,threadId:string){return Number(this.db().prepare("UPDATE channel_requests SET threadId=? WHERE accountId=? AND requestId=? AND threadId=''").run(threadId,accountId,requestId).changes)>0;}
  acceptThread(requestId:string,threadId:string){const row=this.db().prepare("SELECT accountId,chatId,senderId FROM channel_requests WHERE requestId=? AND threadId=''").get(requestId) as {accountId:string;chatId:string;senderId:string}|undefined;if(row&&this.account(row.accountId)&&this.assignRequest(row.accountId,requestId,threadId))this.bind({...row,threadId});}
  request(binding:ChannelBinding,messageId:string){
    const db=this.db();
    // Persist the ID and original thread before submitting; replays never target a newly bound thread.
    db.prepare('INSERT OR IGNORE INTO channel_requests VALUES(?,?,?,?,?,?)').run(binding.accountId,messageId,binding.chatId,binding.senderId,binding.threadId,randomUUID());
    return db.prepare('SELECT requestId,threadId FROM channel_requests WHERE accountId=? AND chatId=? AND senderId=? AND messageId=?').get(binding.accountId,binding.chatId,binding.senderId,messageId) as {requestId:string;threadId:string};
  }
  close(){this.database?.close();this.database=undefined;}
}
