import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {readAgySessionTokens} from '../src/services/agySessionTokens.ts';
import {readAgyThreadTokens} from '../src/services/agySessionTokens.ts';

test('AGY session tokens use Web generation rows and deduplicate matching messages',()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'agy-session-tokens-'));
  const previous=process.env.USERPROFILE;
  const previousAppHome=process.env.CODEX_MOBILE_CONTROL_HOME;
  process.env.USERPROFILE=home;
  process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const directory=path.join(home,'analytics');
  mkdirSync(directory);
  const session='session-1';
  const conversation=path.join(home,'.gemini','antigravity-cli','conversations',session+'.db');
  const db=new DatabaseSync(path.join(directory,'agy-usage.sqlite'));
  try{
    db.exec('CREATE TABLE usage(file TEXT,idx INTEGER,time REAL,data TEXT,PRIMARY KEY(file,idx))');
    const insert=db.prepare('INSERT INTO usage VALUES(?,?,?,?)');
    insert.run(conversation,1,1,JSON.stringify({model:'gemini-3.8-flash',messageId:'m1',input:100,cached:40,output:20,reasoning:5}));
    insert.run(conversation,2,2,JSON.stringify({model:'gemini-3.8-flash',messageId:'m1',input:100,cached:40,output:20,reasoning:5}));
    insert.run(conversation,3,3,JSON.stringify({model:'gemini-3.8-flash',messageId:'m2',input:30,cached:10,output:7,reasoning:2}));
    db.close();
    assert.deepEqual(readAgySessionTokens(session,directory),{
      input:180,cached:50,output:27,reasoning:7,total:207,last:47,contextWindow:1048576,context:47
    });
    const state=new DatabaseSync(path.join(home,'state.sqlite'));
    state.exec('CREATE TABLE agent_sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
    state.prepare('INSERT INTO agent_sessions VALUES(?,?)').run('antigravity-12345678-1234-1234-1234-123456789abc',JSON.stringify({session}));
    state.close();
    assert.deepEqual(readAgyThreadTokens('antigravity-12345678-1234-1234-1234-123456789abc',directory),readAgySessionTokens(session,directory));
    assert.equal(readAgySessionTokens('../other',directory),null);
  }finally{
    try{db.close();}catch{}
    if(previous===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=previous;
    if(previousAppHome===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previousAppHome;
    rmSync(home,{recursive:true,force:true});
  }
});

test('AGY native generations stay current without the Web index and separate context from cumulative usage',()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'agy-native-tokens-')),previous=process.env.USERPROFILE;
  process.env.USERPROFILE=home;
  const directory=path.join(home,'.gemini','antigravity-cli','conversations');mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'session-2.db'));
  const integer=value=>{const bytes=[];do{const digit=value%128;value=Math.floor(value/128);bytes.push(digit+(value?128:0));}while(value);return Buffer.from(bytes);};
  const number=(id,value)=>Buffer.concat([integer(id*8),integer(value)]);
  const bytes=(id,value)=>{const data=typeof value==='string'?Buffer.from(value):value;return Buffer.concat([integer(id*8+2),integer(data.length),data]);};
  const generation=(id,input,cached,output)=>bytes(1,Buffer.concat([bytes(19,'gemini-3.8-flash'),bytes(4,Buffer.concat([number(2,input),number(3,output),number(5,cached),number(9,2),bytes(7,id)]))]));
  try{
    db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB)');
    const insert=db.prepare('INSERT INTO gen_metadata VALUES(?,?)');
    insert.run(0,generation('first',100,900,20));
    assert.equal(readAgySessionTokens('session-2',home).context,1020);
    insert.run(1,generation('second',30,1200,7));
    const tokens=readAgySessionTokens('session-2',home);
    assert.deepEqual(tokens,{input:2230,cached:2100,output:27,reasoning:4,total:2257,last:1237,context:1237,contextWindow:1048576});
    assert.equal(readAgySessionTokens('session-2',home).total,2257,'repeated reads never accumulate again');
  }finally{
    db.close();if(previous===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=previous;
    rmSync(home,{recursive:true,force:true});
  }
});
