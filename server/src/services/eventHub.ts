import type { WebSocket } from "ws";
import type { GatewayEvent } from "../types.js";
import type { StateStore } from "./stateStore.js";
import { protocolMetadata } from "../protocol.js";
import { randomUUID } from "node:crypto";

const heartbeatIntervalMs = Number(process.env.CODEX_MOBILE_CONTROL_WS_HEARTBEAT_MS || "25000");

export class EventHub {
  private readonly clients = new Set<WebSocket>();
  private readonly authorizations = new Map<WebSocket, () => boolean>();
  private readonly heartbeatState = new Map<WebSocket, boolean>();
  private readonly heartbeatTimer: NodeJS.Timeout;

  constructor(private readonly store: StateStore) {
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  add(client: WebSocket, authorized: () => boolean = () => true): void {
    this.clients.add(client);
    this.authorizations.set(client, authorized);
    this.heartbeatState.set(client, true);
    client.on("pong", () => this.heartbeatState.set(client, true));
    client.on("close", () => this.remove(client));
    client.on("error", () => this.remove(client));
    const metadata = protocolMetadata();
    this.send(client, {
      type: "connected",
      serverVersion: metadata.version,
      protocolVersion: metadata.protocolVersion,
      minAndroidProtocolVersion: metadata.minAndroidProtocolVersion,
      capabilities: metadata.capabilities,
    });
    for (const event of this.store.events.slice(-100)) {
      this.send(client, { ...event, replayed: true });
    }
  }

  publish(event: GatewayEvent): void {
    event = { ...event, eventId: event.eventId ?? randomUUID(), createdAt: event.createdAt ?? new Date().toISOString() };
    void this.store.appendEvent(event);
    for (const client of this.clients) {
      this.send(client, event);
    }
  }

  closeUnauthorized(): void {
    for (const client of this.clients) {
      if (!this.authorizations.get(client)?.()) { client.close(1008, "unauthorized"); this.remove(client); }
    }
  }

  private send(client: WebSocket, event: GatewayEvent): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(event));
    }
  }

  private checkHeartbeats(): void {
    this.closeUnauthorized();
    for (const client of this.clients) {
      if (client.readyState !== client.OPEN) {
        this.remove(client);
        continue;
      }
      if (this.heartbeatState.get(client) === false) {
        this.remove(client);
        client.terminate();
        continue;
      }
      this.heartbeatState.set(client, false);
      client.ping();
    }
  }

  private remove(client: WebSocket): void {
    this.authorizations.delete(client);
    this.clients.delete(client);
    this.heartbeatState.delete(client);
  }
}
