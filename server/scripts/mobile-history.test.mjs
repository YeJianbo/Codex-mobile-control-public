import path from 'node:path';
import {appHome} from '../src/services/paths.ts';
import {filePrompt,codexFilePrompt} from '../src/services/fileUploads.ts';
import {splitDesktopAttachments} from '../src/services/codexSessions.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeMobileThreadEvents,mergeDeepSeekThreadEvents,latestMobileThreadLifecycle,recoverMobileUploadImages} from '../src/services/mobileHistory.ts';
import fs from 'node:fs/promises';
import os from 'node:os';

test('delayed inbox transcript pairs exact upload paths beyond two minutes',()=>{
 const image={id:'a7184853-9cfa-400a-9731-e11502a2e834.jpg',name:'screen.jpg'};
 const receipt={type:'user.message',threadId:'t',text:'已经发送的文字',eventId:'receipt',images:[image],createdAt:'2026-10-13T07:06:52Z'};
 const history={type:'user.message',threadId:'t',text:receipt.text,eventId:'history:1',attachments:[{name:image.name,path:path.join(appHome(),'uploads',image.id)}],createdAt:'2026-10-13T07:11:52Z'};
 const result=mergeMobileThreadEvents([history],[receipt]);
 assert.equal(result.length,1);assert.equal(result[0].eventId,history.eventId);assert.deepEqual(result[0].images,[image]);
 const second={...history,eventId:'history:2',createdAt:'2026-10-13T07:12:52Z'};
 assert.equal(mergeMobileThreadEvents([history,second],[receipt]).length,2,'real repeated submissions stay distinct');
});

test('plain receipt and desktop transcript retain one message and its submission identity',()=>{
  const history={type:'user.message',threadId:'t',text:'哪些做好了哪些还没完整实现 都测试了吗',eventId:'history:68914',itemId:'msg_01a12b84',createdAt:'2026-10-11T15:11:33.288Z'};
  const receipt={...history,eventId:'receipt',itemId:undefined,requestId:'3205432a',createdAt:'2026-10-11T15:11:33.787Z'};
  const merged=mergeMobileThreadEvents([history],[receipt]);
  assert.equal(merged.length,1);assert.equal(merged[0].eventId,history.eventId);
  assert.equal(merged[0].itemId,history.itemId);assert.equal(merged[0].requestId,receipt.requestId);
  const repeated={...history,eventId:'history:next',itemId:'msg_next',createdAt:'2026-10-11T15:12:33.288Z'};
  const next={...receipt,eventId:'receipt:next',requestId:'next-request',createdAt:'2026-10-11T15:12:33.787Z'};
  const two=mergeMobileThreadEvents([history,repeated],[next,receipt]);
  assert.equal(two.length,2);assert.deepEqual(two.map(event=>event.requestId),['3205432a','next-request']);
});

test('plain receipts require a unique nearby match or shared identity',()=>{
  const history={type:'user.message',threadId:'t',text:'继续',eventId:'history:one',createdAt:'2026-10-11T15:11:00Z'};
  const receipt={...history,eventId:'receipt',requestId:'request',createdAt:'2026-10-11T15:11:01Z'};
  assert.equal(mergeMobileThreadEvents([history,{...history,eventId:'history:two'}],[receipt]).length,3);
  assert.equal(mergeMobileThreadEvents([history],[{...receipt,createdAt:'2026-10-11T15:14:00Z'}]).length,2);
  assert.equal(mergeMobileThreadEvents([{...history,requestId:'other'}],[receipt]).length,2);
  const identified=mergeMobileThreadEvents([{...history,requestId:'request'}],[{...receipt,createdAt:'2026-10-11T15:14:00Z'}]);
  assert.equal(identified.length,1);
});

