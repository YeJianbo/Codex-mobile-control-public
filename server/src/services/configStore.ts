import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ServerConfig } from "../types.js";
import { appHome } from "./paths.js";

const configPath = path.join(appHome(), "server.json");

export async function loadServerConfig(): Promise<ServerConfig> {
  await fs.mkdir(appHome(), { recursive: true });
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ServerConfig>;
    return {
      host: parsed.host ?? "0.0.0.0",
      port: parsed.port ?? 38457,
      token: parsed.token ?? nanoid(32),
      projectRoots: parsed.projectRoots ?? [],
      capacityAutoRetry: parsed.capacityAutoRetry === true,
      publicAgents: parsed.publicAgents&&typeof parsed.publicAgents==='object'?Object.fromEntries(Object.entries(parsed.publicAgents).filter(([agent,enabled])=>['codex','claude','antigravity','grok','deepseek','hermes','opencode'].includes(agent)&&typeof enabled==='boolean')):{},
      https: parsed.https ?? { enabled: false },
    };
  } catch {
    const created: ServerConfig = {
      host: "0.0.0.0",
      port: 38457,
      token: nanoid(32),
      projectRoots: [],
      https: { enabled: false },
    };
    await saveServerConfig(created);
    return created;
  }
}

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function rotateServerToken(config: ServerConfig): Promise<string> {
  config.token = nanoid(32);
  await saveServerConfig(config);
  return config.token;
}

export function serverConfigPath(): string {
  return configPath;
}
