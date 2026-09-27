import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";

const root = path.resolve(import.meta.dirname, "..");
const appHome = await fs.mkdtemp(path.join(os.tmpdir(), "cmc-home-"));
const serverConfigPath = path.join(appHome, "server.json");
const stateSqlitePath = path.join(appHome, "state.sqlite");
const smokePort = await freePort();
const baseUrl = `http://127.0.0.1:${smokePort}`;
await fs.writeFile(
  serverConfigPath,
  `${JSON.stringify({ host: "127.0.0.1", port: smokePort, token: "smoke-admin-token", projectRoots: [], https: { enabled: false } }, null, 2)}\n`,
  "utf8",
);

const tsxBin = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
let stdout = "";
let stderr = "";
const mockCodex = await setupMockCodex();
let child = startServer();

try {
  await waitForHealth();
  const config = JSON.parse(await fs.readFile(serverConfigPath, "utf8"));
  let adminToken = config.token;
  const admin = { Authorization: `Bearer ${adminToken}` };
  let replayProbe = "";

  await check("health", async () => {
    const health = await json("/health");
    assert(health.ok === true, "health ok should be true");
    assert(health.protocolVersion >= 1, "protocolVersion missing");
    assert(health.minAndroidProtocolVersion >= 1, "minAndroidProtocolVersion missing");
    assert(Array.isArray(health.capabilities) && health.capabilities.includes("terminal-commands"), "capabilities missing");
    assert(health.capabilities.includes("terminal-pty"), "terminal pty capability missing");
    assert(health.capabilities.includes("terminal-session-resize"), "terminal resize capability missing");
    assert(health.capabilities.includes("websocket-heartbeat"), "websocket heartbeat capability missing");
  });

  await check("console", async () => {
    const response = await fetch(`${baseUrl}/console`);
    const html = await response.text();
    assert(response.ok, "console should load");
    assert(html.includes("Codex 控制台"), "console title missing");
  });

  await check("android apk opens from a phone browser", async () => {
    const response=await fetch(`${baseUrl}/downloads/android.apk`);
    assert(response.ok,'APK download route should be public on the local network');
    assert(response.headers.get('content-type')?.includes('application/vnd.android.package-archive'),'APK MIME type missing');
    assert(response.headers.get('content-disposition')?.includes('attachment'),'APK should download');
    const bytes=new Uint8Array(await response.arrayBuffer());
    assert(bytes.length>1000000&&bytes[0]===0x50&&bytes[1]===0x4b,'APK bytes missing or invalid');
  });

  await check("pairing and revoke", async () => {
    const pairing = await json("/api/pair/start", { headers: admin });
    assert(pairing.code, "pairing code missing");
    assert(pairing.setupUrl?.startsWith("codex-control://pair"), "setupUrl invalid");
    assert(pairing.qrSvg?.startsWith("<svg"), "qrSvg missing");

    const claim = await json("/api/pair/claim", {
      method: "POST",
      body: JSON.stringify({ code: pairing.code, name: "Smoke Test" }),
      headers: { "Content-Type": "application/json" },
    });
    assert(claim.token, "device token missing");
    assert(claim.device?.id, "device id missing");

    const deviceHeaders = { Authorization: `Bearer ${claim.token}` };
    await json("/api/projects", { headers: deviceHeaders });

    await json(`/api/devices/${claim.device.id}`, { method: "DELETE", headers: admin });
    const revoked = await fetch(`${baseUrl}/api/projects`, { headers: deviceHeaders });
    assert(revoked.status === 401, "revoked device token should be unauthorized");
  });

  await check("token rotation", async () => {
    const pairing = await json("/api/pair/start", { headers: admin });
    const claim = await json("/api/pair/claim", {
      method: "POST",
      body: JSON.stringify({ code: pairing.code, name: "Rotate Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const oldDeviceToken = claim.token;
    const rotatedDevice = await json("/api/auth/token/rotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${oldDeviceToken}` },
    });
    assert(rotatedDevice.kind === "device", "device token rotation kind mismatch");
    assert(rotatedDevice.token && rotatedDevice.token !== oldDeviceToken, "device token should change");
    const oldDeviceResponse = await fetch(`${baseUrl}/api/projects`, { headers: { Authorization: `Bearer ${oldDeviceToken}` } });
    assert(oldDeviceResponse.status === 401, "old device token should be unauthorized after rotation");
    await json("/api/projects", { headers: { Authorization: `Bearer ${rotatedDevice.token}` } });
    await json(`/api/devices/${claim.device.id}`, { method: "DELETE", headers: admin });

    const oldAdminToken = adminToken;
    const rotatedAdmin = await json("/api/auth/token/rotate", {
      method: "POST",
      headers: admin,
    });
    assert(rotatedAdmin.kind === "admin", "admin token rotation kind mismatch");
    assert(rotatedAdmin.token && rotatedAdmin.token !== oldAdminToken, "admin token should change");
    const oldAdminResponse = await fetch(`${baseUrl}/api/projects`, { headers: { Authorization: `Bearer ${oldAdminToken}` } });
    assert(oldAdminResponse.status === 401, "old admin token should be unauthorized after rotation");
    adminToken = rotatedAdmin.token;
    admin.Authorization = `Bearer ${adminToken}`;
    await json("/api/projects", { headers: admin });
  });

  let project;
  let gitProject;
  await check("project roots management", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cmc-root-"));
    try {
      const added = await json("/api/config/project-roots", {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir }),
      });
      assert(added.root?.path === dir, "added project root path mismatch");
      await socket.next((event) => event.type === "projects.changed");
      assert(added.roots.some((item) => item.path === dir && item.exists === true), "added project root missing");
      const listed = await json("/api/projects", { headers: admin });
      assert(listed.projects.some((item) => item.path === dir), "project root should appear as project");
      const removed = await json(`/api/config/project-roots?path=${encodeURIComponent(dir)}`, {
        method: "DELETE",
        headers: admin,
      });
      assert(removed.root?.path === dir, "removed project root path mismatch");
      await socket.next((event) => event.type === "projects.changed");
      const listedAfterRemove = await json("/api/projects", { headers: admin });
      assert(!listedAfterRemove.projects.some((item) => item.path === dir), "removed project root should not appear as project");
    } finally {
      socket.close();
    }
  });

  await check("https self-signed config", async () => {
    const saved = await json("/api/config/https", {
      method: "PUT",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, generateSelfSigned: true }),
    });
    assert(saved.https?.certExists === true, "self-signed cert should exist");
    assert(saved.https?.keyExists === true, "self-signed key should exist");
    assert(saved.https?.restartRequired === true, "https config should require restart");
    const current = await json("/api/config/https", { headers: admin });
    assert(current.https?.enabled === false, "smoke should leave https disabled");
    assert(current.https?.certExists === true, "https cert should remain available");
  });

  await check("project add/list", async () => {
    const added = await json("/api/projects", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ path: path.resolve(root, "..") }),
    });
    project = added.project;
    assert(project?.id, "project id missing");
    const listed = await json("/api/projects", { headers: admin });
    assert(listed.projects.some((item) => item.id === project.id), "project not listed");
  });

  await check("git project setup", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cmc-git-"));
    await fs.writeFile(path.join(dir, "README.md"), "# Smoke Git Project\n", "utf8");
    await run("git", ["init"], dir);
    await run("git", ["config", "user.email", "smoke@example.test"], dir);
    await run("git", ["config", "user.name", "Smoke Test"], dir);
    await run("git", ["add", "README.md"], dir);
    await run("git", ["commit", "-m", "initial"], dir);
    const added = await json("/api/projects", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ path: dir }),
    });
    gitProject = added.project;
    assert(gitProject?.id, "git project id missing");
  });

  await check("files and raw", async () => {
    const files = await json(`/api/projects/${project.id}/files`, { headers: admin });
    assert(files.files.some((item) => item.name === "README.md"), "README.md not in root file list");
    const readme = await json(`/api/projects/${project.id}/file?path=README.md`, { headers: admin });
    assert(readme.content.includes("Codex Mobile Control"), "README content unexpected");
    const raw = await fetch(`${baseUrl}/raw/projects/${project.id}/file?path=README.md&token=${encodeURIComponent(adminToken)}`);
    assert(raw.ok, "raw README should load");
  });

  await check("codex raw settings read/write", async () => {
    const original = await json("/api/settings/user/raw", { headers: admin });
    assert(typeof original.config?.path === "string", "raw settings path missing");
    assert(typeof original.config?.content === "string", "raw settings content missing");
    const marker = `cmc-smoke-${Date.now()}`;
    const nextContent = `${original.config.content.trimEnd()}\n\n# ${marker}\n`;
    try {
      const saved = await json("/api/settings/user/raw", {
        method: "PUT",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent }),
      });
      assert(saved.config.content.includes(marker), "raw settings marker missing after save");
      const structured = await json("/api/settings/user", {
        method: "PUT",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "cmc-smoke-model",
          modelProvider: "custom",
          providerBaseUrl: "http://127.0.0.1:15721/v1",
          disableResponseStorage: true,
        }),
      });
      assert(structured.settings?.model === "cmc-smoke-model", "structured model setting should be saved");
      assert(structured.settings?.modelProvider === "custom", "structured model provider should be saved");
      assert(structured.settings?.providerBaseUrl === "http://127.0.0.1:15721/v1", "structured provider base URL should be saved");
      assert(structured.settings?.disableResponseStorage === true, "structured disable_response_storage should be saved");
      const cleared = await json("/api/settings/user", {
        method: "PUT",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "", modelProvider: "", providerBaseUrl: "", disableResponseStorage: false }),
      });
      assert(!cleared.settings?.model, "blank structured model should clear config model");
      assert(!cleared.settings?.modelProvider, "blank structured model provider should clear config model_provider");
      assert(cleared.settings?.disableResponseStorage === false, "structured disable_response_storage should allow false");
    } finally {
      await json("/api/settings/user/raw", {
        method: "PUT",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ content: original.config.content }),
      });
    }
  });

  await check("approval policy summary", async () => {
    const summary = await json("/api/settings/approval-summary", { headers: admin });
    assert(typeof summary.summary?.approvalLabel === "string", "approval summary label missing");
    assert(typeof summary.summary?.recommendation === "string", "approval summary recommendation missing");
    assert(["low", "medium", "high", "unknown"].includes(summary.summary?.approvalRisk), "approval summary risk missing");
  });

  await check("diff", async () => {
    const diff = await json(`/api/projects/${gitProject.id}/diff`, { headers: admin });
    assert(typeof diff.stat === "string", "diff stat missing");
    assert(typeof diff.diff === "string", "diff missing");
  });

  await check("diff files", async () => {
    const probePath = path.join(gitProject.path, "README.md");
    const original = await fs.readFile(probePath, "utf8");
    try {
      await fs.writeFile(probePath, `${original}\n<!-- smoke-diff-${Date.now()} -->\n`, "utf8");
      const files = await json(`/api/projects/${gitProject.id}/diff/files`, { headers: admin });
      assert(files.files.some((item) => item.path === "README.md"), "README.md diff file missing");
      const fileDiff = await json(`/api/projects/${gitProject.id}/diff/file?path=README.md`, { headers: admin });
      assert(fileDiff.diff.includes("smoke-diff"), "single file diff missing probe");
    } finally {
      await fs.writeFile(probePath, original, "utf8");
    }
  });

  await check("diff file accept and revert", async () => {
    const probePath = path.join(gitProject.path, "README.md");
    const original = await fs.readFile(probePath, "utf8");
    try {
      await fs.writeFile(probePath, `${original}\naccepted-smoke-${Date.now()}\n`, "utf8");
      await json(`/api/projects/${gitProject.id}/diff/file/accept?path=README.md`, {
        method: "POST",
        headers: admin,
      });
      const acceptedFiles = await json(`/api/projects/${gitProject.id}/diff/files`, { headers: admin });
      assert(
        acceptedFiles.files.some((item) => item.path === "README.md" && item.status === "accepted"),
        "accepted README diff file missing",
      );
      await json(`/api/projects/${gitProject.id}/diff/file/revert?path=README.md`, {
        method: "POST",
        headers: admin,
      });
      const clean = await run("git", ["diff", "--", "README.md"], gitProject.path);
      assert(clean.trim() === "", "README worktree diff should be clean after revert");
      const stagedClean = await run("git", ["diff", "--cached", "--", "README.md"], gitProject.path);
      assert(stagedClean.trim() === "", "README staged diff should be clean after revert");
    } finally {
      await run("git", ["restore", "--staged", "--", "README.md"], gitProject.path).catch(() => "");
      await fs.writeFile(probePath, original, "utf8");
    }
  });

  await check("diff files batch accept and revert", async () => {
    const readmePath = path.join(gitProject.path, "README.md");
    const secondPath = path.join(gitProject.path, "SECOND.md");
    const originalReadme = await fs.readFile(readmePath, "utf8");
    try {
      await fs.writeFile(secondPath, "# Second\n", "utf8");
      await run("git", ["add", "SECOND.md"], gitProject.path);
      await run("git", ["commit", "-m", "add second"], gitProject.path);
      const originalSecond = await fs.readFile(secondPath, "utf8");

      await fs.writeFile(readmePath, `${originalReadme}\nbatch-readme-${Date.now()}\n`, "utf8");
      await fs.writeFile(secondPath, `${originalSecond}\nbatch-second-${Date.now()}\n`, "utf8");
      await json(`/api/projects/${gitProject.id}/diff/files/accept`, {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["README.md", "SECOND.md"] }),
      });
      const acceptedFiles = await json(`/api/projects/${gitProject.id}/diff/files`, { headers: admin });
      assert(
        ["README.md", "SECOND.md"].every((filePath) =>
          acceptedFiles.files.some((item) => item.path === filePath && item.status === "accepted"),
        ),
        "batch accepted files missing",
      );
      await json(`/api/projects/${gitProject.id}/diff/files/revert`, {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ paths: ["README.md", "SECOND.md"] }),
      });
      const worktreeClean = await run("git", ["diff", "--", "README.md", "SECOND.md"], gitProject.path);
      const stagedClean = await run("git", ["diff", "--cached", "--", "README.md", "SECOND.md"], gitProject.path);
      assert(worktreeClean.trim() === "", "batch worktree diff should be clean");
      assert(stagedClean.trim() === "", "batch staged diff should be clean");
    } finally {
      await run("git", ["restore", "--staged", "--worktree", "--", "README.md", "SECOND.md"], gitProject.path).catch(() => "");
      await fs.writeFile(readmePath, originalReadme, "utf8");
    }
  });

  await check("diff hunk accept and revert", async () => {
    const hunkPath = path.join(gitProject.path, "HUNKS.md");
    const original = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`).join("\n") + "\n";
    try {
      await fs.writeFile(hunkPath, original, "utf8");
      await run("git", ["add", "HUNKS.md"], gitProject.path);
      await run("git", ["commit", "-m", "add hunk fixture"], gitProject.path);

      const changed = original
        .replace("line-2", `line-2-accepted-${Date.now()}`)
        .replace("line-18", `line-18-reverted-${Date.now()}`);
      await fs.writeFile(hunkPath, changed, "utf8");

      const initialHunks = await json(`/api/projects/${gitProject.id}/diff/file/hunks?path=HUNKS.md`, { headers: admin });
      assert(initialHunks.hunks.filter((item) => item.source === "worktree").length >= 2, "expected at least two worktree hunks");

      await json(`/api/projects/${gitProject.id}/diff/file/hunk/accept?path=HUNKS.md`, {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "worktree", index: 0 }),
      });
      const stagedAfterAccept = await run("git", ["diff", "--cached", "--", "HUNKS.md"], gitProject.path);
      const worktreeAfterAccept = await run("git", ["diff", "--", "HUNKS.md"], gitProject.path);
      assert(stagedAfterAccept.includes("line-2-accepted"), "accepted hunk should be staged");
      assert(!stagedAfterAccept.includes("line-18-reverted"), "second hunk should not be staged");
      assert(worktreeAfterAccept.includes("line-18-reverted"), "remaining hunk should stay in worktree");

      await json(`/api/projects/${gitProject.id}/diff/file/hunk/revert?path=HUNKS.md`, {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "worktree", index: 0 }),
      });
      const worktreeAfterRevert = await run("git", ["diff", "--", "HUNKS.md"], gitProject.path);
      assert(worktreeAfterRevert.trim() === "", "worktree hunk should be reverted");

      const stagedHunks = await json(`/api/projects/${gitProject.id}/diff/file/hunks?path=HUNKS.md`, { headers: admin });
      assert(stagedHunks.hunks.some((item) => item.source === "staged"), "staged hunk should be listed");
      await json(`/api/projects/${gitProject.id}/diff/file/hunk/revert?path=HUNKS.md`, {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "staged", index: 0 }),
      });
      const stagedClean = await run("git", ["diff", "--cached", "--", "HUNKS.md"], gitProject.path);
      assert(stagedClean.trim() === "", "staged hunk should be reverted");
    } finally {
      await run("git", ["restore", "--staged", "--worktree", "--", "HUNKS.md"], gitProject.path).catch(() => "");
    }
  });

  await check("threads and approvals endpoints", async () => {
    const threads = await json("/api/threads", { headers: admin });
    assert(Array.isArray(threads.threads), "threads should be array");
    const approvals = await json("/api/approvals", { headers: admin });
    assert(Array.isArray(approvals.approvals), "approvals should be array");
  });

  await check("thread rename and delete endpoints", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const beforeThreads = await json("/api/threads", { headers: admin });
    const knownThreadIds = new Set(beforeThreads.threads.map((item) => item.id));
    socket.send({ type: "thread.start", projectPath: project.path, initialText: "准备重命名会话" });
    const started = await socket.next(
      (event) => event.type === "thread.started" && event.threadId.startsWith("mock-thread-") && !knownThreadIds.has(event.threadId),
    );
    assert(started.thread?.projectPath === project.path, "thread.started should include project path metadata");
    assert(started.thread?.id === started.threadId, "thread.started should include the started thread record");
    await socket.next((event) => event.type === "user.message" && event.threadId === started.threadId);
    const update = await json(`/api/threads/${started.threadId}`, {
      method: "PATCH",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "手机端重命名会话" }),
    });
    assert(update.thread?.title === "手机端重命名会话", "thread title should be renamed");
    const pinned=await json(`/api/threads/${started.threadId}/pin`,{method:'POST',headers:{...admin,'Content-Type':'application/json'},body:JSON.stringify({pinned:true})});
    assert(pinned.pinned===true,'pin should be forwarded to Codex');
    const goal=await json(`/api/threads/${started.threadId}/goal`,{method:'PATCH',headers:{...admin,'Content-Type':'application/json'},body:JSON.stringify({objective:'检查手机界面',status:'paused'})});
    assert(goal.goal?.objective==='检查手机界面'&&goal.goal?.status==='paused','goal controls should be forwarded to Codex');
    const listed = await json("/api/threads", { headers: admin });
    assert(listed.threads.some((item) => item.id === started.threadId && item.title === "手机端重命名会话"), "renamed thread should be listed");
    await json(`/api/threads/${started.threadId}`, {
      method: "DELETE",
      headers: admin,
    });
    const afterDelete = await json("/api/threads", { headers: admin });
    assert(!afterDelete.threads.some((item) => item.id === started.threadId), "deleted thread should be removed from list");
    const events = await json(`/api/threads/${started.threadId}/events`, { headers: admin });
    assert(events.events.length === 0, "deleted thread events should be removed");
    socket.close();
  });

  await check("codex status endpoint", async () => {
    const status = await json("/api/codex/status", { headers: admin });
    assert(typeof status.codex === "object", "codex status missing");
    assert(typeof status.codex.running === "boolean", "codex running status missing");
    assert(typeof status.codex.initialized === "boolean", "codex initialized status missing");
    assert(typeof status.codex.pendingRequests === "number", "pending request count missing");
    assert(status.codex.cliAvailable === Boolean(status.codex.cliVersion), "cli availability mismatch");
    assert(status.codex.cliVersion.includes("mock"), "smoke should use mock codex CLI");
    assert(typeof status.codex.autoRestartEnabled === "boolean", "auto restart status missing");
  });

  await check("codex compatibility endpoint", async () => {
    const response = await json("/api/codex/compatibility", { headers: admin });
    const compatibility = response.compatibility;
    assert(typeof compatibility === "object", "compatibility missing");
    assert(["ok", "warning", "error"].includes(compatibility.status), "compatibility status invalid");
    assert(typeof compatibility.cliAvailable === "boolean", "compatibility cli availability missing");
    assert(typeof compatibility.appServerRunning === "boolean", "compatibility app-server running missing");
    assert(Array.isArray(compatibility.adapter?.notifications), "notification coverage missing");
    assert(compatibility.adapter.notifications.includes("item/agentMessage/delta"), "agent message adapter missing");
    assert(Array.isArray(compatibility.adapter?.serverRequests), "server request coverage missing");
    assert(compatibility.adapter.serverRequests.includes("item/permissions/requestApproval"), "permission approval adapter missing");
    assert(Array.isArray(compatibility.observations?.unknownNotifications), "unknown notifications should be array");
    assert(typeof compatibility.observations?.malformedMessages === "number", "malformed message count missing");
    assert(Array.isArray(compatibility.recommendations), "recommendations missing");
  });

  await check("codex upgrade check endpoint", async () => {
    const response = await json("/api/codex/upgrade-check", { headers: admin });
    const upgrade = response.upgrade;
    assert(upgrade.packageName === "@openai/codex", "upgrade package mismatch");
    assert(upgrade.installedVersion === "0.0.0", `installed version should be parsed from mock CLI, got ${upgrade.installedVersion}`);
    assert(upgrade.latestVersion === "9.9.9", "latest version should use smoke override");
    assert(upgrade.updateAvailable === true, "mock CLI should report an available upgrade");
    assert(upgrade.command.includes("@openai/codex@latest"), "upgrade command missing");
  });

  await check("codex app-server auto restart and thread resume", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const started = await json("/api/codex/start", {
      method: "POST",
      headers: admin,
    });
    assert(started.codex?.running === true, "mock app-server should start");
    assert(started.codex?.initialized === true, "mock app-server should initialize");

    socket.send({ type: "thread.start", projectPath: project.path });
    const thread = await socket.next((event) => event.type === "thread.started" && event.threadId.startsWith("mock-thread-"));
    socket.send({ type: "turn.start", threadId: thread.threadId, text: "CRASH_APP_SERVER" });
    await socket.next((event) => event.type === "codex.status" && event.status === "stopped");
    const recovered = await waitForCodexRunning(admin);
    assert(recovered.initialized === true, "mock app-server should reinitialize after crash");

    socket.send({ type: "turn.start", threadId: thread.threadId, text: "after-crash" });
    const resumed = await socket.next((event) =>
      event.type === "message.delta" &&
      event.threadId === thread.threadId &&
      event.text.includes("mock:after-crash"),
    );
    assert(resumed.text.includes("mock:after-crash"), "thread should resume after app-server restart");
    socket.close();
  });

  await check("user messages are persisted and title the thread", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const beforeThreads = await json("/api/threads", { headers: admin });
    const knownThreadIds = new Set(beforeThreads.threads.map((item) => item.id));
    socket.send({ type: "thread.start", projectPath: project.path });
    const thread = await socket.next(
      (event) => event.type === "thread.started" && event.threadId.startsWith("mock-thread-") && !knownThreadIds.has(event.threadId),
    );
    const prompt = "请检查手机端会话标题";
    socket.send({ type: "turn.start", threadId: thread.threadId, text: prompt });
    const userMessage = await socket.next(
      (event) => event.type === "user.message" && event.threadId === thread.threadId && event.text === prompt,
    );
    assert(userMessage.text === prompt, "user message should be broadcast");
    const assistant = await socket.next(
      (event) => event.type === "message.delta" && event.threadId === thread.threadId && event.text.includes(`mock:${prompt}`),
    );
    assert(assistant.text.includes(`mock:${prompt}`), "assistant response missing after user message");
    const threadList = await json("/api/threads", { headers: admin });
    const updatedThread = threadList.threads.find((item) => item.id === thread.threadId);
    assert(updatedThread?.title === prompt, `thread title should use the first user prompt, got ${JSON.stringify(updatedThread)}`);
    const events = await json(`/api/threads/${thread.threadId}/events`, { headers: admin });
    assert(events.events.some((event) => event.type === "user.message" && event.text === prompt), "user message should be persisted");
    assert(events.events.some((event) => event.type === "message.delta" && event.text.includes(`mock:${prompt}`)), "assistant message should be persisted");
    assert(!events.events.some((event) => event.type === "terminal.output"), "thread events should keep raw terminal streams separate from task tool progress");
    socket.close();
  });

  await check("thread start can include the first user message", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const beforeThreads = await json("/api/threads", { headers: admin });
    const knownThreadIds = new Set(beforeThreads.threads.map((item) => item.id));
    const prompt = "从手机直接发送第一条消息";
    socket.send({ type: "thread.start", projectPath: project.path, initialText: prompt });
    const thread = await socket.next(
      (event) => event.type === "thread.started" && event.threadId.startsWith("mock-thread-") && !knownThreadIds.has(event.threadId),
    );
    const userMessage = await socket.next(
      (event) => event.type === "user.message" && event.threadId === thread.threadId && event.text === prompt,
    );
    assert(userMessage.text === prompt, "initial user message should be broadcast");
    const assistant = await socket.next(
      (event) => event.type === "message.delta" && event.threadId === thread.threadId && event.text.includes(`mock:${prompt}`),
    );
    assert(assistant.text.includes(`mock:${prompt}`), "assistant response missing after initial user message");
    const threadList = await json("/api/threads", { headers: admin });
    const updatedThread = threadList.threads.find((item) => item.id === thread.threadId);
    assert(updatedThread?.title === prompt, "thread title should use initial user message");
    socket.close();
  });

  await check("desktop writer conflict queues once and retries after release", async () => {
    const socket=await openSocket(adminToken);
    await socket.next(event=>event.type==='connected');
    const existing=new Set((await json('/api/threads',{headers:admin})).threads.map(item=>item.id));
    socket.send({type:'thread.start',projectPath:project.path});
    const thread=await socket.next(event=>event.type==='thread.started'&&!event.replayed&&event.threadId.startsWith('mock-thread-')&&!existing.has(event.threadId));
    socket.send({type:'turn.start',threadId:thread.threadId,projectPath:project.path,text:'WRITER_QUEUE',requestId:'writer-queue-smoke'});
    const queued=await socket.next(event=>event.type==='message.queued'&&event.requestId==='writer-queue-smoke').catch(error=>{throw new Error(`queue acknowledgement missing: ${JSON.stringify(socket.snapshot())}: ${error.message}`)});
    assert(queued.threadId===thread.threadId,'queued message should retain its task');
    const pending=await json(`/api/threads/${thread.threadId}/queue`,{headers:admin});
    assert(pending.messages.some(item=>item.id==='writer-queue-smoke'&&item.text==='WRITER_QUEUE'),'message should persist in the queue');
    await socket.next(event=>event.type==='message.delta'&&event.threadId===thread.threadId&&event.text==='mock:WRITER_QUEUE',20000).catch(async error=>{const q=await json(`/api/threads/${thread.threadId}/queue`,{headers:admin});const t=await json(`/api/threads/${thread.threadId}/events`,{headers:admin});throw new Error(`queue did not resume: ${JSON.stringify(q.messages)} status=${t.status} events=${JSON.stringify(t.events.slice(-4))}: ${error.message}`)});
    const history=await json(`/api/threads/${thread.threadId}/events`,{headers:admin});
    assert(history.events.filter(event=>event.type==='user.message'&&event.text==='WRITER_QUEUE').length===1,'retry must not duplicate the user message');
    socket.close();
  });

  await check("local terminal command", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const runResult = await json(`/api/projects/${project.id}/terminal/run`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: `node -e "console.log('smoke-terminal')"` }),
    });
    assert(runResult.threadId?.startsWith("terminal:"), "terminal thread id missing");
    const output = await socket.next(
      (event) => event.type === "terminal.output" &&
        event.threadId === runResult.threadId &&
        event.text.includes("smoke-terminal"),
    );
    assert(output.stream === "stdout", "terminal stdout stream missing");
    const history = await json("/api/terminal/history?limit=20", { headers: admin });
    assert(
      history.events.some((event) => event.type === "terminal.output" && event.threadId === runResult.threadId && event.text.includes("smoke-terminal")),
      "terminal history should include recent command output",
    );
    const commands = await json("/api/terminal/commands?limit=20", { headers: admin });
    const commandRecord = commands.commands.find((item) => item.commandId === runResult.commandId);
    assert(commandRecord, "terminal command record missing");
    assert(commandRecord.threadId === runResult.threadId, "terminal command thread mismatch");
    assert(commandRecord.command.includes("smoke-terminal"), "terminal command text missing");
    assert(commandRecord.cwd === runResult.cwd, "terminal command cwd mismatch");
    assert(commandRecord.output.includes("smoke-terminal"), "terminal command output missing");
    assert(commandRecord.chunks > 0, "terminal command chunks missing");
    const lightCommands = await json("/api/terminal/commands?limit=20&includeOutput=false&previewChars=12", { headers: admin });
    const lightRecord = lightCommands.commands.find((item) => item.commandId === runResult.commandId);
    assert(lightRecord, "light terminal command record missing");
    assert(lightRecord.output.length <= 12, "light terminal preview should be capped");
    assert(lightRecord.outputLength >= commandRecord.output.length, "light terminal total length missing");
    assert(lightRecord.outputTruncated === (lightRecord.outputOffset > 0), "light terminal truncation metadata mismatch");
    const firstPage = await json(`/api/terminal/commands/${runResult.commandId}/output?offset=0&limit=24`, { headers: admin });
    assert(firstPage.output?.commandId === runResult.commandId, "terminal output page command mismatch");
    assert(firstPage.output?.offset === 0, "terminal output page offset mismatch");
    assert(firstPage.output?.text.length <= 24, "terminal output page limit ignored");
    assert(firstPage.output?.totalLength >= commandRecord.output.length, "terminal output page total missing");
    socket.close();
  });

  await check("interactive terminal session", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const session = await json(`/api/projects/${project.id}/terminal/session`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ cols: 28, rows: 8 }),
    });
    assert(session.sessionId, "terminal session id missing");
    assert(session.threadId?.startsWith("terminal:"), "terminal session thread id missing");
    assert(session.backend === "pty", "interactive terminal session should use pty backend");
    assert(session.cols === 28 && session.rows === 8, "terminal should fit a narrow phone viewport without forced 40-column wrapping");
    await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === session.sessionId &&
        event.text.includes("PTY"),
    );
    const resized = await json(`/api/terminal/sessions/${session.sessionId}/resize`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ cols: 100, rows: 30 }),
    });
    assert(resized.ok === true, "terminal session resize response missing");
    assert(resized.cols === 100 && resized.rows === 30, "terminal session resize should return applied size");
    await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === session.sessionId &&
        event.text.includes("100x30"),
    );
    await json(`/api/terminal/sessions/${session.sessionId}/input`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ text: `node -e "console.log('interactive-'+'smoke')"` }),
    });
    const output = await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === session.sessionId &&
        event.text.includes("interactive-smoke"),
    );
    assert(output.threadId === session.threadId, "interactive session output thread mismatch");
    const rawInput = await json(`/api/terminal/sessions/${session.sessionId}/input`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "\u0003", appendNewline: false }),
    });
    assert(rawInput.ok === true, "raw interactive session input should succeed");
    await json(`/api/terminal/sessions/${session.sessionId}/input`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ text: `node -e "console.log(String(process.stdout.columns)+'x'+String(process.stdout.rows))"` }),
    });
    const resizedOutput = await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === session.sessionId &&
        event.text.includes("100x30"),
    );
    assert(resizedOutput.threadId === session.threadId, "terminal session should report resized viewport");
    const stopResult = await json(`/api/terminal/sessions/${session.sessionId}/stop`, {
      method: "POST",
      headers: admin,
    });
    assert(stopResult.ok === true, "terminal session stop response missing");
    await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === session.sessionId &&
        (event.text.includes("已请求停止交互式会话") || event.text.includes("[session stopped]")),
    );
    socket.close();
  });

  await check("stop local terminal command", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const runResult = await json(`/api/projects/${project.id}/terminal/run`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `node -e "console.log('terminal-start'); setTimeout(() => console.log('terminal-end'), 15000)"`,
      }),
    });
    await socket.next(
      (event) => event.type === "terminal.output" &&
        event.threadId === runResult.threadId &&
        event.text.includes("terminal-start"),
    );
    const stopResult = await json(`/api/terminal/${runResult.commandId}/stop`, {
      method: "POST",
      headers: admin,
    });
    assert(stopResult.ok === true, "terminal stop response missing");
    const stopAck = await socket.next(
      (event) => event.type === "terminal.output" &&
        event.threadId === runResult.threadId &&
        (event.text.includes("已请求停止命令") || event.text.includes("[stopped]")),
    );
    assert(stopAck.threadId === runResult.threadId, "terminal stop event missing");
    const commands = await json("/api/terminal/commands?limit=20", { headers: admin });
    const stoppedRecord = commands.commands.find((item) => item.commandId === runResult.commandId);
    assert(stoppedRecord?.status === "stopped", "stopped terminal command status missing");
    socket.close();
  });

  await check("websocket realtime and replay", async () => {
    const first = await openSocket(adminToken);
    const connected = await first.next((event) => event.type === "connected");
    assert(connected.serverVersion, "connected event missing serverVersion");
    assert(connected.protocolVersion >= 1, "connected event missing protocolVersion");
    assert(Array.isArray(connected.capabilities), "connected event missing capabilities");

    replayProbe = `smoke-${Date.now()}`;
    first.send({ type: "debug.echo", threadId: "smoke", text: replayProbe });
    const echo = await first.next((event) => event.type === "message.delta" && event.threadId === "smoke" && event.text === replayProbe);
    assert(echo.text === replayProbe, "debug echo not received");
    first.close();

    const second = await openSocket(adminToken);
    await second.next((event) => event.type === "connected");
    const replay = await second.next((event) => event.type === "message.delta" && event.threadId === "smoke" && event.text === replayProbe);
    assert(replay.text === replayProbe, "replayed event not received");
    second.close();
  });

  await check("websocket heartbeat", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    await socket.waitForPing();
    socket.close();
  });

  await check("thread lifecycle does not inject chat noise", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    socket.send({ type: "thread.start", projectPath: project.path, requestId: "lifecycle-check" });
    const started = await socket.next((event) => event.type === "thread.started" && event.requestId === "lifecycle-check");
    assert(started.thread?.projectPath === project.path, "thread lifecycle event should carry project metadata");
    await socket.expectNo(
      (event) =>
        event.type === "message.delta" &&
        event.threadId === started.threadId &&
        (event.text.includes("线程已创建") || event.text.includes("线程已恢复")),
      400,
    );
    socket.close();
  });

  await check("gateway restart closes dangling terminal commands", async () => {
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const runResult = await json(`/api/projects/${project.id}/terminal/run`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        command: `node -e "console.log('dangling-terminal-start'); setTimeout(() => process.exit(0), 30000)"`,
      }),
    });
    await socket.next(
      (event) => event.type === "terminal.output" &&
        event.commandId === runResult.commandId &&
        event.text.includes("dangling-terminal-start"),
    );
    socket.close();

    await restartServer();
    const commands = await json("/api/terminal/commands?limit=20&includeOutput=true", { headers: admin });
    const closedRecord = commands.commands.find((item) => item.commandId === runResult.commandId);
    assert(closedRecord?.status === "stopped", `dangling terminal should be stopped after restart, got ${JSON.stringify(closedRecord)}`);
    assert(closedRecord.output.includes("Gateway 已重启"), "dangling terminal stop reason missing");
  });

  await check("sqlite persistence and restart replay", async () => {
    const stat = await fs.stat(stateSqlitePath);
    assert(stat.size > 0, "state.sqlite should be non-empty");
    const db = new DatabaseSync(stateSqlitePath, { readOnly: true });
    try {
      const deviceCount = db.prepare("SELECT COUNT(*) AS count FROM devices").get();
      const eventCount = db.prepare("SELECT COUNT(*) AS count FROM events").get();
      assert(deviceCount.count > 0, "sqlite devices table should contain rows");
      assert(eventCount.count > 0, "sqlite events table should contain rows");
    } finally {
      db.close();
    }

    await restartServer();
    const socket = await openSocket(adminToken);
    await socket.next((event) => event.type === "connected");
    const replay = await socket.next((event) => event.type === "message.delta" && event.threadId === "smoke" && event.text === replayProbe);
    assert(replay.text === replayProbe, "restarted server should replay persisted event");
    socket.close();
  });

  console.log("Smoke test passed");
} catch (error) {
  console.error("Smoke test failed:", error);
  console.error("server stdout:", stdout.slice(-4000));
  console.error("server stderr:", stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  child?.kill();
}

function startServer() {
  stdout = "";
  stderr = "";
  const nextChild = spawn(process.execPath, [tsxBin, "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${mockCodex.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      CODEX_MOBILE_CONTROL_CODEX_BIN: process.execPath,
      CODEX_MOBILE_CONTROL_CODEX_ARG_PREFIX: JSON.stringify([mockCodex.scriptPath]),
      CODEX_MOBILE_CONTROL_CODEX_LATEST_VERSION: "9.9.9",
      CODEX_MOBILE_CONTROL_WS_HEARTBEAT_MS: "250",
      CODEX_MOBILE_CONTROL_HOME: appHome,
      CODEX_HOME: path.join(appHome, "codex"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  nextChild.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  nextChild.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return nextChild;
}

async function setupMockCodex() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cmc-codex-mock-"));
  const scriptPath = path.join(dir, "codex-mock.mjs");
  await fs.writeFile(scriptPath, mockCodexScript(), "utf8");
  await fs.writeFile(path.join(dir, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0codex-mock.mjs" %*\r\n`, "utf8");
  await fs.writeFile(path.join(dir, "codex"), `#!/usr/bin/env sh\n"${process.execPath}" "$(dirname "$0")/codex-mock.mjs" "$@"\n`, "utf8");
  await fs.chmod(path.join(dir, "codex"), 0o755);
  return { binDir: dir, scriptPath };
}

