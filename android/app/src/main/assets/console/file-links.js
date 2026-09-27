export function localFilePath(href) {
  if (!href || href.startsWith("#")) return null;
  let value = href;
  try {
    value = decodeURIComponent(value);
  } catch {
  }
  value = value.replace(/:\d+(?::\d+)?$/, "");
  if (/^file:\/\//i.test(value)) value = value.replace(/^file:\/\//i, "");
  else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  value = value.replace(/\\/g, "/").replace(/^\/([a-z]:\/)/i, "$1");
  if (value.startsWith("//")) return null;
  return value.replace(/#.*$/, "").replace(/:\d+(?::\d+)?$/, "").split("?")[0];
}
export function resolveFileLink(href, projects, projectId, basePath = "") {
  const file = localFilePath(href);
  if (file === null) return null;
  const normalized = (value) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = /^(?:[a-z]:\/|\/)/i.test(file);
  if (absolute) {
    const project = [...projects].sort((a, b) => b.path.length - a.path.length).find((p) => {
      const root = normalized(p.path);
      return file.toLowerCase().startsWith(root.toLowerCase() + "/");
    });
    if (!project) throw new Error("\u8FD9\u4E2A\u6587\u4EF6\u4E0D\u5728\u5DF2\u6388\u6743\u7684\u9879\u76EE\u4E2D\uFF0C\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u5BF9\u5E94\u9879\u76EE\u3002");
    return { projectId: project.id, path: file.slice(normalized(project.path).length + 1) };
  }
  if (!projectId) throw new Error("\u65E0\u6CD5\u786E\u5B9A\u6587\u4EF6\u6240\u5C5E\u9879\u76EE\uFF0C\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u9879\u76EE\u3002");
  return { projectId, path: (basePath ? normalized(basePath) + "/" : "") + file };
}
export async function renderPdf(target, url) {
  const pdfjs = await import("./pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = "/console/assets/pdf.worker.js";
  const loading = pdfjs.getDocument({ url, isEvalSupported: false });
  const pdf = await loading.promise;
  if (!target.isConnected) {
    await loading.destroy();
    return;
  }
  const controls = document.createElement("div");
  controls.className = "pdf-controls";
  const previous = document.createElement("button"), next = document.createElement("button"), label = document.createElement("span");
  const zoomOut = document.createElement("button"), zoomIn = document.createElement("button");
  zoomOut.textContent = "\u2212";
  zoomIn.textContent = "+";
  zoomOut.setAttribute("aria-label", "\u7F29\u5C0F");
  zoomIn.setAttribute("aria-label", "\u653E\u5927");
  zoomOut.className = zoomIn.className = "button secondary";
  previous.textContent = "\u4E0A\u4E00\u9875";
  next.textContent = "\u4E0B\u4E00\u9875";
  previous.className = next.className = "button secondary";
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page";
  controls.append(previous, label, next, zoomOut, zoomIn);
  target.replaceChildren(controls, canvas);
  let pageNumber = 1, zoom = 1;
  async function draw() {
    previous.disabled = next.disabled = zoomIn.disabled = zoomOut.disabled = true;
    try {
      const page = await pdf.getPage(pageNumber), base = page.getViewport({ scale: 1 });
      const width = Math.max(250, Math.min(target.clientWidth - 32, 1e3)) * zoom;
      const scale = Math.min(window.devicePixelRatio || 1, 2) * width / base.width;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = width + "px";
      label.textContent = `${pageNumber} / ${pdf.numPages}`;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      canvas.dataset.rendered = String(pageNumber);
    } finally {
      previous.disabled = pageNumber === 1;
      next.disabled = pageNumber === pdf.numPages;
      zoomIn.disabled = zoom >= 2.5;
      zoomOut.disabled = zoom <= 0.5;
    }
  }
  previous.onclick = () => {
    pageNumber--;
    draw().catch((e) => {
      label.textContent = e.message;
    });
  };
  next.onclick = () => {
    pageNumber++;
    draw().catch((e) => {
      label.textContent = e.message;
    });
  };
  zoomIn.onclick = () => {
    zoom += 0.25;
    draw().catch((e) => {
      label.textContent = e.message;
    });
  };
  zoomOut.onclick = () => {
    zoom -= 0.25;
    draw().catch((e) => {
      label.textContent = e.message;
    });
  };
  await draw();
  const observer = new MutationObserver(() => {
    if (!canvas.isConnected) {
      observer.disconnect();
      void loading.destroy();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
