/** Owns attachment drafts, upload batches and preview lifetimes for one console. */
export function createAttachmentsController({
  state, $, el, button, icon, iconNode, api, safeRead, safeWrite, requestId, draftKey, readPendingSubmission, syncQueueRestoreCopies, resizeComposer, updateControls, onlineRequired, toast, run, confirmAction, errorMessage, markdownNode, renderPdf,
}) {
  function attachmentUrl(image) { return `/api/uploads/images/${encodeURIComponent(image.id)}?token=${encodeURIComponent(state.token)}`; }
  function fileUrl(file){return `/api/uploads/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(state.token)}`;}
  const filePreviewDialogs=new Set();
  function trackFilePreview(modal){
    filePreviewDialogs.add(modal);
    modal.addEventListener('close',()=>filePreviewDialogs.delete(modal),{once:true});
  }
  function closeFilePreviews(){
    for(const modal of filePreviewDialogs){modal.close();modal.remove();}
    filePreviewDialogs.clear();
  }
  async function readPreviewText(url,signal){
    const response=await fetch(url,{signal});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(response.status===401?'访问凭据无效或已撤销，请重新连接。':error.error||`文件读取失败（HTTP ${response.status}）`);}
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>5*1024*1024)throw new Error('文件超过预览大小，请下载后查看');chunks.push(value);}
    }finally{await reader.cancel().catch(()=>{});}
    const encoded=new Uint8Array(await new Blob(chunks).arrayBuffer());
    if(encoded.length>=4&&(encoded[0]===255&&encoded[1]===254&&encoded[2]===0&&encoded[3]===0||encoded[0]===0&&encoded[1]===0&&encoded[2]===254&&encoded[3]===255))throw new Error('无法识别文本编码，请下载后查看');
    const encoding=encoded[0]===255&&encoded[1]===254?'utf-16le':encoded[0]===254&&encoded[1]===255?'utf-16be':'utf-8';
    try{return new TextDecoder(encoding,{fatal:true}).decode(encoded);}
    catch{throw new Error('无法识别文本编码，请下载后查看');}
  }
  function uploadedMime(file){return String(file.mime||'').split(';',1)[0].trim().toLowerCase();}
  const uploadedTextMimes=new Set(['application/json','application/xml','application/yaml','application/x-yaml','application/toml','application/javascript']);
  function uploadedPreviewKind(file){
    const mime=uploadedMime(file);
    if(mime==='application/pdf'||/\.pdf$/i.test(file.name))return 'pdf';
    if(/^image\/(png|jpeg|gif|webp)$/.test(mime)||/\.(png|jpe?g|gif|webp)$/i.test(file.name))return 'image';
    if(file.size<=5*1024*1024&&(mime.startsWith('text/')||uploadedTextMimes.has(mime)||/\.(md|markdown|txt|log|json|csv|ya?ml|toml|xml|html?|css|js|ts|py|sh|kt|java|go|rs|c|h|cpp|hpp|sql|ps1|bat|ini|cfg|tex|bib|r)$/i.test(file.name)))return 'text';
    return null;
  }
  function openUploadedFile(file){
    const kind=uploadedPreviewKind(file),generation=state.generation,projectId=state.chatProject,url=fileUrl(file);
    const modal=el('dialog','output-modal'),heading=el('div','output-heading'),body=el('div','output-body');
    modal.setAttribute('aria-label',file.name);
    const close=button('关闭',()=>modal.close(),'button secondary');
    const download=el('a','button secondary glyph-action');download.href=url;download.download=file.name;
    download.innerHTML=icon('download');download.title='下载';download.setAttribute('aria-label','下载');
    heading.append(el('h2',null,file.name),download,close);modal.append(heading,body);document.body.append(modal);
    let controller;
    const current=()=>modal.isConnected&&generation===state.generation;
    modal.addEventListener('close',()=>{controller?.abort();modal.remove();},{once:true});trackFilePreview(modal);modal.showModal();
    async function load(){
      if(!current())return;
      controller?.abort();controller=new AbortController();const signal=controller.signal;
      body.textContent='正在打开文件…';
      let timer;
      try{
        if(kind==='pdf')await renderPdf(body,url,current);
        else if(kind==='image'){
          const img=el('img');img.alt=file.name;
          await new Promise((resolve,reject)=>{
            img.onload=resolve;img.onerror=()=>reject(new Error('图片加载失败，请重试'));
            signal.addEventListener('abort',()=>{img.removeAttribute('src');reject(new DOMException('已取消','AbortError'));},{once:true});
            timer=setTimeout(()=>{img.removeAttribute('src');reject(new Error('图片加载超时，请重试'));},20000);
            img.src=url;
          });
          if(current()){enableImageZoom(img);body.replaceChildren(img);}
        }else{
          timer=setTimeout(()=>controller.abort(),20000);
          const text=await readPreviewText(url,signal);
          if(current())body.replaceChildren(/\.(md|markdown)$/i.test(file.name)||['text/markdown','text/x-markdown'].includes(uploadedMime(file))?markdownNode(text,projectId):el('pre','output-text',text));
        }
        if(modal.isConnected&&!current()){download.hidden=true;body.textContent='连接已改变，请关闭后重新打开文件。';}
      }catch(error){
        if(!modal.isConnected)return;
        if(!current()){download.hidden=true;body.textContent='连接已改变，请关闭后重新打开文件。';return;}
        const message=el('p',null,'无法打开文件：'+(error.name==='AbortError'?'文件读取超时，请重试':errorMessage(error)));message.setAttribute('role','alert');
        body.replaceChildren(message,button('重试',load,'button secondary'));
      }finally{clearTimeout(timer);}
    }
    download.onclick=event=>{if(!current()){event.preventDefault();download.hidden=true;body.textContent='连接已改变，请关闭后重新打开文件。';}};
    void load();
  }
  function fileCards(files,removable=false){
    const list=el('div','file-attachments');
    for(const file of files||[]){
      const card=el('div','file-attachment');
      if(uploadedMime(file).startsWith('video/')){
        const video=el('video');video.controls=true;video.preload='metadata';video.src=fileUrl(file);card.append(video);
      }
      const link=el('a','file-attachment-link',file.name);link.href=fileUrl(file);link.target='_blank';link.rel='noopener';link.download=file.name;
      if(uploadedPreviewKind(file)){link.removeAttribute('target');link.removeAttribute('download');link.onclick=event=>{event.preventDefault();openUploadedFile(file);};}
      card.append(link,el('small',null,`${Math.max(1,Math.round(file.size/1024))} KB`));
      if(removable)card.append(button('移除',()=>{const key=draftKey();state.fileDrafts[key]=(state.fileDrafts[key]||[]).filter(item=>item.id!==file.id);saveFileDrafts();renderFileDrafts();updateControls();},'image-remove'));
      list.append(card);
    }
    return list;
  }
  let uploadDraftTimer=null,uploadDraftPromise=Promise.resolve(),uploadDraftSignature='';
  function uploadStorageOwner(){let owner=safeRead('cmc.uploadOwner');if(!owner){owner=requestId();safeWrite('cmc.uploadOwner',owner);}return owner;}
  function uploadDraftBody(){
    const items=[];
    const append=(kind,rows)=>{for(const row of rows||[])if(row?.id)items.push({kind,id:row.id});};
    Object.values(state.imageDrafts).forEach(rows=>append('image',rows));
    Object.values(state.fileDrafts).forEach(rows=>append('file',rows));
    if(state.messageEditDraft){append('image',state.messageEditDraft.images);append('file',state.messageEditDraft.files);}
    for(const record of [state.pending,readPendingSubmission()])if(record){append('image',record.images);append('file',record.files);}
    return {owner:uploadStorageOwner(),items:[...new Map(items.map(item=>[`${item.kind}:${item.id}`,item])).values()]};
  }
  function syncUploadDrafts(){
    const generation=state.generation;
    uploadDraftPromise=uploadDraftPromise.catch(()=>{}).then(async()=>{
      if(!state.connected||state.uploading||generation!==state.generation)return;
      const body=uploadDraftBody(),signature=JSON.stringify([generation,body]);
      if(signature===uploadDraftSignature)return;
      await api('/api/uploads/drafts',{method:'PUT',body});
      if(generation===state.generation)uploadDraftSignature=signature;
    });
    return uploadDraftPromise;
  }
  function scheduleUploadDraftSync(){
    if(!state.connected||state.uploading)return;
    clearTimeout(uploadDraftTimer);uploadDraftTimer=setTimeout(()=>syncUploadDrafts().catch(()=>{}),300);
  }
  async function showUploadStorage(){
    if(!state.connected)throw Error('请先连接电脑');
    const generation=state.generation,dialog=el('dialog','output-modal'),heading=el('div','output-heading'),body=el('div','output-body');
    heading.append(el('h2',null,'电脑上传附件'),button('关闭',()=>dialog.close(),'text-button'));
    const summary=el('p'),search=el('input'),age=el('select'),status=el('p','muted'),list=el('div'),actions=el('div','dialog-actions');
    search.type='search';search.placeholder='搜索文件名';search.setAttribute('aria-label','搜索文件名');
    for(const [value,label] of [[0,'全部日期'],[30,'30 天前'],[90,'90 天前']]){const option=el('option',null,label);option.value=String(value);age.append(option);}age.setAttribute('aria-label','上传日期');
    let data={items:[],totalBytes:0,blockedReason:''},selected=new Set(),busy=false;
    const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.max(0,Math.round(bytes/1024))} KB`;
    const current=()=>generation===state.generation&&dialog.open;
    const visible=()=>data.items.filter(item=>item.name.toLowerCase().includes(search.value.toLowerCase())&&(!Number(age.value)||Date.parse(item.createdAt)<Date.now()-Number(age.value)*86400000));
    const chosen=()=>data.items.filter(item=>selected.has(`${item.kind}:${item.id}`)&&!item.protectedReason);
    const refresh=button('刷新',()=>load(),'text-button');
    const select=button('选择当前列表',()=>{const keys=visible().filter(item=>!item.protectedReason).map(item=>`${item.kind}:${item.id}`),all=keys.every(key=>selected.has(key));for(const key of keys)all?selected.delete(key):selected.add(key);render();},'button secondary');
    const remove=button('清理所选',async()=>{
      const rows=chosen();if(!rows.length)return;
      if(!await confirmAction('清理电脑附件',`将永久删除 ${rows.length} 个附件（${size(rows.reduce((sum,item)=>sum+item.size,0))}）。历史消息中的这些附件将无法再打开。聊天记录及已另存的文件会保留。`))return;
      if(!current())return;
      busy=true;render();
      try{
        await syncUploadDrafts();if(!current())return;
        const result=await api('/api/uploads/cleanup',{method:'POST',body:{items:rows.map(({kind,id})=>({kind,id}))}});
        if(!current())return;
        selected.clear();await load(`已清理 ${result.deletedCount} 个附件（${size(result.deletedBytes)}） · 跳过 ${result.skipped.length} 个 · 失败 ${result.failed.length} 个`);
      }catch(error){if(current()){status.textContent=errorMessage(error);busy=false;render();}}
    },'button');
    function render(){
      summary.textContent=`${size(data.totalBytes)} · ${data.items.length} 个附件 · 已选 ${chosen().length} 个（${size(chosen().reduce((sum,item)=>sum+item.size,0))}）`;
      const blocked=busy||!!data.blockedReason||!!state.uploading;
      refresh.disabled=busy;select.disabled=blocked||!visible().some(item=>!item.protectedReason);remove.disabled=blocked||!chosen().length;
      if(data.blockedReason)status.textContent=data.blockedReason;
      list.replaceChildren();
      for(const item of visible()){
        const row=el('label','upload-storage-row'),check=el('input'),detail=el('span');check.type='checkbox';check.checked=selected.has(`${item.kind}:${item.id}`);check.disabled=blocked||!!item.protectedReason;
        check.onchange=()=>{const key=`${item.kind}:${item.id}`;check.checked?selected.add(key):selected.delete(key);render();};
        detail.append(el('strong',null,item.name),el('small','muted',`${size(item.size)} · ${new Date(item.createdAt).toLocaleDateString()} · ${item.kind==='image'?'图片':'文件'}${item.protectedReason?' · '+item.protectedReason:''}`));row.append(check,detail);list.append(row);
      }
      if(!visible().length&&!busy)list.append(el('p','muted','没有符合条件的附件'));
    }
    async function load(message=''){
      busy=true;status.textContent='正在读取附件…';render();
      try{await syncUploadDrafts();const next=await api('/api/uploads/storage');if(!current())return;data=next;selected=new Set([...selected].filter(key=>data.items.some(item=>`${item.kind}:${item.id}`===key&&!item.protectedReason)));status.textContent=message;}
      catch(error){if(current())status.textContent=errorMessage(error);}
      finally{if(current()){busy=false;render();}}
    }
    search.oninput=render;age.onchange=()=>{selected.clear();render();};actions.append(refresh,select,remove);
    body.append(summary,search,age,status,list,actions);dialog.append(heading,body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();await load();
  }
  $('uploadStorageBtn').onclick=()=>run(showUploadStorage);
  function saveFileDrafts(){safeWrite('cmc.fileDrafts',JSON.stringify(state.fileDrafts));syncQueueRestoreCopies();scheduleUploadDraftSync();}
  function renderFileDrafts(){const files=state.fileDrafts[draftKey()]||[];const host=$('fileDrafts');host.hidden=!files.length;host.replaceChildren(...fileCards(files,true).childNodes);resizeComposer();}
  function openImageViewer(items, start = 0) {
    const modal = el('dialog', 'output-modal');
    const body = el('div', 'output-body');
    const full = el('img');
    const heading = el('div', 'output-heading');
    const title = el('h2');
    const prev = button('', () => show(index - 1), 'icon-button');
    prev.append(iconNode('arrow-left'));
    prev.setAttribute('aria-label', '上一张');
    const next = button('', () => show(index + 1), 'icon-button');
    next.append(iconNode('arrow-right'));
    next.setAttribute('aria-label', '下一张');
    const close = button('', () => modal.close(), 'icon-button');
    close.append(iconNode('close'));
    close.setAttribute('aria-label', '关闭');
    heading.append(prev, title, next, close);
    let index = start;
    function show(i) {
      index = (i + items.length) % items.length;
      full.src = items[index].src;
      full.alt = items[index].alt || '';
      title.textContent = items[index].alt || `图片 ${index + 1}/${items.length}`;
      prev.hidden = next.hidden = items.length < 2;
      full.dataset.zoomed = '';
      full.style.transform = 'none';
      body.scrollTop = 0;
    }
    enableImageZoom(full);
    body.append(full);
    modal.append(heading, body, button('关闭', () => modal.close(), 'button secondary'));
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    });
    document.body.append(modal);
    modal.addEventListener('close', () => modal.remove(), { once: true });
    trackFilePreview(modal);
    modal.showModal();
    show(start);
  }
  function imageGallery(images,removable=false) {
    const gallery=el('div','image-gallery');
    for(const image of images||[]) {
      const tile=el('div','image-tile'),preview=el('img');preview.src=attachmentUrl(image);preview.alt=image.name;preview.loading='lazy';
      const view=button('',()=>{
        const group=(images||[]).map(image=>({src:attachmentUrl(image),alt:image.name}));
        openImageViewer(group,Math.max(0,(images||[]).indexOf(image)));
      },'image-open');view.setAttribute('aria-label',`查看图片 ${image.name}`);view.append(preview);tile.append(view);
      if(removable)tile.append(button('移除',()=>{state.imageDrafts[draftKey()]=(state.imageDrafts[draftKey()]||[]).filter(i=>i.id!==image.id);saveImageDrafts();renderImageDrafts();updateControls();},'image-remove'));
      gallery.append(tile);
    }
    return gallery;
  }
  function saveImageDrafts(){safeWrite('cmc.imageDrafts',JSON.stringify(state.imageDrafts));syncQueueRestoreCopies();scheduleUploadDraftSync();}
  function renderImageDrafts(){const images=state.imageDrafts[draftKey()]||[];$('imageDrafts').hidden=!images.length;$('imageDrafts').replaceChildren(...imageGallery(images,true).childNodes);resizeComposer();}
  function enableImageZoom(img) {
    img.style.cursor = "zoom-in";
    img.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const zoomed = img.dataset.zoomed === "1";
      if (!zoomed) {
        const rect = img.getBoundingClientRect();
        img.style.transformOrigin =
          `${((event.clientX - rect.left) / rect.width * 100).toFixed(1)}% ` +
          `${((event.clientY - rect.top) / rect.height * 100).toFixed(1)}%`;
      }
      img.style.transition = "transform .18s ease";
      img.style.transform = zoomed ? "none" : "scale(2.5)";
      img.dataset.zoomed = zoomed ? "" : "1";
      img.style.cursor = zoomed ? "zoom-in" : "zoom-out";
    });
  }
  function ownsUpload(owner){return state.uploadOwners.has(owner)&&!owner.cancelled&&owner.generation===state.generation;}
  function uploadCancelled(){return new DOMException('上传已取消','AbortError');}
  function requireUpload(owner){if(!ownsUpload(owner))throw uploadCancelled();}
  function renderUploadFeedback(){
    const owner=[...state.uploadOwners][0],error=state.uploadError||'';
    $('uploadFeedback').hidden=!owner&&!error;
    $('uploadStatus').textContent=owner?.message||error;
    $('uploadStatus').classList.toggle('error',Boolean(error)&&!owner);
    $('uploadCancel').hidden=!owner;$('uploadDismiss').hidden=!error||Boolean(owner);
    const progress=$('uploadProgress');progress.hidden=!owner||owner.progress==null;
    if(!progress.hidden){progress.firstElementChild.style.width=owner.progress+'%';progress.setAttribute('aria-valuenow',String(owner.progress));}
    else progress.removeAttribute('aria-valuenow');
  }
  function cancelUpload(){
    for(const owner of state.uploadOwners){owner.cancelled=true;owner.abort?.();}
    state.uploadOwners.clear();state.uploading=0;state.uploadError='';renderUploadFeedback();updateControls();
  }
  $('uploadCancel').onclick=cancelUpload;
  $('uploadDismiss').onclick=()=>{state.uploadError='';renderUploadFeedback();};
  async function withUploadBatch(files,action){
    if(!files.length||!onlineRequired())return;
    if(state.uploadOwners.size){toast('请先完成或取消当前上传');return;}
    // One owner covers image and file phases, and can follow a new conversation.
    const owner={key:draftKey(),selection:state.selection,generation:state.generation,token:state.token,total:files.length,done:0,message:'正在准备附件…',progress:null,cancelled:false,abort:null};
    state.uploadOwners.add(owner);state.uploading=1;state.uploadError='';renderUploadFeedback();updateControls();
    try{return await action(owner);}
    catch(error){if(ownsUpload(owner))state.uploadError=`${error.message||'附件上传失败'}；已上传附件保留，请重新选择未完成的文件`;}
    finally{state.uploadOwners.delete(owner);state.uploading=state.uploadOwners.size;renderUploadFeedback();updateControls();}
  }
  function uploadMessage(owner,file,phase,progress=null){
    requireUpload(owner);owner.progress=progress;
    owner.message=`${phase} ${file.name}${owner.total>1?` · ${owner.done+1}/${owner.total}`:''}${progress!=null&&progress<100?` · ${progress}%`:''}`;
    renderUploadFeedback();
  }
  function readUploadImage(file,owner){
    requireUpload(owner);
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;if(owner.abort===abort)owner.abort=null;error?reject(error):resolve(value);};
      const abort=()=>{finish(uploadCancelled());reader.abort();};owner.abort=abort;
      reader.onload=()=>finish(null,reader.result);reader.onerror=()=>finish(new Error('读取图片失败，请重新选择'));reader.onabort=()=>finish(uploadCancelled());
      reader.readAsDataURL(file);
    });
  }
  function uploadRequest(file,owner,{dataUrl}={}){
    requireUpload(owner);
    return new Promise((resolve,reject)=>{
      const image=dataUrl!==undefined,request=new XMLHttpRequest();let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;if(owner.abort===abort)owner.abort=null;error?reject(error):resolve(value);};
      const abort=()=>{finish(uploadCancelled());request.abort();};owner.abort=abort;
      request.open('POST',image?'/api/uploads/images':'/api/uploads/files');request.timeout=image?20000:300000;
      request.setRequestHeader('Authorization',`Bearer ${owner.token}`);request.setRequestHeader('Content-Type',image?'application/json':'application/octet-stream');
      request.setRequestHeader('X-Upload-Owner',uploadStorageOwner());
      if(!image){request.setRequestHeader('X-File-Name',encodeURIComponent(file.name));request.setRequestHeader('X-File-Type',file.type||'application/octet-stream');}
      request.upload.onprogress=event=>{
        if(!ownsUpload(owner)||!event.lengthComputable)return;
        const percent=Math.min(100,Math.round(event.loaded/event.total*100));uploadMessage(owner,file,percent>=100?'正在保存':'正在上传',percent);
      };
      request.onload=()=>{
        if(!ownsUpload(owner)){finish(uploadCancelled());return;}
        let result;try{result=JSON.parse(request.responseText);}catch{}
        if(request.status>=200&&request.status<300){
          if(typeof result?.id!=='string'||!result.id)finish(new Error('电脑返回的上传信息异常，请重新选择文件'));
          else finish(null,result);
        }else finish(new Error(request.status===401?'连接鉴权已失效，请重新连接':result?.message||result?.error||'附件上传失败'));
      };
      request.onerror=()=>finish(new Error('附件上传失败，请检查连接'));request.ontimeout=()=>finish(new Error('附件上传超时，请检查连接后重新选择'));request.onabort=()=>finish(uploadCancelled());
      request.send(image?JSON.stringify({name:file.name,dataUrl}):file);
    });
  }
  async function uploadImages(files,owner) {
    for(const file of files) {
      requireUpload(owner);
      if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type)||file.size>5*1024*1024)throw new Error('请选择不超过 5 MB 的 PNG、JPEG、GIF 或 WebP 图片');
      uploadMessage(owner,file,'正在准备');
      const dataUrl=await readUploadImage(file,owner);requireUpload(owner);uploadMessage(owner,file,'正在上传');
      const image=await uploadRequest(file,owner,{dataUrl});requireUpload(owner);
      if(owner.editor){owner.editor.images.push(image);owner.editor.changed();scheduleUploadDraftSync();}else{state.imageDrafts[owner.key]=[...(state.imageDrafts[owner.key]||[]),image];saveImageDrafts();renderImageDrafts();}owner.done++;
    }
  }
  async function uploadAttachments(files){
    const supportsImages=state.harness!=='antigravity'&&state.backends.find(backend=>backend.agent===state.harness)?.supportsImages!==false;
    const inline=supportsImages?files.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.type)&&file.size<=5*1024*1024):[];
    return withUploadBatch(files,async owner=>{await uploadImages(inline,owner);requireUpload(owner);await uploadFiles(files.filter(file=>!inline.includes(file)),owner);});
  }
  $('imageInput').onchange=()=>{const files=[...$('imageInput').files];$('imageInput').value='';run(()=>uploadAttachments(files))};
  async function uploadFiles(files,owner){
    if(!owner)return withUploadBatch(files,batch=>uploadFiles(files,batch));
    for(const file of files){
      requireUpload(owner);
      if((owner.editor?.files||state.fileDrafts[owner.key]||[]).length>=8)throw new Error('每条消息最多 8 个文件');
      if(!file.size||file.size>100*1024*1024)throw new Error('文件大小需在 100 MB 以内');
      uploadMessage(owner,file,'正在上传');const result=await uploadRequest(file,owner);requireUpload(owner);
      if(owner.editor){owner.editor.files.push(result);owner.editor.changed();scheduleUploadDraftSync();}else{state.fileDrafts[owner.key]=[...(state.fileDrafts[owner.key]||[]),result];saveFileDrafts();renderFileDrafts();}owner.done++;
    }
  }
  $('fileInput').onchange=()=>{const files=[...$('fileInput').files];$('fileInput').value='';run(()=>uploadFiles(files))};
  $('prompt').addEventListener('paste',event=>{
    const files=[...(event.clipboardData?.files||[])];if(!files.length)return;
    if(!event.clipboardData.getData('text/plain'))event.preventDefault();
    run(()=>uploadAttachments(files));
  });
  $('composer').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')||event.target!==$('prompt'))event.preventDefault();});
  $('composer').addEventListener('drop',event=>{
    const files=[...event.dataTransfer.files];if(!files.length){if(event.target!==$('prompt'))event.preventDefault();return;}
    event.preventDefault();run(()=>uploadAttachments(files));
  });

  async function uploadEditorAttachments(files,editor){
    return withUploadBatch(files,async owner=>{
      owner.editor=editor;editor.changed();
      const inline=files.filter(file=>/^image\/(png|jpeg|gif|webp)$/.test(file.type)&&file.size<=5*1024*1024);
      try{await uploadImages(inline,owner);requireUpload(owner);await uploadFiles(files.filter(file=>!inline.includes(file)),owner);}
      finally{queueMicrotask(()=>editor.changed());}
    });
  }
  return {uploadEditorAttachments,trackFilePreview, closeFilePreviews, readPreviewText, fileCards, scheduleUploadDraftSync, saveFileDrafts, renderFileDrafts, openImageViewer, imageGallery, saveImageDrafts, renderImageDrafts, enableImageZoom, cancelUpload};
}
