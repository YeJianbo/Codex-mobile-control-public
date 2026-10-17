import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {desktopThreadSettings} from '../src/services/desktopSidebar.ts';

test('desktop model settings follow current database values and tolerate unknown threads',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-model-'));
  const previous=process.env.CODEX_HOME;
  let db;
  try{
    process.env.CODEX_HOME=home;
    db=new DatabaseSync(path.join(home,'state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT,model TEXT,reasoning_effort TEXT)');
    db.prepare('INSERT INTO threads VALUES(?,?,?)').run('test','gpt-6-astra','high');
    assert.deepEqual(desktopThreadSettings('test'),{model:'gpt-6-astra',effort:'high'});
    db.prepare('UPDATE threads SET model=?,reasoning_effort=?').run('gpt-6-sol','medium');
    assert.deepEqual(desktopThreadSettings('test'),{model:'gpt-6-sol',effort:'medium'});
    assert.equal(desktopThreadSettings('unknown'),null);
  }finally{
    db?.close();
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});
