import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { db } from "../../db.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { encryptToken } from "../../lib/trackerTokens.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  getConnectionStatus,
  newCodeVerifier,
  newState,
  redirectUri,
  revokeToken,
} from "./coros.js";
import { decryptToken } from "../../lib/trackerTokens.js";
import { syncCorosForUser } from "./sync.js";

const PROVIDER = "COROS";
const STATE_TTL_MS = 10 * 60 * 1000;

function webUrl(): string {
  return (config.webUrl ?? "https://curvelo.onrender.com").replace(/\/$/, "");
}

export async function trackerRoutes(app: FastifyInstance): Promise<void> {
  // Connection status for all providers (currently just COROS).
  app.get("/trackers/status", { onRequest: [app.authenticate] }, async (request) => {
    const coros = await getConnectionStatus(request.user!.id);
    return { trackers: [{ provider: PROVIDER, ...coros }] };
  });

  // Step 1: redirect the athlete to COROS to authorize.
  app.get("/trackers/coros/connect", { onRequest: [app.authenticate] }, async (request, reply) => {
    const state = newState();
    const codeVerifier = newCodeVerifier();
    const uri = redirectUri();
    await db.trackerOAuthState.create({
      data: {
        state,
        userId: request.user!.id,
        provider: PROVIDER,
        codeVerifier,
        redirectUri: uri,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    const url = await buildAuthorizeUrl({ state, codeVerifier, redirectUri: uri });
    return reply.redirect(url);
  });

  // Step 2: COROS redirects back here; exchange the code and store tokens.
  app.get("/trackers/coros/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const fail = (reason: string) =>
      reply.redirect(`${webUrl()}/settings?tracker=coros&error=${encodeURIComponent(reason)}`);

    if (q.error || !q.code || !q.state) return fail(q.error ?? "authorization_failed");
    const saved = await db.trackerOAuthState.findUnique({ where: { state: q.state } });
    if (!saved || saved.expiresAt.getTime() < Date.now()) return fail("session_expired");
    await db.trackerOAuthState.delete({ where: { state: q.state } }).catch(() => {});

    try {
      const tokens = await exchangeCode({
        code: q.code,
        codeVerifier: saved.codeVerifier,
        redirectUri: saved.redirectUri,
      });
      await db.trackerConnection.upsert({
        where: { userId_provider: { userId: saved.userId, provider: PROVIDER } },
        create: {
          userId: saved.userId,
          provider: PROVIDER,
          accessToken: encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        },
        update: {
          accessToken: encryptToken(tokens.accessToken),
          refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        },
      });
      await audit({
        actorId: saved.userId,
        action: "TRACKER_CONNECTED",
        entityType: "TrackerConnection",
        entityId: PROVIDER,
        metadata: { provider: PROVIDER },
      });
      return reply.redirect(`${webUrl()}/settings?tracker=coros&connected=1`);
    } catch (err) {
      return fail("token_exchange_failed");
    }
  });

  // Manual sync.
  app.post("/trackers/coros/sync", { onRequest: [app.authenticate] }, async (request) => {
    const result = await syncCorosForUser(request.user!.id);
    return { result };
  });

  // Disconnect (revoke at COROS, delete stored tokens).
  app.delete("/trackers/coros", { onRequest: [app.authenticate] }, async (request) => {
    const conn = await db.trackerConnection.findUnique({
      where: { userId_provider: { userId: request.user!.id, provider: PROVIDER } },
    });
    if (conn) {
      try {
        await revokeToken(decryptToken(conn.accessToken));
      } catch {
        // Continue with local deletion.
      }
      await db.trackerConnection.delete({ where: { id: conn.id } });
      await audit({
        actorId: request.user!.id,
        action: "TRACKER_DISCONNECTED",
        entityType: "TrackerConnection",
        entityId: PROVIDER,
        metadata: { provider: PROVIDER },
      });
    }
    return { ok: true };
  });
}
