import os from "node:os";
import path from "node:path";

export function appHome(): string {
  if (process.env.CODEX_MOBILE_CONTROL_HOME) {
    return process.env.CODEX_MOBILE_CONTROL_HOME;
  }
  return path.join(os.homedir(), ".codex-mobile-control");
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

export function userCodexConfigPath(): string {
  return path.join(codexHome(), "config.toml");
}
