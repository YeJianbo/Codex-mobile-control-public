export const SERVER_VERSION = "0.4.0";
export const CONTROL_PROTOCOL_VERSION = 1;
export const MIN_ANDROID_PROTOCOL_VERSION = 1;

export const CONTROL_CAPABILITIES = [
  "pairing",
  "device-revoke",
  "token-rotation",
  "project-roots",
  "https-config",
  "settings-raw",
  "approval-summary",
  "thread-management",
  "files",
  "diff",
  "diff-hunks",
  "terminal-commands",
  "terminal-stop",
  "terminal-pty",
  "terminal-session-resize",
  "preview-proxy",
  "codex-upgrade-check",
  "websocket-heartbeat",
  "followup-queue",
  "desktop-task-progress",
] as const;

export function protocolMetadata() {
  return {
    version: SERVER_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    minAndroidProtocolVersion: MIN_ANDROID_PROTOCOL_VERSION,
    capabilities: [...CONTROL_CAPABILITIES],
  };
}
