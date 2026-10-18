import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync, type StatementSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import type {CommandReceipt} from './commandReceipts.js';

// Every request keeps its identity on disk; only the working set belongs in memory.
export class ReceiptStore {
  private db?: DatabaseSync;
  private select?: StatementSync;
  private upsert?: StatementSync;
  readonly databasePath: string;

  constructor(private readonly legacyFile: string) {
    this.databasePath = legacyFile.replace(/\.json$/i, '') + '.sqlite';
  }

  async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), {recursive:true});
    const file=await fs.open(this.databasePath,'a',0o600);
    await file.close();
    const db = new DatabaseSync(this.databasePath);
    this.db = db;
    try {
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS receipts (request_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS receipts_updated ON receipts(updated_at DESC);
        CREATE TABLE IF NOT EXISTS receipt_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      this.select = db.prepare('SELECT payload FROM receipts WHERE request_id=?');
      this.upsert = db.prepare('INSERT INTO receipts(request_id,updated_at,state,payload) VALUES (?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET updated_at=excluded.updated_at,state=excluded.state,payload=excluded.payload');
      let raw: string | undefined;
      try { raw = await fs.readFile(this.legacyFile,'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // A rolled-back gateway may have written newer JSON receipts. Detect that
      // exact input change without reimporting the full legacy table on every start.
      const digest = raw === undefined ? 'missing' : createHash('sha256').update(raw).digest('hex');
      const imported = db.prepare("SELECT value FROM receipt_meta WHERE key='legacy-source'").get()?.value === digest;
      const legacy: CommandReceipt[] = imported || raw === undefined ? [] : JSON.parse(raw);
      if (!Array.isArray(legacy)) throw new Error('提交记录格式无效，原文件已保留');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!imported) {
          for (const row of legacy) {
            const previous = this.get(row.requestId);
            if (previous && previous.fingerprint !== row.fingerprint) throw new Error('旧提交记录的请求 ID 与当前记录冲突，原文件已保留');
            if (!previous || row.updatedAt > previous.updatedAt) this.put(row);
          }
          db.prepare("INSERT INTO receipt_meta(key,value) VALUES ('legacy-source',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(digest);
        }
        for (const item of db.prepare("SELECT payload FROM receipts WHERE state='starting'").all()) {
          const row = JSON.parse(item.payload as string) as CommandReceipt;
          this.put({...row,state:'uncertain',failureKind:'uncertain',error:'连接中断，提交结果尚未确认。请查看会话后再决定是否重试，系统不会重复启动。'});
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.close(); throw error; }
  }

  get(id: string): CommandReceipt | undefined {
    const item = this.select!.get(id);
    return item ? JSON.parse(item.payload as string) as CommandReceipt : undefined;
  }

  put(row: CommandReceipt): void {
    this.upsert!.run(row.requestId,row.updatedAt,row.state,JSON.stringify(row));
  }

  list(): CommandReceipt[] {
    return this.db!.prepare('SELECT payload FROM receipts ORDER BY updated_at DESC LIMIT 200').all()
      .map(row => JSON.parse(row.payload as string) as CommandReceipt);
  }

  // Explicit export supports a code rollback without losing newer request identities.
  async exportJson(file: string): Promise<void> {
    const rows = this.db!.prepare('SELECT payload FROM receipts ORDER BY updated_at').all().map(row=>JSON.parse(row.payload as string));
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(rows), {mode:0o600});
    await fs.rename(temporary,file);
  }

  close(): void {
    this.select = undefined; this.upsert = undefined;
    this.db?.close(); this.db = undefined;
  }
}
