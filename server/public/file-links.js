// A local output link is resolved against its conversation/file project, never the Gateway URL.
export function localFilePath(href) {
  if (!href || href.startsWith('#')) return null;
  let value=href;
  try { value=decodeURIComponent(value); } catch { }
  value=value.replace(/:\d+(?::\d+)?$/,'');
  if (/^file:\/\//i.test(value)) value=value.replace(/^file:\/\//i,'');
  else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  value=value.replace(/\\/g,'/').replace(/^\/([a-z]:\/)/i,'$1');
  if(value.startsWith('//')) return null;
  return value.replace(/#.*$/,'').replace(/:\d+(?::\d+)?$/,'').split('?')[0];
}
export function resolveFileLink(href,projects,projectId,basePath='') {
  const file=localFilePath(href);
  if(file===null) return null;
  const normalized=value=>value.replace(/\\/g,'/').replace(/\/+$/,'');
  const absolute=/^(?:[a-z]:\/|\/)/i.test(file);
  if(absolute) {
    const project=[...projects].sort((a,b)=>b.path.length-a.path.length).find(p=>{
      const root=normalized(p.path);return file.toLowerCase().startsWith(root.toLowerCase()+'/');
    });
    if(!project) throw new Error('这个文件不在已授权的项目中，请先在设置中添加对应项目。');
    return {projectId:project.id,path:file.slice(normalized(project.path).length+1)};
  }
  if(!projectId) throw new Error('无法确定文件所属项目，请先选择会话项目。');
  return {projectId,path:(basePath?normalized(basePath)+'/':'')+file};
}

export async function renderPdf(target,url) {
  const pdfjs=await import('./pdf.js');
  pdfjs.GlobalWorkerOptions.workerSrc='/console/assets/pdf.worker.js';
  const loading=pdfjs.getDocument({url,isEvalSupported:false});
  const pdf=await loading.promise;
  if(!target.isConnected) {await loading.destroy();return;}
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
  async function draw() {
    previous.disabled=next.disabled=zoomIn.disabled=zoomOut.disabled=true;
    try {
      const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1});
      const width=Math.max(250,Math.min(target.clientWidth-32,1000))*zoom;
      const scale=Math.min(window.devicePixelRatio||1,2)*width/base.width;
      const viewport=page.getViewport({scale});
      canvas.width=viewport.width;canvas.height=viewport.height;canvas.style.width=width+'px';
      label.textContent=`${pageNumber} / ${pdf.numPages}`;
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      canvas.dataset.rendered=String(pageNumber);
    } finally {previous.disabled=pageNumber===1;next.disabled=pageNumber===pdf.numPages;zoomIn.disabled=zoom>=2.5;zoomOut.disabled=zoom<=0.5;}
  }
  previous.onclick=()=>{pageNumber--;draw().catch(e=>{label.textContent=e.message})};
  next.onclick=()=>{pageNumber++;draw().catch(e=>{label.textContent=e.message})};
  zoomIn.onclick=()=>{zoom+=0.25;draw().catch(e=>{label.textContent=e.message})};
  zoomOut.onclick=()=>{zoom-=0.25;draw().catch(e=>{label.textContent=e.message})};
  await draw();
  const observer=new MutationObserver(()=>{if(!canvas.isConnected){observer.disconnect();void loading.destroy()}});
  observer.observe(document.body,{childList:true,subtree:true});
}

