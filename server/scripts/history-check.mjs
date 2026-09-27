import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readCodexThreadEvents} from '../src/services/codexSessions.ts';
const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-history-'));
const previous=process.env.CODEX_HOME;process.env.CODEX_HOME=home;
try{
 await fs.mkdir(path.join(home,'sessions'));
 const file=path.join(home,'sessions','history-fixture.jsonl');
 const row=(type,payload)=>JSON.stringify({type,payload})+'\n';
 await fs.writeFile(file,row('event_msg',{type:'task_started',turn_id:'turn1'})+row('event_msg',{type:'user_message',message:'用户请求'})+row('event_msg',{type:'agent_message',message:'正文保留'}));
 let events=await readCodexThreadEvents('history-fixture');assert.ok(events.some(e=>e.text==='正文保留'));assert.ok(events.some(e=>e.type==='turn.started'));
 await fs.appendFile(file,Array.from({length:260},(_,i)=>row('response_item',{type:'function_call',call_id:'tool'+i,name:'test',arguments:'{}'})).join(''));
 events=await readCodexThreadEvents('history-fixture');assert.equal(events[0].type,'turn.started');assert.equal(events.at(-1).itemId,'tool259');
 const stable=events.at(-1).eventId;assert.equal((await readCodexThreadEvents('history-fixture')).at(-1).eventId,stable);
 const attachment=row('response_item',{type:'message',role:'user',content:[{text:'# Files mentioned by the user:\n\n## Photo.jpg: F:/example/Photo.jpg\n\n## My request for Codex:\n看这张图'}]});
 await fs.appendFile(file,attachment.slice(0,40));assert.equal((await readCodexThreadEvents('history-fixture')).at(-1).eventId,stable);
 await fs.appendFile(file,attachment.slice(40));events=await readCodexThreadEvents('history-fixture');assert.equal(events.at(-1).text,'看这张图');assert.equal(events.at(-1).attachments[0].name,'Photo.jpg');
 await fs.appendFile(file,row('event_msg',{type:'task_complete'}).trimEnd());assert.equal((await readCodexThreadEvents('history-fixture')).at(-1).type,'turn.completed');
 console.log('History incremental reads, partial records, long-running status, event-only text and attachment extraction passed');
}finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true})}
