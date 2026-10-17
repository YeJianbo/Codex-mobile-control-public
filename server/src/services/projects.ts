import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Project, ProjectRoot, ServerConfig } from "../types.js";
import { saveServerConfig } from "./configStore.js";

export function canonicalProjectPath(value: string): string {
  if (process.platform === 'win32') {
    if (value.startsWith('\\\\?\\UNC\\')) value = '\\\\' + value.slice(8);
    else if (value.startsWith('\\\\?\\')) value = value.slice(4);
  }
  return path.resolve(value);
}

function projectId(projectPath: string): string {
  return crypto.createHash("sha256").update(canonicalProjectPath(projectPath).toLowerCase()).digest("hex").slice(0, 16);
}

export async function listProjects(config: ServerConfig): Promise<Project[]> {
  const roots = uniqueResolvedRoots(config.projectRoots);
  const projects = (await rootsWithStatus(roots)).map((root) => ({
    id: projectId(root.path),
    name: root.name,
    path: root.path,
    trusted: root.exists,
  }));

  return projects.filter((project) => project.trusted);
}

export function listProjectRoots(config: ServerConfig): ProjectRoot[] {
  return uniqueResolvedRoots(config.projectRoots).map((root) => ({
    path: root,
    name: path.basename(root),
    exists: false,
  }));
}

export async function listProjectRootsWithStatus(config: ServerConfig): Promise<ProjectRoot[]> {
  return rootsWithStatus(uniqueResolvedRoots(config.projectRoots));
}

async function rootsWithStatus(roots: string[]): Promise<ProjectRoot[]> {
  return await Promise.all(
    roots.map(async (root) => {
      const stat = await fs.stat(root).catch(() => null);
      return {
        path: root,
        name: path.basename(root),
        exists: Boolean(stat?.isDirectory()),
      };
    }),
  );
}

export async function addProject(config: ServerConfig, projectPath: string, create = false): Promise<Project> {
  if(create){
    if(!path.isAbsolute(projectPath))throw new Error('请输入电脑上的完整项目路径');
    // A single new directory under an existing parent; never overwrite a project.
    await fs.mkdir(canonicalProjectPath(projectPath));
  }
  const root = await addProjectRoot(config, projectPath);
  return {
    id: projectId(root.path),
    name: root.name,
    path: root.path,
    trusted: true,
  };
}

export async function addProjectRoot(config: ServerConfig, projectPath: string): Promise<ProjectRoot> {
  const absolutePath = canonicalProjectPath(projectPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error("项目路径不是目录");
  }
  if (!config.projectRoots.some((root) => path.resolve(root).toLowerCase() === absolutePath.toLowerCase())) {
    config.projectRoots.push(absolutePath);
    await saveServerConfig(config);
  }
  return {
    name: path.basename(absolutePath),
    path: absolutePath,
    exists: true,
  };
}

export async function removeProjectRoot(config: ServerConfig, rootPath: string): Promise<ProjectRoot> {
  const absolutePath = path.resolve(rootPath);
  const existing = config.projectRoots.find((root) => path.resolve(root).toLowerCase() === absolutePath.toLowerCase());
  if (!existing) {
    throw new Error("项目根目录不存在");
  }
  config.projectRoots = config.projectRoots.filter((root) => path.resolve(root).toLowerCase() !== absolutePath.toLowerCase());
  await saveServerConfig(config);
  const stat = await fs.stat(absolutePath).catch(() => null);
  return {
    path: absolutePath,
    name: path.basename(absolutePath),
    exists: Boolean(stat?.isDirectory()),
  };
}

function uniqueResolvedRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const root of roots) {
    const absolutePath = canonicalProjectPath(root);
    const key = absolutePath.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(absolutePath);
    }
  }
  return result;
}
