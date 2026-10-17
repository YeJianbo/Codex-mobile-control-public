// A local output link is resolved against its conversation/file project, never the Gateway URL.
export function localFilePath(href) {
  if (!href || href.startsWith('#')) return null;
  // Strip URL syntax before decoding so an encoded # remains part of the name.
  let value=href.replace(/#.*$/,'').split('?')[0];
  try { value=decodeURIComponent(value); } catch { }
  value=value.replace(/:\d+(?::\d+)?$/,'');
  if (/^file:\/\//i.test(value)) value=value.replace(/^file:\/\//i,'');
  else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  value=value.replace(/\\/g,'/').replace(/^\/([a-z]:\/)/i,'$1');
  if(value.startsWith('//')) return null;
  return value.replace(/:\d+(?::\d+)?$/,'');
}
export function resolveFileLink(href,projects,projectId,basePath='') {
  let file=localFilePath(href);
  if(file===null) return null;
  const normalized=value=>value.replace(/\\/g,'/').replace(/\/+$/,'');
  if(basePath&&!/^(?:[a-z]:\/|\/)/i.test(file))file=normalized(basePath)+'/'+file;
  const absolute=/^(?:[a-z]:\/|\/)/i.test(file);
  if(absolute) {
    const project=[...projects].sort((a,b)=>b.path.length-a.path.length).find(p=>{
      const root=normalized(p.path);return file.toLowerCase().startsWith(root.toLowerCase()+'/');
    });
    if(!project) throw new Error('这个文件不在已授权的项目中，请先在设置中添加对应项目。');
    return {projectId:project.id,path:file.slice(normalized(project.path).length+1)};
  }
  if(!projectId) throw new Error('无法确定文件所属项目，请先选择会话项目。');
  return {projectId,path:file};
}

export async function renderPdf(target,url,current=()=>true) {
  const pdfjs=await import('./pdf.js');
  if(!target.isConnected||!current())return;
  pdfjs.GlobalWorkerOptions.workerSrc='/console/assets/pdf.worker.js';
  const loading=pdfjs.getDocument({url,isEvalSupported:false});
  let cancelled=false,pdf;
  const loadingObserver=new MutationObserver(()=>{
    if(!target.isConnected||!current()){cancelled=true;loadingObserver.disconnect();void loading.destroy().catch(()=>{});}
  });
  loadingObserver.observe(document.body,{childList:true,subtree:true});
  try{pdf=await loading.promise;}
  catch(error){if(cancelled)return;await loading.destroy().catch(()=>{});throw error;}
  finally{loadingObserver.disconnect();}
  if(cancelled)return;
  if(!target.isConnected||!current()) {await loading.destroy();return;}
  const controls=document.createElement('div');controls.className='pdf-controls';
  const previous=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
  const zoomOut=document.createElement('button'),zoomIn=document.createElement('button');
  zoomOut.textContent='−';zoomIn.textContent='+';zoomOut.setAttribute('aria-label','缩小');zoomIn.setAttribute('aria-label','放大');
  zoomOut.className=zoomIn.className='button secondary';
  previous.textContent='上一页';next.textContent='下一页';
  previous.className=next.className='button secondary';
  const canvas=document.createElement('canvas');canvas.className='pdf-page';
  controls.append(previous,label,next,zoomOut,zoomIn);target.replaceChildren(controls,canvas);
  let pageNumber=1,zoom=1;
  let disposed=false,renderTask=null;
  const observer=new MutationObserver(()=>{if(!canvas.isConnected||!current())dispose();});
  function dispose(){if(disposed)return;disposed=true;observer.disconnect();renderTask?.cancel();canvas.width=canvas.height=0;void loading.destroy().catch(()=>{});}
  observer.observe(document.body,{childList:true,subtree:true});
  async function draw() {
    if(disposed||!canvas.isConnected||!current()){dispose();return;}
    previous.disabled=next.disabled=zoomIn.disabled=zoomOut.disabled=true;
    try {
      const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1});
      if(disposed||!canvas.isConnected||!current()){dispose();return;}
      const width=Math.max(250,Math.min(target.clientWidth-32,1000))*zoom;
      const scale=Math.min(Math.min(window.devicePixelRatio||1,2)*width/base.width,
        Math.sqrt(2*1024*1024/(base.width*base.height)));
      const viewport=page.getViewport({scale});
      canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.width=width+'px';canvas.style.height=(width*base.height/base.width)+'px';
      label.textContent=`${pageNumber} / ${pdf.numPages}`;
      renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});
      await renderTask.promise;
      canvas.dataset.rendered=String(pageNumber);
    } catch(error){if(!disposed)throw error;}
    finally {renderTask=null;previous.disabled=pageNumber===1;next.disabled=pageNumber===pdf.numPages;zoomIn.disabled=zoom>=2.5;zoomOut.disabled=zoom<=0.5;}
  }
  previous.onclick=()=>{pageNumber--;draw().catch(e=>{label.textContent=e.message})};
  next.onclick=()=>{pageNumber++;draw().catch(e=>{label.textContent=e.message})};
  zoomIn.onclick=()=>{zoom+=0.25;draw().catch(e=>{label.textContent=e.message})};
  zoomOut.onclick=()=>{zoom-=0.25;draw().catch(e=>{label.textContent=e.message})};
  try{await draw();}catch(error){dispose();throw error;}
  if(!canvas.isConnected)dispose();
}

