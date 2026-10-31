import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {formatDesktopQuestionReply,pendingDesktopQuestions,readCodexThreadEvents,readCodexQuestionEvents,readRecentSearchEvents,selectConversationWindow,selectConversationPage,historyToolPresentation,visibleThreadTitle,splitDesktopAttachments,selectConversationTurns,readCodexConversationEvents,readCodexActivityEventById} from '../src/services/codexSessions.ts';

test('ten-turn pagination counts exchanges independently of command traffic',()=>{
 const rows=Array.from({length:12},(_,turn)=>[{type:'user.message',text:`question ${turn}`},...Array.from({length:80},(_,n)=>({type:'tool.completed',itemId:`${turn}-${n}`})),{type:'message.delta',text:`answer ${turn}`},{type:'turn.completed'}]).flat();
 const page=selectConversationTurns(rows,10);
 assert.equal(page.filter(e=>e.type==='user.message').length,10);
 assert.equal(page[0].text,'question 2');
 assert.equal(selectConversationTurns(rows,20).length,rows.length);
});

test('conversation reads grow past a tool-heavy tail and preserve deferred detail identities',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-ten-turn-')),previous=process.env.CODEX_HOME;
 const id='33333333-3333-3333-3333-333333333333';
 try{
  process.env.CODEX_HOME=home;await fs.mkdir(path.join(home,'sessions'));
  const message=(role,text)=>({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  const rows=Array.from({length:12},(_,turn)=>[message('user',`question ${turn}`),
   ...Array.from({length:90},(_,n)=>({type:'response_item',payload:{type:'function_call_output',call_id:`cmd-${turn}-${n}`,output:'x'.repeat(12000)}})),
   message('assistant',`answer ${turn}`),{type:'event_msg',payload:{type:'task_complete'}}]).flat();
  await fs.writeFile(path.join(home,'sessions',`rollout-${id}.jsonl`),rows.map(JSON.stringify).join('\n')+'\n');
  const loaded=await readCodexConversationEvents(id,10),page=selectConversationTurns(loaded,10);
  assert.equal(page.filter(e=>e.type==='user.message').length,10);
  assert.equal(page[0].text,'question 2');assert(loaded.length>page.length);
  const tool=page.find(e=>e.type==='tool.completed');const detail=await readCodexActivityEventById(id,tool.eventId);
  assert.equal(detail.detail,'x'.repeat(12000));assert.equal(detail.itemId,tool.itemId);
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('apply_patch history shows the patch rather than its JSON wrapper',()=>{
 const patch='*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch';
 const presented=historyToolPresentation('apply_patch',JSON.stringify({input:patch}));
 assert.equal(presented.title,'编辑文件');
 assert.equal(presented.detail,patch);
 const wrapped=historyToolPresentation('functions.exec',JSON.stringify({code:`text(await tools.apply_patch(${JSON.stringify(patch)}))`}));
 assert.equal(wrapped.title,'编辑文件');
 assert.equal(wrapped.detail,patch);
});

test('history paging retains a full completed exchange and the following running turn',()=>{
 const old=[{type:'user.message',text:'earlier'},{type:'message.delta',text:'earlier reply'}];
 const exchange=[{type:'user.message',text:'question'},...Array.from({length:100},(_,i)=>({type:'tool.completed',itemId:String(i)})),{type:'message.delta',text:'final'},{type:'turn.completed'}];
 const live=[{type:'user.message',text:'next question'},{type:'turn.started'},...Array.from({length:80},()=>({type:'tool.output'}))];
 assert.deepEqual(selectConversationPage([...old,...exchange],60),exchange);
 assert.deepEqual(selectConversationPage([...old,...exchange,...live],60),[...exchange,...live]);
 assert.deepEqual(selectConversationPage([...old,...exchange],exchange.length+60),[...old,...exchange]);
});

test('rollout pagination does not lose the question behind more than sixty tool events',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-full-turn-')),previous=process.env.CODEX_HOME;
 const id='77777777-7777-7777-7777-777777777777';
 try{
  process.env.CODEX_HOME=home;await fs.mkdir(path.join(home,'sessions'));
  const message=(role,text)=>({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  const rows=[message('user','earlier'),message('assistant','old answer'),message('user','keep this question'),
   ...Array.from({length:100},(_,i)=>({type:'response_item',payload:{type:'function_call_output',call_id:'cmd'+i,output:'ok'}})),
   message('assistant','final answer'),{type:'event_msg',payload:{type:'task_complete'}}];
  await fs.writeFile(path.join(home,'sessions',`rollout-${id}.jsonl`),rows.map(JSON.stringify).join('\n')+'\n');
  const loaded=await readCodexThreadEvents(id,60),page=selectConversationPage(loaded,60);
  assert.equal(page[0].text,'keep this question');
  assert(page.some(e=>e.text==='final answer'));
  assert(loaded.length>page.length,'retain the paging sentinel');
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('an image-only desktop request strips the attachment wrapper without a trailing newline',()=>{
 const result=splitDesktopAttachments('# Files mentioned by the user:\n\n## screenshot.png: C:/temp/screenshot.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user\'s request.\n\n## My request:');
 assert.equal(result.text,'');assert.deepEqual(result.attachments,[{name:'screenshot.png',path:'C:/temp/screenshot.png'}]);
});

test('desktop page events are hidden by provenance while user text and quoted markers survive',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-page-event-')),previous=process.env.CODEX_HOME;
 const id='88888888-8888-8888-8888-888888888888';
 const marker='<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
 const message=(texts,kinds)=>({type:'response_item',payload:{type:'message',role:'user',content:texts.map(text=>({type:'input_text',text})),internal_chat_message_metadata_passthrough:{content_item_kinds:kinds}}});
 try{
  process.env.CODEX_HOME=home;await fs.mkdir(path.join(home,'sessions'));
  const rows=[message([marker],['additional_content.codex_apps_open_page']),
   message([marker,'补一下6.1的价格'],['additional_content.codex_apps_open_page','user.text']),
   message([marker],['user.text'])];
  await fs.writeFile(path.join(home,'sessions',`rollout-${id}.jsonl`),rows.map(JSON.stringify).join('\n')+'\n');
  const events=await readCodexThreadEvents(id);
  assert.deepEqual(events.filter(e=>e.type==='user.message').map(e=>e.text),['补一下6.1的价格',marker]);
  assert.deepEqual((await readRecentSearchEvents(id)).filter(e=>e.type==='user.message').map(e=>e.text),['补一下6.1的价格',marker]);
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('legacy page markers hide only a complete known event and retain malformed or quoted text',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-legacy-page-event-')),previous=process.env.CODEX_HOME;
 const ids=['99999999-9999-9999-9999-999999999991','99999999-9999-9999-9999-999999999992'];
 const marker=value=>`<external_codex_apps_open_page>${value}</external_codex_apps_open_page>`;
 const visible=[marker('not json'),marker('{"page_id":42}'),marker('{"page_id":null,"note":"user text"}'),`请解释 ${marker('{"page_id":null}')}`,`\u0060\u0060\u0060xml\n${marker('{"page_id":null}')}\n\u0060\u0060\u0060`];
 const texts=[marker('{"page_id":null}'),marker('{"page_id":"example-page"}'),...visible];
 try{
  process.env.CODEX_HOME=home;await fs.mkdir(path.join(home,'sessions'));
  for(const [index,id] of ids.entries()){
   const rows=texts.map(text=>index===0?{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}:{type:'event_msg',payload:{type:'user_message',message:text}});
   await fs.writeFile(path.join(home,'sessions',`rollout-${id}.jsonl`),rows.map(JSON.stringify).join('\n')+'\n');
  }
  for(const id of ids){
   const events=await readCodexThreadEvents(id);
   assert.deepEqual(events.filter(e=>e.type==='user.message').map(e=>e.text),visible);
  }
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('tail hydration preserves lifecycle and message IDs when loading older pages',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-tail-page-')),previous=process.env.CODEX_HOME;
 const id='66666666-6666-6666-6666-666666666666',dir=path.join(home,'sessions');
 try{
  process.env.CODEX_HOME=home;await fs.mkdir(dir,{recursive:true});
  const rows=[JSON.stringify({type:'event_msg',payload:{type:'task_started',turn_id:'running-turn'}}),JSON.stringify({type:'ignored',payload:{padding:'x'.repeat(10*1024*1024)}})];
  for(let i=0;i<2000;i++)rows.push(JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:`message-${i}`}]}}));
  await fs.writeFile(path.join(dir,`rollout-${id}.jsonl`),rows.join('\n')+'\n');
  const first=await readCodexThreadEvents(id,60),latest=await readCodexThreadEvents(id);
  assert(latest.some(e=>e.type==='turn.started'));
  const older=await readCodexThreadEvents(id,1200);
  assert.deepEqual(first.map(e=>e.eventId),older.slice(-first.length).map(e=>e.eventId));
  assert.equal(first.at(-1).text,'message-1999');
 }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('history unwraps command display without executing tool input and cleans generated titles',()=>{
  assert.deepEqual(historyToolPresentation('exec','text(await tools.exec_command({cmd:"Get-Content README.md",max_output_tokens:1000}))'),{title:'运行命令',detail:'Get-Content README.md'});
  assert.equal(historyToolPresentation('exec','await tools.view_image({path:"image.png"})').title,'查看图片');
  const mixed=historyToolPresentation('exec','await tools.exec_command({cmd:"Get-Content log.txt"}); await tools.view_image({path:"F:/project/plot.png"})');
  assert.equal(mixed.title,'运行命令 · 查看图片');
  assert(mixed.detail.includes('![查看图片](<F:/project/plot.png>)'));
  assert.equal(visibleThreadTitle('<heartbeat><automation_id>internal</automation_id><instructions>定时检查内存\n详细内容</instructions></heartbeat>'),'定时检查内存');
  assert.equal(visibleThreadTitle('普通会话'),'普通会话');
});

test('compacted rollout records remain visible without exposing retained context',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-compacted-')),previous=process.env.CODEX_HOME;
  const id='44444444-4444-4444-4444-444444444444',dir=path.join(home,'sessions');
  try{
    process.env.CODEX_HOME=home;await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,`rollout-${id}.jsonl`),JSON.stringify({type:'compacted',payload:{message:'private retained context'}})+'\n');
    const events=await readCodexThreadEvents(id);
    assert.equal(events.at(-1).type,'context.compaction');
    assert.equal(events.at(-1).status,'ok');
    assert(!JSON.stringify(events).includes('private retained context'));
  }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

test('recent search skips a large retained-context record and reads following messages',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-search-tail-')),previous=process.env.CODEX_HOME;
  const id='55555555-5555-5555-5555-555555555555',dir=path.join(home,'sessions');
  try{
    process.env.CODEX_HOME=home;await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,`rollout-${id}.jsonl`),JSON.stringify({type:'compacted',payload:{message:'x'.repeat(3*1024*1024)}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'可检索的最新回复'}]}})+'\n');
    const events=await readRecentSearchEvents(id);
    assert.equal(events.length,1);assert.equal(events[0].text,'可检索的最新回复');
    const [page,approvalHistory]=await Promise.all([readCodexThreadEvents(id,60),readCodexThreadEvents(id)]);
    assert.deepEqual(page.map(e=>e.eventId),approvalHistory.map(e=>e.eventId));
    assert.equal(new Set(page.map(e=>e.eventId)).size,page.length);
  }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});

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
    await fs.appendFile(file,row({type:'message',role:'user',content:[{type:'input_text',text:'普通聊天不能算回答'}]}));
    events=await readCodexThreadEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,1);
    const reply=formatDesktopQuestionReply(`desktop-question:${callId}`,pendingDesktopQuestions(threadId,events)[0].detail,{'0':{answers:['公网']}});
    assert.deepEqual(JSON.parse(reply.split('\n')[1]),[{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:'选择连接方式',answer:'公网'}]);
    assert.throws(()=>formatDesktopQuestionReply(`desktop-question:${callId}`,pendingDesktopQuestions(threadId,events)[0].detail,{}),/所有问题/);
    await fs.appendFile(file,row({type:'message',role:'user',content:[{type:'input_text',text:reply}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}));
    events=await readCodexThreadEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,0);
    assert.equal(events.filter(event=>event.type==='user.message').at(-1).text,'公网');
    assert.deepEqual(events.filter(event=>event.type==='user.message').at(-1).questionReplies,[{question:'选择连接方式',answer:'公网'}]);
  }finally{
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('question history retains the latest turn across steering without reading old archives',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-question-window-')),previous=process.env.CODEX_HOME;
  const threadId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',dir=path.join(home,'sessions');
  const file=path.join(dir,`rollout-new-${threadId}.jsonl`),archive=path.join(dir,`rollout-old-${threadId}.jsonl.zst`);
  const row=(type,payload)=>JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n';
  const message=text=>row('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]});
  try{
    process.env.CODEX_HOME=home;await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(archive,'not a zstd archive');await fs.utimes(archive,new Date(0),new Date(0));
    await fs.writeFile(file,row('event_msg',{type:'task_started',turn_id:'current'})+message('first')+
      row('response_item',{type:'function_call',name:'request_user_input_async',call_id:'call-window',arguments:JSON.stringify({questions:[{title:'选择',options:['是','否']}]})}));
    let events=await readCodexQuestionEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,1);
    await fs.appendFile(file,message('steer one')+message('steer two')+message('steer three'));
    events=await readCodexQuestionEvents(threadId);
    const questions=pendingDesktopQuestions(threadId,events);
    assert.deepEqual(questions.map(q=>q.id),['desktop-question:call-window']);
    const reply=formatDesktopQuestionReply(questions[0].id,questions[0].detail,{'0':{answers:['是']}});
    await fs.appendFile(file,message(reply));
    events=await readCodexQuestionEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,0);
    await fs.appendFile(file,row('event_msg',{type:'task_started',turn_id:'next'})+message('next')+message('steer next'));
    events=await readCodexQuestionEvents(threadId);
    assert.equal(pendingDesktopQuestions(threadId,events).length,0);
  }finally{
    if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('desktop reply carries each original question identity and keeps unrelated prompts pending',()=>{
  const detail=JSON.stringify({questions:[{id:'0',question:'第一问'},{id:'1',question:'第二问'}]});
  const reply=formatDesktopQuestionReply('desktop-question:call-many',detail,{'0':{answers:['甲']},'1':{answers:['乙']}});
  const rows=JSON.parse(reply.split('\n')[1]);
  assert.deepEqual(rows.map(row=>JSON.parse(row.questionItemId)),[['request_user_input_async','call-many',0],['request_user_input_async','call-many',1]]);
  const events=['call-many','call-other'].map(id=>({type:'approval.requested',threadId:'t',approvalId:`desktop-question:${id}`,approvalType:'question',title:'提问',detail}));
  events.push({type:'user.message',threadId:'t',text:'甲\n乙',questionReplyId:'call-many'});
  assert.deepEqual(pendingDesktopQuestions('t',events).map(item=>item.id),['desktop-question:call-other']);
});

test('old desktop questions do not reappear in a later turn or a truncated history window',()=>{
  const question=id=>({type:'approval.requested',threadId:'t',approvalType:'question',approvalId:`desktop-question:${id}`,title:'提问',detail:'{"questions":[]}'});
  const events=[{type:'turn.started',threadId:'t',turnId:'old'},question('old'),{type:'turn.completed',threadId:'t'}, {type:'turn.started',threadId:'t',turnId:'current'},question('current')];
  for(let i=0;i<150;i++)events.push({type:'tool.started',threadId:'t',eventId:`tool-${i}`,title:'检查'});
  events.push({type:'turn.completed',threadId:'t'});
  const window=selectConversationWindow(events);
  assert.ok(window.some(event=>event.type==='turn.started'&&event.turnId==='current'));
  assert.deepEqual(pendingDesktopQuestions('t',window).map(item=>item.id),['desktop-question:current']);
  window.push({type:'turn.started',threadId:'t',turnId:'next'});
  assert.deepEqual(pendingDesktopQuestions('t',window),[]);
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