async function restartServer() {
  const oldChild = child;
  oldChild.kill();
  await new Promise((resolve) => oldChild.once("exit", resolve));
  await sleep(500);
  child = startServer();
  await waitForHealth();
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await sleep(400);
    }
  }
  throw new Error("server did not become healthy");
}

async function waitForCodexRunning(headers) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const status = await json("/api/codex/status", { headers });
    if (status.codex?.running && status.codex?.initialized) {
      return status.codex;
    }
    await sleep(300);
  }
  throw new Error("mock app-server did not recover");
}

async function check(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

async function json(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${pathname} -> HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk.toString());
    child.stderr.on("data", (chunk) => output += chunk.toString());
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed: ${output}`));
      }
    });
    child.on("error", reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("could not allocate smoke test port"));
        }
      });
    });
  });
}

function openSocket(token) {
  const wsUrl = `${baseUrl.replace("http://", "ws://")}/ws?token=${encodeURIComponent(token)}&device=SmokeTest`;
  const ws = new WebSocket(wsUrl);
  const queue = [];
  const waiters = [];
  const pingWaiters = [];

  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(event);
      return;
    }
    queue.push(event);
  });
  ws.on("ping", () => {
    const waiter = pingWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("websocket open timeout")), 5000);
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve({
        send: (message) => ws.send(JSON.stringify(message)),
        snapshot: () => queue.slice(-12),
        close: () => ws.close(),
        next: (predicate, timeoutMs=5000) => nextEvent(queue, waiters, predicate, timeoutMs),
        expectNo: (predicate, timeoutMs) => expectNoEvent(queue, waiters, predicate, timeoutMs),
        waitForPing: () => waitForPing(pingWaiters),
      });
    });
    ws.once("error", reject);
  });
}

function waitForPing(pingWaiters) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = pingWaiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        pingWaiters.splice(index, 1);
      }
      reject(new Error("websocket ping timeout"));
    }, 5000);
    pingWaiters.push({ resolve, timeout });
  });
}

function nextEvent(queue, waiters, predicate, timeoutMs=5000) {
  const existingIndex = queue.findIndex(predicate);
  if (existingIndex >= 0) {
    const [event] = queue.splice(existingIndex, 1);
    return Promise.resolve(event);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      reject(new Error("websocket event timeout"));
    }, timeoutMs);
    waiters.push({ predicate, resolve, timeout });
  });
}

function expectNoEvent(queue, waiters, predicate, timeoutMs = 500) {
  const existingIndex = queue.findIndex(predicate);
  if (existingIndex >= 0) {
    const [event] = queue.splice(existingIndex, 1);
    return Promise.reject(new Error(`unexpected websocket event: ${JSON.stringify(event)}`));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.findIndex((waiter) => waiter.resolve === fail);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      resolve();
    }, timeoutMs);
    const fail = (event) => {
      clearTimeout(timeout);
      reject(new Error(`unexpected websocket event: ${JSON.stringify(event)}`));
    };
    waiters.push({ predicate, resolve: fail, timeout });
  });
}

function mockCodexScript() {
  return String.raw`
import readline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli mock 0.0.0");
  process.exit(0);
}
if (args[0] !== "app-server") {
  console.error("unsupported mock codex args: " + args.join(" "));
  process.exit(2);
}