test('a prepended recent turn cannot assign its identity to older transcript messages',()=>{
  const history={type:'user.message',threadId:'t',text:'继续',eventId:'history:old',createdAt:'2026-10-11T15:11:00Z'};
  const receipt={...history,eventId:'receipt',requestId:'request',turnId:'old-turn',createdAt:'2026-10-11T15:11:01Z'};
  const events=mergeMobileThreadEvents([{type:'turn.started',threadId:'t',turnId:'latest-turn',createdAt:'2026-10-11T15:15:00Z'},history],[receipt]);
  assert.equal(events.filter(event=>event.type==='user.message').length,1);
  assert.equal(events.find(event=>event.type==='user.message').turnId,'old-turn');
});

test('uploaded image paths use one upload entry while preserving other images',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-upload-image-history-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;
  const image={id:'70f9db6b-845a-4c58-8026-32b6651b99b6.jpg',name:'截图'};
  try{
    process.env.CODEX_MOBILE_CONTROL_HOME=home;
    await fs.mkdir(path.join(home,'uploads'));
    const imagePath=path.join(home,'uploads',image.id);
    await fs.writeFile(imagePath,Buffer.from([255,216,255]));
    const other={name:'另一张图',path:path.join(home,'project',image.id)};
    const historical={type:'user.message',threadId:'t',text:'看图',eventId:'history:1',createdAt:'2026-10-11T10:50:00Z',attachments:[{name:'Image #1',path:imagePath},other]};
    const stored={...historical,eventId:'saved:1',createdAt:'2026-10-11T10:50:01Z',images:[image],attachments:undefined};
    const merged=mergeMobileThreadEvents([historical],[stored]);
    assert.deepEqual(merged[0].images,[image]);assert.deepEqual(merged[0].attachments,[other]);
    const [restored]=await recoverMobileUploadImages([historical]);
    assert.equal(restored.images.length,1);assert.equal(restored.images[0].id,image.id);assert.deepEqual(restored.attachments,[other]);
    const [deduplicated]=await recoverMobileUploadImages([{...historical,images:[image]}]);
    assert.deepEqual(deduplicated.images,[image]);assert.deepEqual(deduplicated.attachments,[other]);
  }finally{
    if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('complete saved items suppress even late-published deltas for that same item, preserving later items',()=>{
  const complete={type:'message.delta',threadId:'t',itemId:'answer',eventId:'history:final',text:'完整正文',textComplete:true,createdAt:'2026-10-04T06:00:00Z'};
  const late={type:'message.delta',threadId:'t',itemId:'answer',eventId:'late',text:'正文',createdAt:'2026-10-04T06:00:01Z'};
  const next={...late,itemId:'next-answer',eventId:'next',text:'下一条回复'};
  assert.deepEqual(mergeMobileThreadEvents([complete],[late,next]),[complete,next]);
});

test('confirmed interruption wins over stale running history until a newer turn starts',()=>{
 const started={type:'turn.started',threadId:'t',turnId:'old',createdAt:'2026-09-30T05:00:00Z'};
 const stopped={type:'turn.completed',threadId:'t',status:'interrupted',createdAt:'2026-09-30T05:00:01Z'};
 assert.equal(latestMobileThreadLifecycle([started],[stopped]),stopped);
 const next={...started,turnId:'next',createdAt:'2026-09-30T05:00:02Z'};
 assert.equal(latestMobileThreadLifecycle([started,next],[stopped]),next);
 const unknown={...started,createdAt:'invalid'},tie={...stopped,createdAt:undefined};
 assert.equal(latestMobileThreadLifecycle([unknown],[tie]),tie);
 assert.equal(latestMobileThreadLifecycle([started],[{...stopped,createdAt:started.createdAt}]).type,'turn.completed');
});

test('history sorting parses each timestamp once per merge and keeps stable ordering for missing dates',t=>{
 const parse=Date.parse,counts=new Map();
 t.mock.method(Date,'parse',text=>{counts.set(text,(counts.get(text)||0)+1);return parse(text);});
 const base=Date.UTC(2026,9,17);
 const rows=Array.from({length:600},(_,index)=>({type:'tool.output',threadId:'t',eventId:'output-'+index,detail:'body-'+index,createdAt:new Date(base+((index*37)%64)*1000).toISOString()}));
 rows[0].createdAt='';rows[1].createdAt='invalid';rows[2].createdAt=undefined;
 const historical=rows.filter((_,index)=>index%3===0),stored=rows.filter((_,index)=>index%3!==0);
 const verify=()=>{
  counts.clear();
  const expected=[...historical,...stored].sort((a,b)=>(parse(a.createdAt||'')||0)-(parse(b.createdAt||'')||0));
  const actual=mergeMobileThreadEvents(historical,stored);
  assert.deepEqual(actual.map(row=>row.eventId),expected.map(row=>row.eventId));
  assert.equal(counts.size,new Set(rows.map(row=>row.createdAt||'')).size);
  assert([...counts.values()].every(count=>count===1));
 };
 verify();rows[100].createdAt=new Date(base+999000).toISOString();verify();
});

test('DeepSeek repeated receipts keep first-match ties, infer only the next turn and replace completed live output',()=>{
 const threadId='deepseek-test',at=millis=>new Date(Date.UTC(2026,9,17)+millis).toISOString();
 const user=(id,text,turnId)=>({type:'user.message',threadId,eventId:id,requestId:id,text,turnId,createdAt:at(1000)});
 const stored=[user('orphan','unmatched'),user('receipt-1','继续'),
  {type:'turn.started',threadId,turnId:'gateway-1',createdAt:at(1000)},
  {type:'message.delta',threadId,turnId:'gateway-1',itemId:'live-1',text:'old live 1',createdAt:at(1101)},
  {type:'turn.completed',threadId,status:'completed',createdAt:at(1102)},
  user('receipt-2','继续','gateway-2'),
  {type:'turn.started',threadId,turnId:'gateway-2',createdAt:at(1000)},
  {type:'message.delta',threadId,turnId:'gateway-2',itemId:'live-2',text:'old live 2',createdAt:at(1201)},
  {type:'turn.completed',threadId,status:'completed',createdAt:at(1202)}];
 const native=[1,2].flatMap(index=>[
  {type:'turn.started',threadId,turnId:'native-'+index,eventId:'native-start-'+index,createdAt:at(1000+index*100-1)},
  {type:'user.message',threadId,turnId:'native-'+index,eventId:'native-user-'+index,text:'继续',createdAt:at(1000+index*100)},
  {type:'message.delta',threadId,turnId:'native-'+index,eventId:'native-answer-'+index,itemId:'answer-'+index,text:'saved '+index,textComplete:true,createdAt:at(1001+index*100)},
  {type:'turn.completed',threadId,turnId:'native-'+index,eventId:'native-end-'+index,status:'completed',createdAt:at(1002+index*100)}]);
 for(const owned of [false,true]){
  const result=mergeDeepSeekThreadEvents(native,stored,owned);
  assert.deepEqual(result.filter(row=>row.type==='turn.started').map(row=>row.turnId),['gateway-1','gateway-2']);
  assert.deepEqual(result.filter(row=>row.type==='user.message').map(row=>row.requestId),['receipt-1','receipt-2']);
  assert.deepEqual(result.filter(row=>row.type==='message.delta').map(row=>row.text),['saved 1','saved 2']);
  assert.deepEqual(result.filter(row=>row.type==='turn.completed').map(row=>row.turnId),['gateway-1','gateway-2']);
 }
 assert.equal(stored[4].turnId,undefined,'Normalizing a completion must not mutate the saved receipt snapshot');
});

test('delayed desktop history retains the uploaded image on its message',()=>{
  const history=[{type:'user.message',threadId:'t',text:'看图',eventId:'history:1',createdAt:'2026-09-28T10:00:00Z'}];
  const stored=[{type:'user.message',threadId:'t',text:'看图',eventId:'mobile:1',createdAt:'2026-09-28T10:01:10Z',images:[{id:'picture.png',name:'图'}]}];
  const result=mergeMobileThreadEvents(history,stored);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].images,stored[0].images);
});

