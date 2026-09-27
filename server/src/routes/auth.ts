import type { FastifyReply, FastifyRequest } from "fastify";
import type { StateStore } from "../services/stateStore.js";

export function isAuthorized(request: FastifyRequest, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return header.slice("Bearer ".length) === token;
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

export function isAuthorizedWithDevices(request: FastifyRequest, adminToken: string, store: StateStore, queryToken?: string | null): boolean {
  const headerToken = bearerToken(request);
  const token = headerToken ?? queryToken ?? null;
  if (!token) {
    return false;
  }
  return token === adminToken || store.isValidDeviceToken(token);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply, token: string): Promise<void> {
  if (!isAuthorized(request, token)) {
    await reply.code(401).send({ error: "unauthorized" });
  }
}
