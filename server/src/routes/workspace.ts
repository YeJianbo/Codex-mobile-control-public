import type {FastifyInstance} from 'fastify';
import fs from 'node:fs/promises';
import {z} from 'zod';
import type {ServerConfig} from '../types.js';
import type {LocalTerminal} from '../services/localTerminal.js';
import type {StateStore} from '../services/stateStore.js';
import { acceptFileDiff, acceptFileDiffHunk, acceptFileDiffs, listDirectory, listProjectDiffFiles, readFileDiff, readFileDiffHunks, readProjectDiff, readTextFile, resolveRawFile, revertFileDiff, revertFileDiffHunk, revertFileDiffs, writeTextFile } from "../services/workspaceFiles.js";
const fileQuerySchema = z.object({
  path: z.string().optional(),
});
const writeFileSchema = z.object({
  content: z.string(),
});
const runCommandSchema = z.object({
  command: z.string().min(1).max(2000),
});
const terminalSessionSchema = z.object({
  cols: z.number().int().min(20).max(240).optional(),
  rows: z.number().int().min(5).max(80).optional(),
});
const terminalInputSchema = z.object({
  text: z.string().min(1).max(20000),
  appendNewline: z.boolean().optional(),
});
const terminalResizeSchema = z.object({
  cols: z.number().int().min(20).max(240),
  rows: z.number().int().min(5).max(80),
});
const terminalHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const terminalCommandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeOutput: z.enum(["true", "false"]).optional(),
  previewChars: z.coerce.number().int().min(0).max(100000).optional(),
});
const terminalOutputQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100000).optional(),
  stream: z.enum(["stdout", "stderr", "combined"]).optional(),
});
const diffBatchSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
});
const diffHunkSchema = z.object({
  source: z.enum(["worktree", "staged"]),
  index: z.number().int().min(0),
});

// Fastify's existing auth/public-access hooks cover these routes too. File access
// remains in workspaceFiles, which owns project and realpath validation.
export function registerWorkspaceRoutes(app:FastifyInstance,{config,localTerminal,store,contentTypeFor}:{config:ServerConfig;localTerminal:LocalTerminal;store:StateStore;contentTypeFor:(fileName:string)=>string}){
app.get("/api/projects/:projectId/files", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.parse(request.query);
  return { files: await listDirectory(config, params.projectId, query.path ?? "") };
});

app.get("/api/projects/:projectId/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readTextFile(config, params.projectId, query.path);
});

app.put("/api/projects/:projectId/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = writeFileSchema.parse(request.body);
  return await writeTextFile(config, params.projectId, query.path, body.content);
});

app.get("/api/projects/:projectId/diff", async (request) => {
  const params = request.params as { projectId: string };
  return await readProjectDiff(config, params.projectId);
});

app.get("/api/projects/:projectId/diff/files", async (request) => {
  const params = request.params as { projectId: string };
  return await listProjectDiffFiles(config, params.projectId);
});

app.get("/api/projects/:projectId/diff/file", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readFileDiff(config, params.projectId, query.path);
});

app.get("/api/projects/:projectId/diff/file/hunks", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await readFileDiffHunks(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/accept", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await acceptFileDiff(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/revert", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  return await revertFileDiff(config, params.projectId, query.path);
});

app.post("/api/projects/:projectId/diff/file/hunk/accept", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = diffHunkSchema.parse(request.body);
  return await acceptFileDiffHunk(config, params.projectId, query.path, body.source, body.index);
});

app.post("/api/projects/:projectId/diff/file/hunk/revert", async (request) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const body = diffHunkSchema.parse(request.body);
  return await revertFileDiffHunk(config, params.projectId, query.path, body.source, body.index);
});

app.post("/api/projects/:projectId/diff/files/accept", async (request) => {
  const params = request.params as { projectId: string };
  const body = diffBatchSchema.parse(request.body);
  return await acceptFileDiffs(config, params.projectId, body.paths);
});

app.post("/api/projects/:projectId/diff/files/revert", async (request) => {
  const params = request.params as { projectId: string };
  const body = diffBatchSchema.parse(request.body);
  return await revertFileDiffs(config, params.projectId, body.paths);
});

app.post("/api/projects/:projectId/terminal/run", async (request) => {
  const params = request.params as { projectId: string };
  const body = runCommandSchema.parse(request.body);
  return await localTerminal.runCommand(params.projectId, body.command);
});

app.post("/api/projects/:projectId/terminal/session", async (request) => {
  const params = request.params as { projectId: string };
  const body = terminalSessionSchema.parse(request.body ?? {});
  return await localTerminal.startInteractiveSession(params.projectId, body);
});

app.get("/api/terminal/history", async (request) => {
  const query = terminalHistoryQuerySchema.parse(request.query);
  return { events: store.terminalEvents(query.limit) };
});

app.get("/api/terminal/commands", async (request) => {
  const query = terminalCommandsQuerySchema.parse(request.query);
  return {
    commands: store.terminalCommands(query.limit, {
      includeOutput: query.includeOutput === undefined ? true : query.includeOutput === "true",
      previewChars: query.previewChars,
    }),
  };
});

app.get("/api/terminal/commands/:commandId/output", async (request) => {
  const params = request.params as { commandId: string };
  const query = terminalOutputQuerySchema.parse(request.query);
  return {
    output: store.terminalCommandOutput(params.commandId, query),
  };
});

app.post("/api/terminal/:commandId/stop", async (request) => {
  const params = request.params as { commandId: string };
  return localTerminal.stopCommand(params.commandId);
});

app.post("/api/terminal/sessions/:sessionId/input", async (request) => {
  const params = request.params as { sessionId: string };
  const body = terminalInputSchema.parse(request.body);
  return localTerminal.writeInteractiveSession(params.sessionId, body.text, body.appendNewline !== false);
});

app.post("/api/terminal/sessions/:sessionId/resize", async (request) => {
  const params = request.params as { sessionId: string };
  const body = terminalResizeSchema.parse(request.body);
  return localTerminal.resizeInteractiveSession(params.sessionId, body);
});

app.post("/api/terminal/sessions/:sessionId/stop", async (request) => {
  const params = request.params as { sessionId: string };
  return localTerminal.stopInteractiveSession(params.sessionId);
});

app.get("/raw/projects/:projectId/file", async (request, reply) => {
  const params = request.params as { projectId: string };
  const query = fileQuerySchema.extend({ path: z.string().min(1) }).parse(request.query);
  const file = await resolveRawFile(config, params.projectId, query.path);
  return reply.type(contentTypeFor(file.fileName)).send(await fs.readFile(file.absolutePath));
});

}
