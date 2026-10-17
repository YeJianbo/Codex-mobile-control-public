import WebSocket from 'ws';
const ws=new WebSocket('ws://127.0.0.1:38459/ws?token=debug-admin-token&device=AGY-E2E');
const events=[];let step=0;const send=o=>ws.send(JSON.stringify(o));
const myThreads=new Set();
let imageId='';
const uploadImage=async()=>{
  const res=await fetch('http://127.0.0.1:38459/api/uploads/images',{method:'POST',headers:{Authorization:'Bearer debug-admin-token','Content-Type':'application/json'},body:JSON.stringify({dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==',name:'probe.png'})});
  const d=await res.json();imageId=d.id;console.log('uploaded image:',imageId);
};
ws.on('open',async()=>{console.log('connected');await uploadImage();
  send({type:'thread.start',requestId:'e2e-1',model:'antigravity::gemini-3.6-flash',effort:'low',permission:'ask',projectPath:'C:/Users/YeJianbo/AppData/Local/Temp/zcode-probe',initialText:'只回答数字：3+3=？'});});
ws.on('message',raw=>{
  const e=JSON.parse(raw);
  if(e.replayed)return;
  events.push(e);
  if(e.type==='thread.started'&&e.requestId?.startsWith('e2e-'))myThreads.add(e.threadId);
  const mine=e.threadId?myThreads.has(e.threadId):true;
  const tag=e.type||'?';
  if(mine&&!['message.delta','tool.output'].includes(tag))console.log('EV:',tag,e.type==='warning'?e.title:'',e.type==='error'?e.message.slice(0,110):'');
  if(e.type==='turn.completed'&&mine){
    step++;
    if(step===1){console.log('--turn1 OK (base+effort+ask+warning); testing legacy variant id--');
      send({type:'thread.start',requestId:'e2e-2',model:'antigravity::gemini-3.8-flash-high',permission:'auto',projectPath:'C:/Users/YeJianbo/AppData/Local/Temp/zcode-probe',initialText:'只回答数字：4+4=？'});}
    else if(step===2){console.log('--turn2 done; error was:',JSON.stringify(events.filter(x=>x.type==='error').map(x=>x.message.slice(0,110))));
      console.log('--testing image rejection--');
      send({type:'thread.start',requestId:'e2e-3',model:'antigravity::default',permission:'ask',projectPath:'C:/Users/YeJianbo/AppData/Local/Temp/zcode-probe',initialText:'图片测试',images:[{id:imageId,name:'probe.png'}]});}
    else if(step>=2){
      // 图片拒绝在 turn 启动前抛出，不会产生 turn.completed——以错误事件作为第三步的终点。
      const errors=events.filter(x=>x.type==='error'&&(!x.threadId||myThreads.has(x.threadId)));
      const imageOk=errors.some(x=>x.message.includes('Antigravity CLI 不支持图片'));
      const warnings=events.filter(x=>x.type==='warning'&&myThreads.has(x.threadId));
      const deltas=events.filter(x=>x.type==='message.delta'&&myThreads.has(x.threadId));
      console.log('SUMMARY: myTurns='+step,'warnings='+warnings.length,'deltas='+deltas.length,'errors='+errors.length);
      console.log('ERRORS:',errors.map(x=>x.message.slice(0,90)));
      console.log('IMAGE REJECTION:',imageOk?'OK':'MISSING');
      console.log(deltas.length>0&&imageOk&&warnings.length>=2?'E2E PASS':'E2E REVIEW');
      ws.close();process.exit(imageOk?0:1);
    }
  }
  if(e.type==='error'&&mine&&step>=2){
    const errors=events.filter(x=>x.type==='error'&&(!x.threadId||myThreads.has(x.threadId)));
    const imageOk=errors.some(x=>x.message.includes('Antigravity CLI 不支持图片'));
    if(imageOk){
      const warnings=events.filter(x=>x.type==='warning'&&myThreads.has(x.threadId));
      const deltas=events.filter(x=>x.type==='message.delta'&&myThreads.has(x.threadId));
      console.log('SUMMARY: myTurns='+step,'warnings='+warnings.length,'deltas='+deltas.length,'errors='+errors.length);
      console.log('IMAGE REJECTION: OK');
      const phantom=[...myThreads].length>=3;
      console.log('PHANTOM THREAD CHECK:',phantom?'FAIL':'OK（图片拒绝未建线程）');
      console.log(deltas.length>0&&warnings.length>=1&&!phantom?'E2E PASS':'E2E REVIEW');
      ws.close();process.exit(deltas.length>0&&warnings.length>=1&&!phantom&&events.filter(x=>x.type==='turn.completed'&&myThreads.has(x.threadId)).every(x=>x.status==='completed')?0:1);
    }
    if(step===2){console.log('TURN2 FAILED UNEXPECTEDLY:',e.message.slice(0,110));ws.close();process.exit(1);}
  }
});
ws.on('error',x=>{console.log('WS ERROR',x.message);process.exit(1)});
setTimeout(()=>{console.log('TIMEOUT — events:',events.map(x=>x.type||'?').join(','));process.exit(1)},180000);
