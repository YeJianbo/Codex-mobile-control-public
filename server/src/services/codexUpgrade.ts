import { execa } from "execa";

export type CodexUpgradeCheck = {
  checkedAt: string;
  installedVersion: string | null;
  installedRaw: string | null;
  latestVersion: string | null;
  packageName: string;
  updateAvailable: boolean;
  command: string;
  source: "env" | "npm" | "disabled" | "unknown";
  error?: string;
};

const defaultPackageName = "@openai/codex";

export async function checkCodexUpgrade(installedRaw: string | null): Promise<CodexUpgradeCheck> {
  const checkedAt = new Date().toISOString();
  const packageName = process.env.CODEX_MOBILE_CONTROL_CODEX_NPM_PACKAGE || defaultPackageName;
  const installedVersion = parseVersion(installedRaw);
  const command = `npm install -g ${packageName}@latest`;

  if (process.env.CODEX_MOBILE_CONTROL_DISABLE_UPGRADE_CHECK === "1") {
    return {
      checkedAt,
      installedVersion,
      installedRaw,
      latestVersion: null,
      packageName,
      updateAvailable: false,
      command,
      source: "disabled",
      error: "升级检查已关闭",
    };
  }

  const envLatest = process.env.CODEX_MOBILE_CONTROL_CODEX_LATEST_VERSION?.trim();
  if (envLatest) {
    return buildUpgradeCheck({
      checkedAt,
      installedRaw,
      installedVersion,
      latestVersion: parseVersion(envLatest) ?? envLatest,
      packageName,
      command,
      source: "env",
    });
  }

  try {
    const { stdout } = await execa("npm", ["view", packageName, "version", "--json"], { timeout: 5000 });
    const latestRaw = stdout.trim().replace(/^"|"$/g, "");
    return buildUpgradeCheck({
      checkedAt,
      installedRaw,
      installedVersion,
      latestVersion: parseVersion(latestRaw) ?? latestRaw,
      packageName,
      command,
      source: "npm",
    });
  } catch (error) {
    return {
      checkedAt,
      installedVersion,
      installedRaw,
      latestVersion: null,
      packageName,
      updateAvailable: false,
      command,
      source: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildUpgradeCheck(input: {
  checkedAt: string;
  installedRaw: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  packageName: string;
  command: string;
  source: CodexUpgradeCheck["source"];
}): CodexUpgradeCheck {
  return {
    ...input,
    updateAvailable: Boolean(input.installedVersion && input.latestVersion && compareVersions(input.installedVersion, input.latestVersion) < 0),
  };
}

function parseVersion(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function numericParts(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/)[0].split(".");
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}
