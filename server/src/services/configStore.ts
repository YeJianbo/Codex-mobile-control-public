import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ServerConfig } from "../types.js";
import { appHome } from "./paths.js";

const configPath = path.join(appHome(), "server.json");
let pendingWrite: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(operation);
  pendingWrite = result.catch(() => {});
  return result;
}

async function writeConfig(config: ServerConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, configPath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function loadServerConfig(): Promise<ServerConfig> {
  return serialize(async () => {
    let parsed: Partial<ServerConfig>;
    try {
      parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<ServerConfig>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parsed = {};
    }
    const config: ServerConfig = {
      host: parsed.host ?? "0.0.0.0",
      port: parsed.port ?? 38457,
      token: parsed.token ?? nanoid(32),
      projectRoots: parsed.projectRoots ?? [],
      capacityAutoRetry: parsed.capacityAutoRetry === true,
      publicAgents: parsed.publicAgents&&typeof parsed.publicAgents==='object'?Object.fromEntries(Object.entries(parsed.publicAgents).filter(([agent,enabled])=>['codex','claude','antigravity','grok','deepseek','hermes','opencode','zcode'].includes(agent)&&typeof enabled==='boolean')):{},
      https: parsed.https ?? { enabled: false },
    };
    if (parsed.token == null) await writeConfig(config);
    return config;
  });
}

// All settings edit the latest committed value. Failed writes leave the live config intact.
export function updateServerConfig(config: ServerConfig, update: (draft: ServerConfig) => void): Promise<void> {
  return serialize(async () => {
    const draft = structuredClone(config);
    update(draft);
    await writeConfig(draft);
    Object.assign(config, draft);
  });
}

export async function rotateServerToken(config: ServerConfig): Promise<string> {
  await updateServerConfig(config, draft => { draft.token = nanoid(32); });
  return config.token;
}

export function serverConfigPath(): string {
  return configPath;
}
