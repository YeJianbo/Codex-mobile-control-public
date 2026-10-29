import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { DiffFileEntry, DiffHunk, FileEntry, Project, ServerConfig } from "../types.js";
import { listProjects } from "./projects.js";
import {OutputDirectoryError} from './threadOutputFiles.js';

const ignoredNames = new Set([".git", "node_modules", ".gradle", "dist", "build", ".idea"]);
const maxTextFileBytes = 1024 * 1024;
type DiffSource = "worktree" | "staged";

export async function listDirectory(config: ServerConfig, projectId: string, relativePath = ""): Promise<FileEntry[]> {
  const { project, absolutePath } = await resolveWorkspacePath(config, projectId, relativePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error("路径不是目录");
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const result = await Promise.all(
    entries
      .filter((entry) => !ignoredNames.has(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(absolutePath, entry.name);
        const itemStat = await fs.stat(fullPath).catch(() => null);
        if (!itemStat) return null;
        const itemRelativePath = toPortablePath(path.relative(project.path, fullPath));
        return {
          name: entry.name,
          path: itemRelativePath,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? undefined : itemStat.size,
          modifiedAt: itemStat.mtime.toISOString(),
        } satisfies FileEntry;
      }),
  );

  return result.filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export async function readTextFile(config: ServerConfig, projectId: string, relativePath: string): Promise<{ content: string; encoding: "utf8"; size: number }> {
  const { absolutePath } = await resolveWorkspacePath(config, projectId, relativePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("路径不是文件");
  }
  if (stat.size > maxTextFileBytes) {
    throw new Error("文件过大，暂不作为文本读取");
  }
  const bytes = await fs.readFile(absolutePath);
  if (bytes.includes(0)) throw new Error("二进制文件不能作为文本编辑");
  return {
    content: bytes.toString("utf8"),
    encoding: "utf8",
    size: stat.size,
  };
}

export async function writeTextFile(config: ServerConfig, projectId: string, relativePath: string, content: string): Promise<{ ok: true }> {
  const { absolutePath } = await resolveWorkspacePath(config, projectId, relativePath);
  await fs.writeFile(absolutePath, content, "utf8");
  return { ok: true };
}

export async function resolveRawFile(config: ServerConfig, projectId: string, relativePath: string): Promise<{ absolutePath: string; fileName: string }> {
  const { absolutePath } = await resolveWorkspacePath(config, projectId, relativePath);
  const stat = await fs.stat(absolutePath);
  if(stat.isDirectory())throw new OutputDirectoryError();
  if (!stat.isFile()) {
    throw new Error("路径不是文件");
  }
  return { absolutePath, fileName: path.basename(absolutePath) };
}

export async function readProjectDiff(config: ServerConfig, projectId: string): Promise<{ stat: string; diff: string }> {
  const { project } = await resolveWorkspacePath(config, projectId, "");
  const [stat, diff] = await Promise.all([
    execa("git", ["diff", "--stat"], { cwd: project.path, reject: false }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["diff", "--"], { cwd: project.path, reject: false, maxBuffer: 1024 * 1024 * 5 }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
  ]);
  return { stat, diff };
}

export async function listProjectDiffFiles(config: ServerConfig, projectId: string): Promise<{ files: DiffFileEntry[] }> {
  const { project } = await resolveWorkspacePath(config, projectId, "");
  const [numstat, nameStatus, cachedNumstat, cachedNameStatus, untracked] = await Promise.all([
    execa("git", ["diff", "--numstat", "-z", "--"], { cwd: project.path, reject: false, maxBuffer: 1024 * 1024 }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["diff", "--name-status", "-z", "--"], { cwd: project.path, reject: false, maxBuffer: 1024 * 1024 }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["diff", "--cached", "--numstat", "-z", "--"], { cwd: project.path, reject: false, maxBuffer: 1024 * 1024 }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["diff", "--cached", "--name-status", "-z", "--"], { cwd: project.path, reject: false, maxBuffer: 1024 * 1024 }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: project.path }).then(result => result.stdout),
  ]);
  return {
    files: mergeDiffFileMetadata(
      parseNumstat(numstat),
      parseNameStatus(nameStatus),
      parseNumstat(cachedNumstat),
      [...parseNameStatus(cachedNameStatus, "accepted"), ...untracked.split("\0").filter(Boolean).map(filePath => ({ path: filePath, status: "added" as const }))],
    ),
  };
}

export async function readFileDiff(config: ServerConfig, projectId: string, relativePath: string): Promise<{ path: string; diff: string }> {
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const [worktreeDiff, stagedDiff] = await Promise.all([
    execa("git", ["diff", "--", gitPath], {
      cwd: project.path,
      reject: false,
      maxBuffer: 1024 * 1024 * 2,
    }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
    execa("git", ["diff", "--cached", "--", gitPath], {
      cwd: project.path,
      reject: false,
      maxBuffer: 1024 * 1024 * 2,
    }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    }),
  ]);
  let diff = [worktreeDiff, stagedDiff].filter((part) => part.trim()).join("\n");
  if (!diff) {
    const untracked = await execa("git", ["ls-files", "--others", "--exclude-standard", "--", gitPath], { cwd: project.path });
    if (untracked.stdout) diff = (await execa("git", ["diff", "--no-index", "--", "/dev/null", gitPath], { cwd: project.path, reject: false })).stdout;
  }
  return { path: relativePath.replaceAll("\\", "/"), diff };
}

export async function readFileDiffHunks(config: ServerConfig, projectId: string, relativePath: string): Promise<{ path: string; hunks: DiffHunk[] }> {
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const [worktreeDiff, stagedDiff] = await Promise.all([
    readSingleFileDiff(project.path, gitPath, "worktree"),
    readSingleFileDiff(project.path, gitPath, "staged"),
  ]);
  return {
    path: gitPath,
    hunks: [
      ...parseDiffHunks(worktreeDiff, "worktree"),
      ...parseDiffHunks(stagedDiff, "staged"),
    ],
  };
}

export async function acceptFileDiffHunk(config: ServerConfig, projectId: string, relativePath: string, source: DiffSource, hunkIndex: number): Promise<{ ok: true; path: string; source: DiffSource; index: number }> {
  if (source !== "worktree") {
    throw new Error("已暂存 hunk 不需要再次接受");
  }
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const hunk = await resolveCurrentHunk(project.path, gitPath, source, hunkIndex);
  await applyPatch(project.path, hunk.patch, ["--cached"]);
  return { ok: true, path: gitPath, source, index: hunkIndex };
}

export async function revertFileDiffHunk(config: ServerConfig, projectId: string, relativePath: string, source: DiffSource, hunkIndex: number): Promise<{ ok: true; path: string; source: DiffSource; index: number }> {
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const hunk = await resolveCurrentHunk(project.path, gitPath, source, hunkIndex);
  const args = source === "staged" ? ["--cached", "--reverse"] : ["--reverse"];
  await applyPatch(project.path, hunk.patch, args);
  return { ok: true, path: gitPath, source, index: hunkIndex };
}

export async function acceptFileDiff(config: ServerConfig, projectId: string, relativePath: string): Promise<{ ok: true; path: string }> {
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const result = await execa("git", ["add", "--", gitPath], {
    cwd: project.path,
    reject: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "接受文件改动失败");
  }
  return { ok: true, path: gitPath };
}

export async function acceptFileDiffs(config: ServerConfig, projectId: string, relativePaths: string[]): Promise<{ ok: true; paths: string[] }> {
  const paths: string[] = [];
  for (const relativePath of uniquePortablePaths(relativePaths)) {
    const result = await acceptFileDiff(config, projectId, relativePath);
    paths.push(result.path);
  }
  return { ok: true, paths };
}

export async function revertFileDiff(config: ServerConfig, projectId: string, relativePath: string): Promise<{ ok: true; path: string }> {
  const { project } = await resolveWorkspacePath(config, projectId, relativePath);
  const gitPath = relativePath.replaceAll("\\", "/");
  const result = await execa("git", ["restore", "--staged", "--worktree", "--", gitPath], {
    cwd: project.path,
    reject: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "撤销文件改动失败");
  }
  return { ok: true, path: gitPath };
}

export async function revertFileDiffs(config: ServerConfig, projectId: string, relativePaths: string[]): Promise<{ ok: true; paths: string[] }> {
  const paths: string[] = [];
  for (const relativePath of uniquePortablePaths(relativePaths)) {
    const result = await revertFileDiff(config, projectId, relativePath);
    paths.push(result.path);
  }
  return { ok: true, paths };
}

async function resolveWorkspacePath(
  config: ServerConfig,
  projectId: string,
  relativePath: string,
): Promise<{ project: Project; absolutePath: string }> {
  const projects = await listProjects(config);
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("未知项目");
  }

  const normalizedRelative = relativePath.replaceAll("\\", "/");
  if (path.isAbsolute(normalizedRelative) || normalizedRelative.split("/").includes("..")) {
    throw new Error("非法路径");
  }

  const absolutePath = path.resolve(project.path, normalizedRelative);
  const relativeToRoot = path.relative(project.path, absolutePath);
  if ((relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`)) || path.isAbsolute(relativeToRoot)) {
    throw new Error("路径越界");
  }

  const realRoot = await fs.realpath(project.path);
  let ancestor = absolutePath;
  while (true) {
    try { ancestor = await fs.realpath(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const realRelative = path.relative(realRoot, ancestor);
  if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) throw new Error("符号链接指向项目目录之外");
  return { project, absolutePath };
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function parseNumstat(output: string): Map<string, Pick<DiffFileEntry, "additions" | "deletions">> {
  const result = new Map<string, Pick<DiffFileEntry, "additions" | "deletions">>();
  const parts = output.split("\0");
  while (parts.length) {
    const entry = parts.shift()!;
    if (!entry) continue;
    const [add, del, ...names] = entry.split("\t");
    let filePath = names.join("\t");
    if (!filePath) { parts.shift(); filePath = parts.shift() ?? ""; }
    if (filePath) result.set(filePath, { additions: Number.parseInt(add, 10) || 0, deletions: Number.parseInt(del, 10) || 0 });
  }
  return result;
}

function parseNameStatus(output: string, overrideStatus?: DiffFileEntry["status"]): DiffFileEntry[] {
  const result: DiffFileEntry[] = [];
  const parts = output.split("\0");
  while (parts.length) {
    const status = parts.shift();
    if (!status) continue;
    const first = parts.shift();
    if (!first) continue;
    const renamed = status[0] === "R" || status[0] === "C";
    const filePath = renamed ? parts.shift() : first;
    if (filePath) result.push({ path: filePath, oldPath: renamed ? first : undefined, status: overrideStatus ?? (renamed ? "renamed" : statusForGitCode(status[0])) });
  }
  return result;
}

function mergeDiffFileMetadata(
  stats: Map<string, Pick<DiffFileEntry, "additions" | "deletions">>,
  statuses: DiffFileEntry[],
  acceptedStats: Map<string, Pick<DiffFileEntry, "additions" | "deletions">> = new Map(),
  acceptedStatuses: DiffFileEntry[] = [],
): DiffFileEntry[] {
  const statusByPath = new Map<string, DiffFileEntry>();
  for (const entry of [...acceptedStatuses, ...statuses]) {
    statusByPath.set(entry.path, {
      ...statusByPath.get(entry.path),
      ...entry,
      status: entry.status,
    });
  }

  const merged = [...statusByPath.values()].map((entry) => ({
    ...entry,
    ...(acceptedStats.get(entry.path) ?? {}),
    ...(stats.get(entry.path) ?? {}),
  }));

  for (const [filePath, stat] of stats) {
    if (!merged.some((entry) => entry.path === filePath)) {
      merged.push({ path: filePath, status: "unknown", ...stat });
    }
  }
  for (const [filePath, stat] of acceptedStats) {
    if (!merged.some((entry) => entry.path === filePath)) {
      merged.push({ path: filePath, status: "accepted", ...stat });
    }
  }
  return merged.sort((a, b) => a.path.localeCompare(b.path));
}

function statusForGitCode(code: string): DiffFileEntry["status"] {
  if (code === "A") return "added";
  if (code === "M") return "modified";
  if (code === "D") return "deleted";
  if (code === "U") return "unmerged";
  return "unknown";
}

function normalizeGitPath(value: string): string {
  return value.replaceAll("\\", "/").trim();
}

function uniquePortablePaths(paths: string[]): string[] {
  return [...new Set(paths.map((item) => item.replaceAll("\\", "/").trim()).filter(Boolean))];
}

async function readSingleFileDiff(projectPath: string, gitPath: string, source: DiffSource): Promise<string> {
  const args = source === "staged" ? ["diff", "--cached", "--", gitPath] : ["diff", "--", gitPath];
  return await execa("git", args, {
    cwd: projectPath,
    reject: false,
    maxBuffer: 1024 * 1024 * 2,
  }).then((result) => {
      if (result.exitCode !== 0) throw new Error(/not a git repository/i.test(result.stderr) ? "当前项目不是 Git 仓库" : result.stderr || "Git 操作失败");
      return result.stdout;
    });
}

async function resolveCurrentHunk(projectPath: string, gitPath: string, source: DiffSource, hunkIndex: number): Promise<{ patch: string }> {
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0) {
    throw new Error("非法 hunk 序号");
  }
  const diff = await readSingleFileDiff(projectPath, gitPath, source);
  const parsed = parseDiffHunksWithPatch(diff, source);
  const hunk = parsed[hunkIndex];
  if (!hunk) {
    throw new Error("hunk 不存在或 diff 已变化");
  }
  return hunk;
}

async function applyPatch(projectPath: string, patch: string, args: string[]): Promise<void> {
  const result = await execa("git", ["apply", ...args], {
    cwd: projectPath,
    input: patch,
    reject: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "应用 hunk 失败，可能 diff 已变化");
  }
}

function parseDiffHunks(diff: string, source: DiffSource): DiffHunk[] {
  return parseDiffHunksWithPatch(diff, source).map(({ patch: _patch, ...hunk }) => hunk);
}

function parseDiffHunksWithPatch(diff: string, source: DiffSource): Array<DiffHunk & { patch: string }> {
  const lines = diff.split(/\r?\n/);
  const fileHeader: string[] = [];
  const result: Array<DiffHunk & { patch: string }> = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      if (current) {
        result.push(createDiffHunk(source, result.length, fileHeader, current));
      }
      current = [line];
      continue;
    }
    if (current) {
      current.push(line);
      continue;
    }
    if (line.trim()) {
      fileHeader.push(line);
    }
  }

  if (current) {
    result.push(createDiffHunk(source, result.length, fileHeader, current));
  }

  return result;
}

function createDiffHunk(source: DiffSource, index: number, fileHeader: string[], hunkLines: string[]): DiffHunk & { patch: string } {
  const text = hunkLines.join("\n").trimEnd();
  const patch = [...fileHeader, ...hunkLines].join("\n").trimEnd() + "\n";
  return {
    id: `${source}:${index}`,
    index,
    source,
    header: hunkLines[0] ?? "",
    text,
    patch,
  };
}
