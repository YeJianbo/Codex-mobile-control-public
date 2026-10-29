# CLI Agent Host

## Purpose

The Gateway owns HTTP/WebSocket access, authorization, project-path checks, and the durable conversation event store. `AgentHost` owns non-Codex CLI processes and their ACP/stream adapters. Keeping these lifetimes separate lets a Gateway restart without terminating an active CLI turn.

```text
Android / Web / channel
        |
        v
Gateway: auth, validation, routing, receipts, event persistence
        |
        | NDJSON over 127.0.0.1 + per-start random token
        v
AgentHost: AgentSessions, CLI children, ACP sessions, pending events
```

Codex remains on its shared app-server path. The host handles Claude, Antigravity, Grok, DeepSeek, Hermes, OpenCode, and ZCode. ZCode uses its native app-server adapter and can share the native runtime with the desktop.

## Ownership And Startup

- `server/src/agentHost.ts` creates `AgentSessions`, loads the shared `state.sqlite`, and publishes agent events through `AgentHostServer`.
- `server/src/services/agentHostProtocol.ts` owns the loopback NDJSON protocol, host discovery file, connection/authentication, bounded event replay, and host startup.
- `server/src/services/remoteAgentSessions.ts` implements the Gateway-side `AgentSessionPort` proxy. Keep this proxy and the host method dispatch in `agentHost.ts` aligned when the interface changes.
- Gateway startup attaches to a live host or starts one. The host writes `~/.codex-mobile-control/agent-host.json` atomically; it contains a short-lived local token and must not be copied into logs, docs, or releases.
- The host exits after 30 minutes without clients or active CLI turns. If its version is older than the Gateway, it stays alive until its active turns finish, then restarts on demand.
- During that drain, ZCode can use a current scoped host recorded in `agent-host-zcode.json`. Its token and startup lock are separate from the primary host. Catalog, submission, approval, question, and interruption requests follow the same owning client; connecting another host does not replace the primary's running-thread set.
- Once the primary upgrades, new work returns to it. Existing scoped turns finish on their owner; an idle scoped connection is released, and its host exits after roughly one minute without clients or tasks. Scoped startup does not reset other hosts' persisted threads. ZCode lifecycle recovery uses native state rather than assuming a host restart stopped the desktop task.

## Restart And Resume

After migration from the old in-process Gateway, already-running CLI processes cannot be adopted by the new host. The first restart interrupts those turns; the original CLI conversation/session IDs and saved history remain available. Resume the same Gateway thread with `thread.resume`, then submit the continuation with `turn.start` and the same `threadId`. Do not create a new thread unless the original native session is unavailable.

Once a thread is hosted, restarting only the Gateway disconnects the proxy socket. The CLI process continues in AgentHost; on reconnect, the Gateway restores the running-thread set and replays unacknowledged events. A host process restart is different: active turns owned by that host are interrupted and require the normal same-thread resume flow.

`Update-InstalledGateway.ps1` checks active requests and agent turns before replacing files. Do not bypass this guard. For the one-time legacy migration, checkpoint the active task, request/allow its interruption, update, verify `/health`, then resume the same thread. The shared Codex app-server is separate and should not be restarted as part of this operation.

## Protocol

The host listens only on `127.0.0.1` using an ephemeral port. A random token authenticates the Gateway connection. Messages are newline-delimited JSON:

- `hello` / `ready`: authenticate and report host version, PID, running threads, and event sequence.
- `request` / `response`: invoke a named agent-session operation and return its result or error.
- `event`: forward a Gateway event with a monotonically increasing sequence.
- `ack`: discard replay entries already persisted by the Gateway.
- `thread-created`: associate a newly allocated thread with its submission receipt.

The host retains at most 4,000 unacknowledged events. The Gateway acknowledges only after receiving the event; durable storage and normal history reads remain Gateway responsibilities.

## Change And Verification Guide

When changing agent lifecycle, event delivery, or settings:

1. Update the `AgentSessionPort` contract and both `AgentSessions` and `RemoteAgentSessions` implementations.
2. Add or adjust host dispatch in `agentHost.ts` for each new method.
3. Cover disconnect/reconnect, event replay/ack, running-thread recovery, and thread creation receipt behavior in focused tests.
4. Run `npm run build` in `server` and the relevant checks such as `agent-process-regressions.mjs` and `agy477-behaviour.test.mjs`.
5. Before installing, inspect active threads and pending requests; after installation, check Gateway `/health`, host PID/version, and same-thread resume behavior.

The Gateway deployment replaces the installed runtime, so review the exact source/build being deployed and preserve the pre-update backup. Do not interpret a successful TypeScript build or host fixture test as proof that an actual CLI turn survived a live restart.