test('repeated text attaches each image to the nearest matching turn',()=>{
  const history=[0,1].map((n)=>({type:'user.message',threadId:'t',text:'看图',eventId:`history:${n}`,createdAt:`2026-09-28T10:0${n}:00Z`}));
  const stored=[1,0].map((n)=>({type:'user.message',threadId:'t',text:'看图',eventId:`mobile:${n}`,createdAt:`2026-09-28T10:0${n}:08Z`,images:[{id:`picture-${n}.png`,name:'图'}]}));
  const result=mergeMobileThreadEvents(history,stored);
  assert.deepEqual(result.map(event=>event.images?.[0]?.id),['picture-0.png','picture-1.png']);
});

test('a sent image is not shown again as its desktop embedded copy',()=>{
  const history=[{type:'user.message',threadId:'t',text:'看图',eventId:'history:1',createdAt:'2026-09-28T10:00:00Z',attachments:[
    {name:'图片 1',path:'history-embedded-image:0.jpeg'},
    {name:'notes.txt',path:'C:/notes.txt'},
  ]}];
  const stored=[{type:'user.message',threadId:'t',text:'看图',eventId:'mobile:1',createdAt:'2026-09-28T10:00:08Z',images:[{id:'picture.png',name:'图'}]}];
  const result=mergeMobileThreadEvents(history,stored);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].images,stored[0].images);
  assert.deepEqual(result[0].attachments,[{name:'notes.txt',path:'C:/notes.txt'}]);
});

