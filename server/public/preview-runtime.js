(() => {
  const script = document.currentScript;
  const prefix = script.dataset.previewPrefix;
  const upstream = new URL(script.dataset.previewUpstream);
  const gateway = new URL(script.src).origin;
  const socketPrefix = prefix.replace("/site/", "/socket/");

  function map(value, socket = false) {
    const currentPath = location.pathname.slice(prefix.length) || "/";
    const url = new URL(String(value), upstream.origin + currentPath);
    const httpOrigin = url.origin.replace(/^ws/, "http");
    if (httpOrigin !== upstream.origin && httpOrigin !== gateway)
      return url.href;
    if (url.pathname.startsWith(socketPrefix)) return url.href;
    const pathname = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length)
      : url.pathname;
    const mapped = new URL(
      (socket ? socketPrefix : prefix) + pathname + url.search + url.hash,
      gateway,
    );
    if (socket) mapped.protocol = mapped.protocol === "https:" ? "wss:" : "ws:";
    return mapped.href;
  }

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) =>
    fetchOriginal(
      input instanceof Request
        ? new Request(map(input.url), input)
        : map(input),
      init,
    );
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    return xhrOpen.call(this, method, map(url), ...args);
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(map(url, true), protocols);
    }
  };
  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) {
        super(map(url), options);
      }
    };
  }
})();
