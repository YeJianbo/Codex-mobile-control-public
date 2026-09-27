import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import selfsigned from "selfsigned";
import type { ServerConfig } from "../types.js";
import { saveServerConfig } from "./configStore.js";
import { appHome } from "./paths.js";

export type HttpsConfigView = {
  enabled: boolean;
  certPath: string;
  keyPath: string;
  certExists: boolean;
  keyExists: boolean;
};

export async function readHttpsConfig(config: ServerConfig): Promise<HttpsConfigView> {
  const certPath = config.https?.certPath ?? defaultCertPath();
  const keyPath = config.https?.keyPath ?? defaultKeyPath();
  return {
    enabled: Boolean(config.https?.enabled),
    certPath,
    keyPath,
    certExists: await exists(certPath),
    keyExists: await exists(keyPath),
  };
}

export async function updateHttpsConfig(
  config: ServerConfig,
  input: { enabled?: boolean; generateSelfSigned?: boolean; certPath?: string; keyPath?: string },
): Promise<HttpsConfigView & { restartRequired: boolean }> {
  const certPath = path.resolve(input.certPath ?? config.https?.certPath ?? defaultCertPath());
  const keyPath = path.resolve(input.keyPath ?? config.https?.keyPath ?? defaultKeyPath());
  if (input.generateSelfSigned) {
    await generateSelfSignedCertificate({
      certPath,
      keyPath,
      host: config.host,
    });
  }
  config.https = {
    enabled: input.enabled ?? Boolean(config.https?.enabled),
    certPath,
    keyPath,
  };
  await saveServerConfig(config);
  return {
    ...(await readHttpsConfig(config)),
    restartRequired: true,
  };
}

export async function httpsListenOptions(config: ServerConfig): Promise<{ key: string; cert: string } | undefined> {
  if (!config.https?.enabled) {
    return undefined;
  }
  const certPath = config.https.certPath ?? defaultCertPath();
  const keyPath = config.https.keyPath ?? defaultKeyPath();
  return {
    key: await fs.readFile(keyPath, "utf8"),
    cert: await fs.readFile(certPath, "utf8"),
  };
}

function defaultCertPath(): string {
  return path.join(appHome(), "certs", "gateway-cert.pem");
}

function defaultKeyPath(): string {
  return path.join(appHome(), "certs", "gateway-key.pem");
}

async function generateSelfSignedCertificate(input: { certPath: string; keyPath: string; host: string }): Promise<void> {
  await fs.mkdir(path.dirname(input.certPath), { recursive: true });
  await fs.mkdir(path.dirname(input.keyPath), { recursive: true });
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    { type: 7, ip: "::1" },
  ];
  if (input.host && input.host !== "0.0.0.0") {
    altNames.push(isIpAddress(input.host) ? { type: 7, ip: input.host } : { type: 2, value: input.host });
  }
  for(const addresses of Object.values(os.networkInterfaces()))for(const address of addresses??[]){
    if(address.family==='IPv4'&&!address.internal&&!address.address.startsWith('169.254.'))altNames.push({type:7,ip:address.address});
  }
  const certificate = await selfsigned.generate(
    [{ name: "commonName", value: "Codex Mobile Control Gateway" }],
    {
      notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: true },
        { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames },
      ],
    },
  );
  await fs.writeFile(input.certPath, certificate.cert, "utf8");
  await fs.writeFile(input.keyPath, certificate.private, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  return await fs.access(filePath).then(() => true).catch(() => false);
}

function isIpAddress(value: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(value) || value.includes(":");
}