let nextThread = 1;
const writerAttempts = new Set();

const threadPrefix = "mock-thread-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "-";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = message.params ?? {};
  if (message.method === "model/list") { respond(message.id, {data:[{model:"cmc-smoke-model",displayName:"Smoke model",supportedReasoningEfforts:[]}],nextCursor:null});return; }
  if (message.method === "initialize") {
    respond(message.id, { serverInfo: { name: "mock-codex-app-server" } });
    return;
  }
  if (message.method === "thread/start") {
    const thread = mockThread(threadPrefix + nextThread++, params.cwd);
    respond(message.id, { thread });
    notify("thread/started", { thread });
    return;
  }
  if (message.method === "thread/resume") {
    const thread = mockThread(params.threadId, params.cwd);
    respond(message.id, { thread });
    notify("thread/started", { thread });
    return;
  }
  if (message.method === "thread/name/set") {respond(message.id,{});return;}
  if (message.method === "thread/section/move") {respond(message.id,{});return;}
  if (message.method === "thread/goal/set") {respond(message.id,{goal:{threadId:params.threadId,objective:params.objective,status:params.status,tokensUsed:0,tokenBudget:null}});return;}

  if (message.method === "turn/start") {
    if (!Array.isArray(params.input) || params.input.some((item) => !Array.isArray(item.text_elements))) {
      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32602, message: "text_elements is required" } }) + "\n");
      return;
    }
    const text = params.input.map((item) => item.text ?? "").join("");
    if(text==='WRITER_QUEUE'&&!writerAttempts.has(params.threadId)){
      writerAttempts.add(params.threadId);
      process.stdout.write(JSON.stringify({id:message.id,error:{code:-32600,message:'thread already has an active writer'}})+'\n');
      return;
    }

    if (text.includes("CRASH_APP_SERVER")) {
      process.exit(42);
      return;
    }
    respond(message.id, { ok: true });
    notify("turn/started", { threadId: params.threadId, turn: mockTurn("inProgress") });
    notify("item/commandExecution/outputDelta", { threadId: params.threadId, itemId: "mock-command", delta: "raw-command-output:" + text });
    notify("item/agentMessage/delta", { threadId: params.threadId, text: "mock:" + text });
    notify("turn/completed", { threadId: params.threadId, turn: mockTurn("completed") });
    return;
  }
  if (message.method === "turn/interrupt") {
    respond(message.id, { ok: true });
    return;
  }
  if (message.id !== undefined) {
    process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "unsupported " + message.method } }) + "\n");
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ id, result }) + "\n");
}

function notify(method, params) {
  process.stdout.write(JSON.stringify({ method, params }) + "\n");
}

function mockThread(id, cwd) {
  const now = Date.now() / 1000;
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    preview: "Mock thread",
    ephemeral: false,
    modelProvider: "mock",
    createdAt: now,
    updatedAt: now,
    status: "idle",
    path: null,
    cwd: cwd || process.cwd(),
    cliVersion: "mock",
    source: "app-server",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Mock thread",
    turns: [],
  };
}

function mockTurn(status) {
  return {
    id: "mock-turn",
    items: [],
    itemsView: "loaded",
    status,
    error: null,
    startedAt: Date.now() / 1000,
    completedAt: status === "completed" ? Date.now() / 1000 : null,
    durationMs: status === "completed" ? 1 : null,
  };
}
`;
}

