import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { ServerConfig } from "../types.js";
import { resolveRawFile } from "./workspaceFiles.js";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Readable } from "node:stream";

type Preview = { origin: string; expiresAt: number };
const previews = new Map<string, Preview>();
const previewSockets = new WebSocketServer({ noServer: true });
const filePreviews = new Map<
  string,
  { projectId: string; expiresAt: number }
>();

function localTarget(input: string): URL {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("只允许预览电脑本机的 HTTP 或 HTTPS 服务");
  }
  return url;
}

export function registerPreviewProxy(
  app: FastifyInstance,
  config: ServerConfig,
): void {
  app.post("/api/preview/file", async (request) => {
    const body = request.body as { projectId: string; path: string };
    if (!body?.projectId || !body.path) throw new Error("请选择要预览的文件");
    await resolveRawFile(config, body.projectId, body.path);
    for (const [id, item] of filePreviews)
      if (item.expiresAt < Date.now()) filePreviews.delete(id);
    const id = randomUUID();
    filePreviews.set(id, {
      projectId: body.projectId,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    return {
      url: `/preview/file/${id}/${body.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`,
    };
  });
  app.get("/preview/file/:id/*", async (request, reply) => {
    const params = request.params as { id: string; "*": string };
    const grant = filePreviews.get(params.id);
    if (!grant || grant.expiresAt < Date.now())
      return reply.code(410).send("预览已过期，请重新打开。");
    const file = await resolveRawFile(config, grant.projectId, params["*"]);
    const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
    const type =
      (
        {
          html: "text/html",
          htm: "text/html",
          svg: "image/svg+xml",
          css: "text/css",
          js: "text/javascript",
          mjs: "text/javascript",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
          json: "application/json",
          pdf: "application/pdf",
        } as Record<string, string>
      )[ext] ?? "application/octet-stream";
    reply
      .type(
        /html|css|javascript|json|svg/.test(type)
          ? `${type}; charset=utf-8`
          : type,
      )
      .header("Cache-Control", "no-store")
      .header("Access-Control-Allow-Origin", "*");
    const bytes = await fs.readFile(file.absolutePath);
    if((request.query as {download?:string}).download==='1') {
      reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
      return reply.send(bytes);
    }
    return reply.send(
      /html|css|javascript/.test(type)
        ? rewriteContent(
            bytes.toString("utf8"),
            type,
            new URL(`http://workspace/${params["*"]}`),
            `/preview/file/${params.id}`,
          )
        : bytes,
    );
  });
  app.post("/api/preview", async (request) => {
    const input = (request.body as { url?: string })?.url;
    if (!input) throw new Error("请输入预览地址");
    const target = localTarget(input);
    for (const [id, preview] of previews)
      if (preview.expiresAt < Date.now()) previews.delete(id);
    const id = randomUUID();
    previews.set(id, {
      origin: target.origin,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    return {
      url: `/preview/site/${id}${target.pathname}${target.search}${target.hash}`,
    };
  });

  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/preview/site/:id/*",
    handler: async (request, reply) => {
      const params = request.params as { id: string; "*": string };
      const preview = previews.get(params.id);
      if (!preview || preview.expiresAt < Date.now())
        return reply.code(410).send("预览已过期，请重新打开。");
      reply
        .header("Access-Control-Allow-Origin", "*")
        .header(
          "Access-Control-Allow-Methods",
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        )
        .header(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Accept",
        );
      if (request.method === "OPTIONS") return reply.code(204).send();
      const query = request.url.includes("?")
        ? request.url.slice(request.url.indexOf("?"))
        : "";
      let target = localTarget(`${preview.origin}/${params["*"]}${query}`);
      let response: Response | undefined;
      const headers: Record<string, string> = {};
      for (const name of ["accept", "content-type", "authorization"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      let method = request.method;
      let body =
        request.body == null
          ? undefined
          : Buffer.isBuffer(request.body)
            ? new Uint8Array(request.body).buffer
            : typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body);
      for (let redirect = 0; redirect < 5; redirect++) {
        response = await fetch(target, {
          method,
          headers,
          body: ["GET", "HEAD"].includes(method) ? undefined : body,
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          target = localTarget(new URL(location, target).href);
          if (target.origin !== preview.origin)
            throw new Error("预览重定向不能切换服务地址");
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) &&
              method === "POST")
          ) {
            method = "GET";
            body = undefined;
          }
        } else break;
      }
      if (!response) throw new Error("预览服务无响应");
      const type =
        response.headers.get("content-type") ?? "application/octet-stream";
      reply
        .code(response.status)
        .type(type)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*");
      if (type.includes("text/event-stream") && response.body) {
        return reply.send(
          Readable.fromWeb(
            response.body as import("node:stream/web").ReadableStream,
          ),
        );
      }
      if (!/html|css|javascript/.test(type))
        return reply.send(Buffer.from(await response.arrayBuffer()));
      return reply.send(
        rewriteContent(
          await response.text(),
          type,
          target,
          `/preview/site/${params.id}`,
          true,
        ),
      );
    },
  });
}

function rewriteContent(
  content: string,
  type: string,
  target: URL,
  prefix: string,
  runtime = false,
): string {
  const rewrite = (value: string) => {
    if (
      !value ||
      /^(#|data:|blob:|javascript:|mailto:)/i.test(value) ||
      value.startsWith(prefix)
    )
      return value;
    const url = new URL(value, target);
    return url.origin === target.origin
      ? `${prefix}${url.pathname}${url.search}${url.hash}`
      : value;
  };
  if (type.includes("html")) {
    content = content.replace(
      /\b(src|href|action)\s*=\s*(["'])(.*?)\2/gi,
      (_all, attr, quote, value) => `${attr}=${quote}${rewrite(value)}${quote}`,
    );
  }
  if (/css|html/.test(type))
    content = content.replace(
      /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,
      (_all, quote, value) => `url(${quote}${rewrite(value)}${quote})`,
    );
  if (type.includes("javascript")) {
    content = content.replace(
      /((?:from\s*|import\s*\(?\s*)["'])(\.?\.?\/[^"']+)(["'])/g,
      (_all, before, value, after) => before + rewrite(value) + after,
    );
    content = content.replace(
      /(\b\w*createHotContext\(\s*)(["'])([^"']+)\2/g,
      (_all, before, quote, value) => before + quote + rewrite(value) + quote,
    );
  }
  if (runtime && type.includes("html")) {
    const escape = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
    const bootstrap = `<script src="/console/assets/preview-runtime.js" data-preview-prefix="${escape(prefix)}" data-preview-upstream="${escape(target.href)}"></script>`;
    content = /<head\b[^>]*>/i.test(content)
      ? content.replace(/<head\b[^>]*>/i, (head) => head + bootstrap)
      : bootstrap + content;
  }
  return content;
}

export function handlePreviewUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const url = new URL(request.url ?? "/", "http://gateway");
  const match = url.pathname.match(/^\/preview\/socket\/([^/]+)(\/.*)?$/);
  if (!match) return false;
  const preview = previews.get(match[1]);
  if (!preview || preview.expiresAt < Date.now()) {
    socket.end("HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n");
    return true;
  }
  const target = new URL((match[2] || "/") + url.search, preview.origin);
  if (target.origin !== preview.origin) {
    socket.destroy();
    return true;
  }
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const protocols = request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const upstream = new WebSocket(target, protocols, {
    handshakeTimeout: 10000,
    headers: { Origin: preview.origin },
  });
  let downstream: WebSocket | undefined;
  const expiry = setTimeout(() => {
    upstream.close();
    downstream?.close(1008, "preview expired");
  }, preview.expiresAt - Date.now());
  const dispose = () => {
    clearTimeout(expiry);
    upstream.close();
    downstream?.close();
  };
  socket.on("close", dispose);
  upstream.on("error", () => {
    if (!downstream)
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    dispose();
  });
  upstream.on("open", () => {
    if (socket.destroyed) {
      dispose();
      return;
    }
    previewSockets.handleUpgrade(request, socket, head, (client) => {
      downstream = client;
      client.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.send(data, { binary });
      });
      client.on("error", dispose);
      client.on("close", dispose);
    });
  });
  upstream.on("message", (data, binary) => {
    if (downstream?.readyState !== WebSocket.OPEN) return;
    let message = data.toString();
    if (!binary) {
      try {
        const payload = JSON.parse(message);
        const prefix = `/preview/site/${match[1]}`;
        const map = (value: unknown) =>
          typeof value === "string" &&
          value.startsWith("/") &&
          !value.startsWith(prefix)
            ? prefix + value
            : value;
        if (payload.type === "update")
          for (const update of payload.updates ?? []) {
            update.path = map(update.path);
            update.acceptedPath = map(update.acceptedPath);
          }
        if (payload.type === "prune") payload.paths = payload.paths.map(map);
        if (payload.type === "full-reload") payload.path = map(payload.path);
        message = JSON.stringify(payload);
      } catch {
        /* Non-HMR messages are passed through unchanged. */
      }
    }
    downstream.send(binary ? data : message, { binary });
  });
  upstream.on("close", dispose);
  return true;
}