const upload={id:'70f9db6b-845a-4c58-8026-32b6651b99b6',name:'Gallery_20261007_203331_261007_203341.pdf',mime:'application/pdf',size:17222947};
const fileText=text=>text+filePrompt([{...upload,absolutePath:path.join(appHome(),'uploads','files',upload.id,'content')}]);
const savedFile=text=>({type:'user.message',threadId:'t',text,files:[upload],eventId:'mobile:file',createdAt:'2026-10-07T12:34:08Z'});
const historyFile=text=>({type:'user.message',threadId:'t',text,eventId:'history:file',createdAt:'2026-10-07T12:34:00Z'});

test('file-only desktop history merges into one attachment without the internal path prompt',()=>{
  const result=mergeMobileThreadEvents([historyFile(fileText('').trim())],[savedFile('')]);
  assert.equal(result.length,1);assert.equal(result[0].text,'');assert.deepEqual(result[0].files,[upload]);
});

test('file history preserves original user text while tolerating history whitespace normalization',()=>{
  const text='  请读这个 PDF\n';
  const result=mergeMobileThreadEvents([historyFile(fileText(text).trim().replaceAll('\n','\r\n'))],[savedFile(text)]);
  assert.equal(result.length,1);assert.equal(result[0].text,text);assert.deepEqual(result[0].files,[upload]);
});

test('similar attachment text and different file identity are never silently removed',()=>{
  for(const text of [fileText('解释下面的提示')+'\n另外一条正文',fileText('').replace(upload.id,'00000000-0000-0000-0000-000000000000')]){
    const result=mergeMobileThreadEvents([historyFile(text)],[savedFile('')]);
    assert.equal(result.length,2);assert.equal(result[0].text,text);
  }
});

test('native local file envelope restores download IDs without duplicate attachments',()=>{
  for(const text of ['', '  请读这个 PDF\n']){
    const prompt=codexFilePrompt(text,[{...upload,absolutePath:path.join(appHome(),'uploads','files',upload.id,'content')}]);
    const parsed=splitDesktopAttachments(prompt);
    assert.equal(parsed.attachments[0].name,upload.name);
    const result=mergeMobileThreadEvents([{...historyFile(''),...parsed}],[savedFile(text)]);
    assert.equal(result.length,1);assert.equal(result[0].text,text);
    assert.deepEqual(result[0].files,[upload]);assert.equal(result[0].attachments,undefined);
  }
});

