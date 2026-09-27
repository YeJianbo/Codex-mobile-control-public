import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pendingDesktopQuestions,readCodexThreadEvents,selectConversationWindow} from '../src/services/codexSessions.ts';

test('desktop async question becomes a phone prompt and its reply is shown as an answer',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-async-question-'));
  const previous=process.env.CODEX_HOME;
  const threadId='33333333-3333-3333-3333-333333333333';
  const dir=path.join(home,'sessions','2026','09','27');
  const file=path.join(dir,`rollout-2026-09-27-${threadId}.jsonl`);
  const row=payload=>JSON.stringify({timestamp:new Date().toISOString(),type:'response_item',payload})+'\n';
  const callId='call-test-question';
  try{
    await fs.mkdir(dir,{recursive:true});process.env.CODEX_HOME=home;
    await fs.writeFile(file,row({type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify({questions:[{title:'选择连接方式',options:['内网','公网']}]})}));
    let events=await readCodexThreadEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,1);
    assert.deepEqual(JSON.parse(pendingDesktopQuestions(threadId,events)[0].detail).questions[0],{id:'0',question:'选择连接方式',options:[{label:'内网'},{label:'公网'}]});
    const reply=`<send_user_message_question_reply>\n${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:'选择连接方式',answer:'公网'}])}\n</send_user_message_question_reply>`;
    await fs.appendFile(file,row({type:'message',role:'user',content:[{type:'input_text',text:reply}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}));
    events=await readCodexThreadEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,0);
    assert.equal(events.filter(event=>event.type==='user.message').at(-1).text,'公网');
  }finally{
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('a long tool stream keeps the user request visible',()=>{
  const threadId='stream';
  const events=[{type:'user.message',threadId,text:'先检查构建，再告诉我结果',eventId:'request'}];
  for(let i=0;i<250;i++)events.push({type:'tool.output',threadId,text:`output ${i}`,eventId:`output-${i}`});
  const visible=selectConversationWindow(events);
  assert.equal(visible[0].eventId,'request');
  assert.equal(visible.at(-1).eventId,'output-249');
  assert.ok(visible.length<100);
});

test('the active desktop turn remains discoverable after a long execution stream',()=>{
  const events=[{type:'turn.started',threadId:'t',turnId:'desktop-turn',eventId:'turn'}];
  for(let i=0;i<250;i++)events.push({type:'tool.started',threadId:'t',eventId:`tool-${i}`,title:'执行命令'});
  const window=selectConversationWindow(events);
  assert.equal(window.find(event=>event.type==='turn.started')?.turnId,'desktop-turn');
});

test('long sessions return a recent window before older pages are requested',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-history-page-'));
  const previous=process.env.CODEX_HOME;
  const id='22222222-2222-2222-2222-222222222222';
  const dir=path.join(home,'sessions','2026','09','27');
  try{
    await fs.mkdir(dir,{recursive:true});
    process.env.CODEX_HOME=home;
    const lines=Array.from({length:100},(_,index)=>JSON.stringify({timestamp:`2026-09-27T00:${String(index%60).padStart(2,'0')}:00Z`,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`消息 ${index}`}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}})).join('\n')+'\n';
    await fs.writeFile(path.join(dir,`rollout-2026-09-27-${id}.jsonl`),lines);
    const first=await readCodexThreadEvents(id,60);
    const older=await readCodexThreadEvents(id,120);
    assert.equal(first.length,61);
    assert.equal(first.at(-1).text,'消息 99');
    assert.equal(older.length,100);
    assert.equal(older[0].text,'消息 0');
  }finally{
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('resumed rollout updates the same thread without inventing an approval from tool text',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-history-'));
  const previous=process.env.CODEX_HOME;
  const id='11111111-1111-1111-1111-111111111111';
  const dir=path.join(home,'sessions','2026','09','27');
  await fs.mkdir(dir,{recursive:true});
  const older=path.join(dir,`rollout-2026-09-26-${id}.jsonl`);
  const newer=path.join(dir,`rollout-2026-09-27-${id}_resume.jsonl`);
  const row=(stamp,payload)=>JSON.stringify({timestamp:stamp,type:'response_item',payload})+'\n';
  const user=text=>({type:'message',role:'user',content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}});
  try{
    process.env.CODEX_HOME=home;
    await fs.writeFile(older,row('2026-09-26T00:00:00Z',user('旧消息')));
    await fs.writeFile(newer,row('2026-09-27T00:00:00Z',user('新消息')));
    const oldTime=new Date('2026-09-26T00:00:00Z');
    const newTime=new Date('2026-09-27T00:00:00Z');
    await fs.utimes(older,oldTime,oldTime);
    await fs.utimes(newer,newTime,newTime);
    let events=await readCodexThreadEvents(id);
    assert.deepEqual(events.filter(e=>e.type==='user.message').map(e=>e.text),['旧消息','新消息']);
    assert.equal(new Set(events.map(e=>e.eventId)).size,events.length);
    await fs.appendFile(newer,row('2026-09-27T00:01:00Z',user('<turn_aborted>\nThe user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background.\n</turn_aborted>')));
    await fs.appendFile(newer,row('2026-09-27T00:02:00Z',user('最新消息')));
    events=await readCodexThreadEvents(id);
    assert.deepEqual(events.filter(e=>e.type==='user.message').map(e=>e.text),['旧消息','新消息','最新消息']);
    const now=new Date(Date.now()-20000).toISOString();
    await fs.appendFile(newer,row(now,{type:'custom_tool_call',name:'exec',call_id:'approval-call',input:'await tools.exec_command({cmd:"example",sandbox_permissions:"require_escalated"})'}));
    events=await readCodexThreadEvents(id);
    assert.equal(events.filter(e=>e.type==='approval.requested').length,0);
    assert.equal(events.filter(e=>e.type==='tool.started'&&e.itemId==='approval-call').length,1);
    await fs.appendFile(newer,row(new Date().toISOString(),{type:'custom_tool_call_output',call_id:'approval-call',output:'done'}));
    events=await readCodexThreadEvents(id);
    assert.equal(events.filter(e=>e.type==='tool.completed'&&e.itemId==='approval-call').length,1);
    await fs.appendFile(newer,row(new Date().toISOString(),{type:'reasoning',summary:[{text:'先查看图片'}]}));
    await fs.appendFile(newer,row(new Date().toISOString(),{type:'custom_tool_call',name:'view_image',call_id:'image-call',input:'image.png'}));
    await fs.appendFile(newer,row(new Date().toISOString(),{type:'reasoning',summary:[{text:'接着编辑文件'}]}));
    await fs.appendFile(newer,row(new Date().toISOString(),{type:'custom_tool_call',name:'apply_patch',call_id:'patch-call',input:'patch'}));
    events=await readCodexThreadEvents(id);
    assert.deepEqual(events.filter(e=>e.type==='reasoning.summary').slice(-2).map(e=>e.text),['先查看图片','接着编辑文件']);
    assert.deepEqual(events.filter(e=>e.itemId==='image-call'||e.itemId==='patch-call').map(e=>e.title),['查看图片','编辑文件']);
  }finally{
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});
