import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Analytics} from '../../components/local-console/src/analytics.mjs';
import {analyticsDb} from '../../components/local-console/src/analytics-db.mjs';
import {ExternalUsage} from '../../components/local-console/src/external-usage.mjs';
import {ExternalUsageIndexer} from '../../components/local-console/src/external-usage-worker.mjs';

test('activity-only query keeps distinct minutes, sessions and empty days from the full summary',()=>{
  const db=analyticsDb(':memory:');
  try{
    const put=db.prepare('INSERT INTO events(key,kind,time,session,input,output,category) VALUES(?,?,?,?,?,?,?)');
    const minute=Date.parse('2026-10-25T09:30:00');
    put.run('a','activity',minute,'one',0,0,null);
    put.run('b','activity',minute,'two',0,0,null);
    put.run('c','activity',minute+60000,'one',0,0,null);
    put.run('d','activity',Date.parse('2026-10-27T09:30:00'),'one',0,0,null);
    put.run('e','token',minute,'one',100,20,null);
    put.run('f','tool',minute,'one',0,0,'write');
    const analytics=Object.create(Analytics.prototype);
    Object.assign(analytics,{db,summaryCache:new Map(),progress:{running:false}});
    const bounds={from:'2026-10-25',to:'2026-10-27'};
    const full=analytics.summary('custom',{view:'sessions'},bounds);
    const activity=analytics.summary('custom',{view:'activity'},bounds);
    const project=result=>({totals:Object.fromEntries(['activeMinutes','activeDays','activeSessions'].map(key=>[key,result.totals[key]])),series:result.series.map(({date,activeMinutes,activeSessions})=>({date,activeMinutes,activeSessions}))});
    assert.deepEqual(project(activity),project(full));
    assert.deepEqual(activity.totals,{activeMinutes:3,activeDays:2,activeSessions:2});
    assert.equal(activity.series[1].activeMinutes,0);
    assert.equal(full.totals.toolCalls,1);
    assert.equal(full.totals.totalTokens,120);
  }finally{db.close();}
});

test('shared external worker routes concurrent summaries, refresh and per-request errors',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'statistics-loading-'));
  const names=['USERPROFILE','HOME','LOCALAPPDATA','APPDATA','DSH_HOME','HERMES_HOME','XDG_DATA_HOME'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const usage=new ExternalUsage(dir,{dir:path.join(dir,'analytics'),environment:{}});
  const now=Date.now();
  usage.retain('zcode',[{usageId:'saved',time:now,model:'example',sessionId:'session',input:100,output:20,requests:1}]);
  const indexer=new ExternalUsageIndexer(path.join(dir,'analytics'));
  try{
    for(const name of names)process.env[name]=dir;
    const first=indexer.summary('zcode','year');
    for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
    const refresh=indexer.start();
    assert.equal(indexer.start(),refresh);
    const [year,week]=await Promise.all([first,indexer.summary('zcode','week')]);
    assert.equal(year.totals.input,100);assert.equal(year.totals.output,20);
    assert.equal(week.totals.input,100);
    await assert.rejects(indexer.summary('invalid','year'),/统计来源无效/);
    assert.equal((await indexer.summary('zcode','year')).totals.output,20);
    assert.equal((await refresh).sources.zcode,true);
    assert.equal(indexer.progress.running,false);
  }finally{
    for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
    indexer.close();
    if(indexer.worker)await new Promise(resolve=>indexer.worker.once('exit',resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