test('native file-only history matches file identity before nearby blank messages',()=>{
  const other={...upload,id:'70f9db6b-845a-4c58-8026-32b6651b99b7'};
  const parsed=splitDesktopAttachments(codexFilePrompt('',[{...upload,absolutePath:path.join(appHome(),'uploads','files',upload.id,'content')}]));
  const closer={...savedFile(''),createdAt:'2026-10-07T12:34:01Z',files:[other]};
  const result=mergeMobileThreadEvents([{...historyFile(''),...parsed}],[closer,savedFile('')]);
  assert.equal(result.length,2);assert.deepEqual(result[0].files,[upload]);assert.deepEqual(result[1].files,[other]);
});

test('legacy mixed file and image messages still restore both upload IDs',()=>{
  const history={...historyFile(fileText('请看附件')),attachments:[{name:'图片',path:'history-embedded-image:0.jpeg'}]};
  const saved={...savedFile('请看附件'),images:[{id:'photo.png',name:'图片'}]};
  const result=mergeMobileThreadEvents([history],[saved]);
  assert.equal(result.length,1);assert.deepEqual(result[0].files,[upload]);
  assert.deepEqual(result[0].images,saved.images);assert.equal(result[0].attachments,undefined);
});

test('distinct legacy texts do not compare every receipt against every historical message',()=>{
 const count=300,historical=[],stored=[];let historicalTextReads=0,storedTextReads=0;
 for(let index=0;index<count;index++){
  const createdAt=new Date(Date.UTC(2026,9,17)+index*1000).toISOString();
  historical.push({type:'user.message',threadId:'t',eventId:'history:'+index,createdAt,get text(){historicalTextReads++;return 'message-'+index;}});
  stored.push({type:'user.message',threadId:'t',eventId:'receipt-'+index,requestId:'request-'+index,createdAt,get text(){storedTextReads++;return 'message-'+index;}});
 }
 const result=mergeMobileThreadEvents(historical,stored);
 assert.equal(result.length,count);
 assert.deepEqual(result.map(row=>row.requestId),Array.from({length:count},(_,index)=>'request-'+index));
 assert(historicalTextReads+storedTextReads<=count*12,`Unrelated texts must not be revisited for every pair: ${historicalTextReads}+${storedTextReads}`);
});

test('file and plain candidates preserve source-order ties and stay within their conversation',()=>{
 const historical={...historyFile(' same '),attachments:[{name:upload.name,path:path.join(appHome(),'uploads','files',upload.id,'content')}]};
 const plain={type:'user.message',threadId:'t',eventId:'plain',requestId:'plain',text:' same ',createdAt:historical.createdAt};
 for(const createdAt of [historical.createdAt,'invalid']){
  const file={...savedFile('same'),requestId:'file',createdAt};
  const foreign={...file,threadId:'other',requestId:'foreign'};
  for(const candidates of [[plain,file],[file,plain]]){
   const result=mergeMobileThreadEvents([historical],[foreign,...candidates]);
   assert.equal(result.find(row=>row.eventId===historical.eventId).requestId,candidates[0].requestId);
  }
 }
});

test('DeepSeek distinct texts only inspect their corresponding receipt candidates',()=>{
 const count=200,native=[],stored=[];let nativeTextReads=0,storedTextReads=0;
 for(let index=0;index<count;index++){
  const createdAt=new Date(Date.UTC(2026,9,17)+index*1000).toISOString();
  native.push({type:'user.message',threadId:'deepseek-test',eventId:'native-'+index,turnId:'native-turn-'+index,createdAt,get text(){nativeTextReads++;return 'message-'+index;}});
  stored.push({type:'user.message',threadId:'deepseek-test',eventId:'receipt-'+index,requestId:'request-'+index,turnId:'gateway-turn-'+index,createdAt,get text(){storedTextReads++;return 'message-'+index;}});
 }
 const result=mergeDeepSeekThreadEvents(native,stored);
 assert.equal(result.length,count);
 assert.deepEqual(result.map(row=>row.turnId),Array.from({length:count},(_,index)=>'gateway-turn-'+index));
 assert.deepEqual(result.map(row=>row.requestId),Array.from({length:count},(_,index)=>'request-'+index));
 assert(nativeTextReads+storedTextReads<=count*12,`Unrelated DeepSeek texts must not be compared: ${nativeTextReads}+${storedTextReads}`);
});
