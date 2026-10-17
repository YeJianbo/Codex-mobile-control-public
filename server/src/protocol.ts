import {readFileSync} from "node:fs";

export const SERVER_VERSION:string = JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")).version;
export const CONTROL_PROTOCOL_VERSION = 1;
export const MIN_ANDROID_PROTOCOL_VERSION = 1;

export const CONTROL_CAPABILITIES = [
  "foreground-websocket-probe",
  "focused-thread-stream",
  "mobile-live-activity-details",
  "agent-health",
  "harness-public-access",
  "harness-thread-pins",
  "shared-backend-restart",
  "capacity-auto-retry",
  "last-message-edit",
  "pairing",
  "device-revoke",
  "token-rotation",
  "project-roots",
  "https-config",
  "settings-raw",
  "approval-summary",
  "thread-management",
  "thread-read-state",
  "thread-sidebar-filters",
  "sidebar-pin-sync",
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
  "queue-draft-recovery",
  "desktop-task-progress",
  "local-console-management",
  "cloud-snapshot-readonly",
  "cloud-thread-history",
  "message-source",
  "automations",
  "local-task-receipts",
  "harness-durable-submissions",
  "local-thread-output-files",
  "new-thread-goals",
] as const;

export function protocolMetadata() {
  return {
    version: SERVER_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    minAndroidProtocolVersion: MIN_ANDROID_PROTOCOL_VERSION,
    capabilities: [...CONTROL_CAPABILITIES],
  };
}
