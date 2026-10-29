import {mergeEvents,conversationBlocks,groupToolActivity,activitySummary,requestId} from './console-core.js';

export function reconcileSideSnapshot(history,live){
  const item=event=>JSON.stringify([event.type,event.turnId,event.itemId]);
  const snapshots=new Map(history.filter(event=>event.textComplete&&event.eventId?.startsWith('history:side:')).map(event=>[item(event),event]));
  const cutoffs=new Map([...snapshots].map(([key,event])=>[key,live.findLastIndex(row=>row.eventId===event.eventId.slice('history:side:'.length))]));
  return mergeEvents(history,live.filter((event,index)=>{
    const snapshot=snapshots.get(item(event));if(!snapshot)return true;
    if(event.eventId?.startsWith('history:side:'))return false;
    const cutoff=cutoffs.get(item(event));
    return cutoff>=0?index>cutoff:Boolean(event.createdAt&&snapshot.createdAt&&event.createdAt>snapshot.createdAt);
  }));
}

// A side conversation owns its reader and draft. Hiding it releases the stream,
// while only an explicit end closes the ephemeral backend thread.
export function createThreadTools({api,getState,openThread,refreshThreads,markdownNode,el,button,iconNode}){
  const path=id=>`/api/threads/${encodeURIComponent(id)}`;
  let side=null,sideDialog=null,socket=null,reconnect=null,paintTimer=null,pendingTimer=null;
  const current=owner=>side===owner&&getState().generation===owner.generation;
  function disconnect(){clearTimeout(reconnect);clearTimeout(pendingTimer);const old=socket;socket=null;old?.close();}
  function shell(title,cls='',modal=true){
    const dialog=el('dialog','modal thread-tool-dialog '+cls),head=el('div','modal-heading');
    dialog.setAttribute('aria-label',title);head.append(el('h2',null,title),button('关闭',()=>dialog.close()));dialog.append(head);
    document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});if(modal)dialog.showModal();else dialog.show();return dialog;
  }
  function report(node,error){
    const detail=error?.message||String(error||'');
    node.hidden=!detail;
    if(!node.classList.contains('side-error')){node.textContent=detail;return;}
    if(node.dataset.message===detail)return;node.dataset.message=detail;node.replaceChildren();
    if(!detail)return;
    const title=/[\u4e00-\u9fff]/.test(detail)&&!detail.trim().startsWith('{')?detail:'侧聊暂时不可用';
    const details=el('details'),summary=el('summary',null,'查看详情');details.append(summary);
    details.addEventListener('toggle',()=>{if(details.open&&details.childElementCount===1)details.append(el('pre',null,detail));});
    node.append(el('p',null,title),details);
  }
  async function fork(lastTurnId){
    const source=getState().threadId,generation=getState().generation;
    const result=await api(path(source)+'/fork',{method:'POST',body:{ephemeral:false,...(lastTurnId?{lastTurnId}:{})}});
    if(generation!==getState().generation)return;
    await refreshThreads();await openThread(result.thread);
  }
  function accepted(owner){if(!current(owner))return;if(owner.input.value===owner.pending?.text)owner.input.value='';owner.pending=null;report(owner.error,'');update(owner);}
  async function checkSubmission(owner){
    if(!current(owner)||!owner.pending)return;
    const pending=owner.pending;
    try{
      const {submission}=await api(path(owner.id)+'/submission?requestId='+encodeURIComponent(pending.id));
      if(!current(owner)||owner.pending!==pending)return;
      if(submission?.state==='accepted')accepted(owner);
      else if(submission?.state==='failed'){owner.pending=null;report(owner.error,submission.error||'发送失败，文字已保留');update(owner);}
      else {report(owner.error,'消息提交状态尚未确认，文字已保留');update(owner);}
    }catch(error){if(current(owner))report(owner.error,error);}
  }
  function update(owner){
    owner.send.disabled=!socket||socket.readyState!==WebSocket.OPEN||Boolean(owner.pending)||owner.running||!owner.input.value.trim();
    owner.stop.hidden=!owner.running;owner.check.hidden=!owner.pending;
    owner.status.textContent=socket?.readyState===WebSocket.OPEN?(owner.pending?'正在确认发送':owner.running?'正在处理':'已连接'):
      !owner.error.hidden?(owner.id?'尚未连接':'创建失败'):'正在连接…';
  }
  function appendBlock(block,owner){
    const node=el('article','side-message '+(block.type==='user.message'?'side-user':''));
    if(block.children?.length||block.activities?.length||['reasoning.summary','context.compaction'].includes(block.type)){
      const fold=el('details','side-activity'),summary=el('summary',null,block.title||({'reasoning.summary':'思考过程','context.compaction':'上下文已压缩','files.summary':'已更改'})[block.type]||activitySummary(block.activities||[])||'操作');
      let mounted=false;fold.append(summary);
      fold.addEventListener('toggle',()=>{
        if(!fold.open||mounted)return;mounted=true;
        for(const child of block.children||block.activities||[{...block,children:null,activities:null,type:'message.delta'}])fold.append(appendBlock(child,owner));
      });node.append(fold);
    }else if(block.type==='approval.requested'){
      if(owner.events.some(event=>event.type==='approval.resolved'&&event.approvalId===block.approvalId))return node;
      node.append(el('p',null,block.title||'需要你的回答'));
      if(block.approvalType==='question'){
        let questions=[];try{questions=JSON.parse(block.detail||'{}').questions||[];}catch{}
        const fields=[];
        for(const question of questions){
          const label=el('label','side-question',question.question),input=el('input');input.type=question.isSecret?'password':'text';input.autocomplete='off';input.setAttribute('aria-label',question.question);
          input.value=owner.answers[block.approvalId]?.[question.id]||'';
          input.oninput=()=>{(owner.answers[block.approvalId]??={})[question.id]=input.value;};
          for(const option of question.options||[])label.append(button(option.label,()=>{input.value=option.label;input.oninput();},'button secondary compact'));
          label.append(input);node.append(label);fields.push([question.id,input]);
        }
        node.append(button('提交回答',async()=>{
          if(!questions.length||fields.some(([,input])=>!input.value.trim()))throw Error('请填写回答');
          await api('/api/approvals/'+encodeURIComponent(block.approvalId)+'/answer',{method:'POST',body:{threadId:owner.id,answers:Object.fromEntries(fields.map(([id,input])=>[id,{answers:[input.value]}]))}});
          resolveApproval(owner,block.approvalId);
        },'button compact'));
      }else{
        node.append(markdownNode(block.detail||''));
        for(const [label,decision] of [['拒绝','decline'],['允许','accept']])node.append(button(label,async()=>{
          await api('/api/approvals/'+encodeURIComponent(block.approvalId)+'/resolve',{method:'POST',body:{decision}});resolveApproval(owner,block.approvalId);
        },'button secondary compact'));
      }
    }else node.append(markdownNode(block.text||block.detail||block.title||''));
    return node;
  }
  function resolveApproval(owner,id){if(!current(owner))return;owner.events=mergeEvents(owner.events,[{type:'approval.resolved',threadId:owner.id,approvalId:id,eventId:requestId()}]);owner.nodes.clear();paint(owner);}
  function paint(owner){
    if(!current(owner)||!sideDialog?.open)return;
    // Keep unchanged nodes (including selection, open folds and form drafts) intact.
    const follow=owner.messages.scrollHeight-owner.messages.scrollTop-owner.messages.clientHeight<80;
    const blocks=groupToolActivity(conversationBlocks(owner.events,owner.id),{running:owner.running});
    owner.empty.hidden=blocks.length>0||!owner.error.hidden;
    const kept=new Set();let previous=null;
    blocks.forEach((block,index)=>{
      const key=block.eventId||block.itemId||`${block.type}:${index}`,signature=JSON.stringify(block);kept.add(key);
      let saved=owner.nodes.get(key);
      if(!saved||saved.signature!==signature){
        const node=appendBlock(block,owner);
        const open=saved?[...saved.node.querySelectorAll('details')].filter(d=>d.open).map(d=>d.querySelector('summary')?.textContent):[];
        node.querySelectorAll('details').forEach(d=>{if(open.includes(d.querySelector('summary')?.textContent))d.open=true;});
        saved?.node.replaceWith(node);saved={node,signature};owner.nodes.set(key,saved);
      }
      const next=previous?previous.nextSibling:owner.messages.firstChild;
      if(next!==saved.node)owner.messages.insertBefore(saved.node,next);previous=saved.node;
    });
    for(const [key,row] of owner.nodes)if(!kept.has(key)){row.node.remove();owner.nodes.delete(key);}
    if(follow)owner.messages.scrollTop=owner.messages.scrollHeight;update(owner);
  }
  function schedulePaint(owner){if(paintTimer)return;paintTimer=setTimeout(()=>{paintTimer=null;paint(owner);},80);}
  async function snapshot(owner){
    const history=await api(path(owner.id)+'/events?count=1000');if(!current(owner))return;
    // History snapshots carry complete item text; mergeEvents reconciles live fragments.
    owner.events=reconcileSideSnapshot(history.events||[],owner.events);
    const lifecycle=owner.events.findLast(event=>['turn.started','turn.completed'].includes(event.type));
    owner.running=lifecycle?lifecycle.type==='turn.started':history.status==='running';
    paint(owner);await checkSubmission(owner);
  }
  function connectSide(owner){
    disconnect();if(!current(owner)||!sideDialog?.open||document.hidden)return;
    const url=new URL('/ws',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    url.searchParams.set('token',getState().token);url.searchParams.set('device','Web 侧聊');url.searchParams.set('streamThread',owner.id);
    const reader=new WebSocket(url);socket=reader;update(owner);
    reader.onopen=()=>{if(socket!==reader||!current(owner))return;update(owner);snapshot(owner).catch(error=>{if(current(owner))report(owner.error,error);});};
    reader.onmessage=message=>{
      if(socket!==reader||!current(owner))return;
      let event;try{event=JSON.parse(message.data);}catch{return;}
      if(event.type==='command.accepted'&&event.requestId===owner.pending?.id){accepted(owner);return;}
      if(event.threadId!==owner.id)return;
      if(event.type==='turn.started')owner.running=true;
      if(event.type==='turn.completed')owner.running=false;
      owner.events=mergeEvents(owner.events,[event]);schedulePaint(owner);
    };
    reader.onerror=()=>reader.close();
    reader.onclose=()=>{if(socket!==reader)return;socket=null;update(owner);if(current(owner)&&sideDialog?.open&&!document.hidden)reconnect=setTimeout(()=>connectSide(owner),1500);};
  }
  async function showSide(){
    if(sideDialog?.open){sideDialog.focus();return;}
    const state=getState();if(side&&!current(side)){side=null;disconnect();}
    const dialog=shell('侧聊','side-chat-dialog',false);sideDialog=dialog;
    const error=el('div','side-error'),messages=el('div','side-messages'),input=el('textarea','side-input');error.hidden=true;input.rows=1;input.placeholder='描述任务…';input.setAttribute('aria-label','侧聊消息');
    const status=el('span','side-status'),actions=el('div','side-actions');
    const owner=side??{parent:state.threadId,id:'',generation:state.generation,events:[],nodes:new Map(),pending:null,running:false,answers:{},draft:''};side=owner;
    const empty=el('div','side-empty');empty.append(iconNode('chat'),el('strong',null,'开始侧聊'),el('p',null,'沿用当前会话的上下文'));messages.append(empty);
    Object.assign(owner,{error,messages,input,status,empty,nodes:new Map()});input.value=owner.draft||'';
    owner.send=button('发送',()=>{
      if(!current(owner))throw Error('电脑连接已变化，请重新打开侧聊');
      if(owner.pending||owner.running||!input.value.trim()||socket?.readyState!==WebSocket.OPEN)return;
      owner.pending={id:requestId(),text:input.value};
      socket.send(JSON.stringify({type:'turn.start',threadId:owner.id,requestId:owner.pending.id,text:owner.pending.text}));update(owner);
      clearTimeout(pendingTimer);pendingTimer=setTimeout(()=>checkSubmission(owner),10000);
    },'send-button');owner.send.replaceChildren(iconNode('arrow-up'));owner.send.setAttribute('aria-label','发送');owner.send.title='发送';
    owner.stop=button('停止',()=>{if(socket?.readyState!==WebSocket.OPEN)throw Error('连接尚未恢复');socket.send(JSON.stringify({type:'turn.interrupt',threadId:owner.id,requestId:requestId()}));},'icon-button composer-stop');
    owner.stop.replaceChildren(iconNode('stop'));owner.stop.setAttribute('aria-label','停止');owner.stop.title='停止';
    owner.check=button('核对提交状态',()=>checkSubmission(owner),'text-button');owner.check.hidden=!owner.pending;
    const end=button('结束侧聊',async()=>{if(!owner.id){dialog.close();side=null;return;}await api(path(owner.id)+'/side/close',{method:'POST',body:{}});dialog.close();side=null;},'text-button');
    input.oninput=()=>{owner.draft=input.value;update(owner);};
    input.onkeydown=event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();owner.send.click();}};
    const heading=dialog.querySelector('.modal-heading');heading.insertBefore(end,heading.lastElementChild);
    const composer=el('div','composer side-composer');actions.append(status,owner.check,owner.stop,owner.send);composer.append(input,actions);dialog.append(messages,error,composer);
    dialog.addEventListener('close',()=>{owner.draft=input.value;if(sideDialog===dialog){sideDialog=null;disconnect();clearTimeout(paintTimer);paintTimer=null;}}, {once:true});
    update(owner);
    async function create(){
      status.textContent='正在创建侧聊…';
      try{
        const result=await api(path(owner.parent)+'/fork',{method:'POST',body:{ephemeral:true}});
        owner.id=result.thread.id;
        if(!current(owner)){await api(path(owner.id)+'/side/close',{method:'POST',body:{}});return;}
      }catch(failure){if(current(owner)){report(error,failure);status.textContent='创建失败';}}
    }
    async function createOrWait(){
      owner.creating??=create().finally(()=>{owner.creating=null;});
      await owner.creating;
      if(owner.id&&current(owner)&&sideDialog===dialog&&dialog.open)connectSide(owner);
    }
    if(owner.id){paint(owner);connectSide(owner);}else {
      const retry=button('重试创建',async()=>{retry.disabled=true;await createOrWait();retry.hidden=Boolean(owner.id);retry.disabled=false;},'text-button');
      dialog.append(retry);await createOrWait();retry.hidden=Boolean(owner.id);
    }
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else if(sideDialog?.open&&side?.id)connectSide(side);});
  async function terminals(){
    const id=getState().threadId,dialog=shell('后台终端'),body=el('div','thread-tool-list'),error=el('p','error');let cursor=null;
    async function load(append=false){
      const result=await api(path(id)+'/background-terminals'+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(!dialog.open)return;
      if(!append)body.replaceChildren();cursor=result.nextCursor;
      for(const row of result.data||[]){const card=el('section','thread-tool-card');card.append(el('pre',null,row.command),el('p','muted',row.cwd));
        const usage=[row.osPid!=null?`PID ${row.osPid}`:'',row.cpuPercent!=null?`CPU ${row.cpuPercent.toFixed(1)}%`:'',row.rssKb!=null?`${(row.rssKb/1024).toFixed(1)} MB`:''].filter(Boolean).join(' · ');if(usage)card.append(el('p','muted',usage));
        card.append(button('停止',async()=>{await api(path(id)+'/background-terminals/terminate',{method:'POST',body:{processId:row.processId}});await load();},'button secondary compact'));body.append(card);
      }
      if(!body.childElementCount)body.append(el('p','muted','没有运行中的后台终端'));more.hidden=!cursor;
    }
    const more=button('加载更多',()=>load(true),'text-button');more.hidden=true;dialog.append(button('刷新',()=>load()),body,more,error);
    try{await load();}catch(failure){report(error,failure);}
  }
  function review(){
    const id=getState().threadId,dialog=shell('审阅'),select=el('select'),value=el('textarea'),error=el('p','error');
    for(const [type,label] of [['uncommittedChanges','工作区更改'],['baseBranch','对比分支'],['commit','提交'],['custom','自定义']]){const option=el('option',null,label);option.value=type;select.append(option);}
    select.setAttribute('aria-label','审阅范围');value.setAttribute('aria-label','审阅目标');value.hidden=true;value.rows=3;
    select.onchange=()=>{value.hidden=select.value==='uncommittedChanges';value.placeholder=({baseBranch:'基准分支',commit:'提交 SHA',custom:'审阅要求'})[select.value]||'';};
    const start=button('开始审阅',async()=>{
      const type=select.value,body={type};if(type!=='uncommittedChanges')body[({baseBranch:'branch',commit:'sha',custom:'instructions'})[type]]=value.value.trim();
      try{await api(path(id)+'/review',{method:'POST',body});dialog.close();}catch(failure){report(error,failure);}
    },'button compact');dialog.append(select,value,error,start);
  }
  function browser(){
    const dialog=shell('电脑浏览器','desktop-browser-dialog'),error=el('p','error'),controls=el('div','browser-controls'),tabs=el('select'),address=el('input'),endpoint=el('input'),image=el('img','desktop-browser-image'),text=el('input'),view=el('div','desktop-browser-view');
    tabs.setAttribute('aria-label','浏览器标签');address.setAttribute('aria-label','网页地址');address.placeholder='https://';text.setAttribute('aria-label','输入网页文字');text.placeholder='输入网页文字';
    endpoint.placeholder='本机 CDP 地址，如 http://127.0.0.1:9222';endpoint.setAttribute('aria-label','浏览器调试地址');
    let selected='',frame=null,refreshing=false,stopped=false,timer=null,wheel=null,deltaX=0,deltaY=0;
    const failed=failure=>{if(dialog.open)report(error,failure);};
    async function refresh(){
      if(stopped||document.hidden||!selected||refreshing)return;
      refreshing=true;const id=selected;
      try{const result=await api(`/api/browser/${encodeURIComponent(id)}/screenshot`);if(stopped||id!==selected)return;frame=result;image.src='data:image/jpeg;base64,'+result.data;image.alt=result.title||'电脑浏览器画面';if(document.activeElement!==address)address.value=result.url||'';report(error,'');}
      catch(failure){failed(failure);}finally{refreshing=false;}
    }
    async function act(action){if(!selected)throw Error('请先选择浏览器标签');await api(`/api/browser/${encodeURIComponent(selected)}/action`,{method:'POST',body:action});await refresh();}
    async function list(result){
      result??=await api('/api/browser/tabs');if(stopped)return;
      const previous=selected;tabs.replaceChildren();for(const tab of result.tabs||[]){const option=el('option',null,tab.title||tab.url);option.value=tab.id;tabs.append(option);}
      selected=(result.tabs||[]).some(tab=>tab.id===previous)?previous:result.tabs?.[0]?.id||'';tabs.value=selected;
      if(!selected){frame=null;image.removeAttribute('src');report(error,result.error||'没有可控制的网页标签');}else await refresh();
    }
    tabs.onchange=()=>{selected=tabs.value;frame=null;refresh().catch(failed);};
    for(const [label,type] of [['后退','back'],['前进','forward'],['刷新','reload']])controls.append(button(label,()=>act({type}),'button secondary compact'));
    controls.append(tabs,button('更新标签',()=>list(),'text-button'));
    const navigate=()=>act({type:'navigate',url:address.value});address.onkeydown=event=>{if(event.key==='Enter')navigate().catch(failed);};
    const nav=el('div','browser-controls');nav.append(address,button('前往',navigate,'button compact'));
    image.onclick=event=>{if(!frame)return;const rect=image.getBoundingClientRect();act({type:'click',x:(event.clientX-rect.left)*frame.width/rect.width,y:(event.clientY-rect.top)*frame.height/rect.height}).catch(failed);};
    view.onwheel=event=>{if(!frame)return;event.preventDefault();deltaX+=event.deltaX;deltaY+=event.deltaY;if(wheel)return;wheel=setTimeout(()=>{wheel=null;const action={type:'scroll',x:frame.width/2,y:frame.height/2,deltaX:Math.max(-10000,Math.min(10000,deltaX)),deltaY:Math.max(-10000,Math.min(10000,deltaY))};deltaX=deltaY=0;act(action).catch(failed);},60);};
    const entry=el('div','browser-controls');entry.append(text,button('输入',async()=>{await act({type:'text',text:text.value});text.value='';},'button compact'));
    for(const key of ['Enter','Backspace','Escape'])entry.append(button(key,()=>act({type:'key',key}),'text-button'));
    const setup=el('details'),summary=el('summary',null,'连接设置');setup.append(summary,endpoint,button('连接',async()=>list(await api('/api/browser/connection',{method:'PUT',body:{endpoint:endpoint.value.trim()}})),'button compact'));
    view.append(image);dialog.append(controls,nav,error,view,entry,setup);list().catch(failed);timer=setInterval(()=>refresh().catch(failed),750);
    dialog.addEventListener('close',()=>{stopped=true;clearInterval(timer);clearTimeout(wheel);},{once:true});
  }
  function menuItems(){
    const state=getState(),enabled=name=>state.capabilities.includes(name);
    const codex=state.threadId&&state.harness==='codex';
    return [...(codex&&enabled('thread-side-chat')?[[side?.id?'打开侧聊':'发起侧聊',showSide]]:[]),...(codex&&enabled('thread-fork')?[['创建会话分支',()=>fork()]]:[]),...(codex&&enabled('codex-background-terminals')?[['后台终端',terminals]]:[]),...(codex&&enabled('codex-review')?[['审阅',review]]:[]),...(enabled('desktop-browser')?[['电脑浏览器',browser]]:[])];
  }
  return {menuItems,fork};
}
