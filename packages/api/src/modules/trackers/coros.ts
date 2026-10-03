/**
 * COROS tracker integration (prototype, self-service tier).
 *
 * Uses COROS's MCP endpoint with standard OAuth 2.1: dynamic client
 * registration, PKCE authorization-code flow, refresh tokens. Workout sync
 * goes through the MCP tools (querySportRecords → FIT download) and reuses
 * the existing FIT import pipeline, so synced runs land as normal
 * activities with source=COROS and per-activity dedup.
 *
 * No cost, no application needed. Limits of this tier: single-user
 * authorization (each athlete connects their own COROS account) and no
 * webhooks, so Curvelo polls for new workouts.
 */
import { createHash, randomBytes } from "crypto";
import { db } from "../../db.js";
import { decryptToken, encryptToken } from "../../lib/trackerTokens.js";
import { config } from "../../config.js";

const PROVIDER = "COROS";

function baseUrl(): string {
  return (process.env.COROS_MCP_URL ?? "https://mcpus.coros.com").replace(/\/$/, "");
}

function mcpUrl(): string {
  return `${baseUrl()}/mcp`;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text };
    }
    if (!res.ok) {
      throw new Error(`COROS request failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
}

let discoveryCache: Discovery | null = null;

export async function discoverOAuth(): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const base = baseUrl();
  const protectedResource = await fetchJson(`${base}/.well-known/oauth-protected-resource`);
  const authServers: string[] = protectedResource.authorization_servers ?? [base];
  const meta = await fetchJson(
    `${authServers[0].replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
  );
  discoveryCache = {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    revocationEndpoint: meta.revocation_endpoint,
    registrationEndpoint: meta.registration_endpoint,
  };
  return discoveryCache;
}

/** Dynamic client registration (OAuth 2.1); the client_id is cached in the DB. */
export async function getOAuthClientId(redirectUri: string): Promise<string> {
  const existing = await db.trackerOAuthClient.findUnique({ where: { provider: PROVIDER } });
  if (existing) return existing.clientId;
  const { registrationEndpoint } = await discoverOAuth();
  if (!registrationEndpoint) throw new Error("COROS server does not support dynamic registration");
  const reg = await fetchJson(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "Stride Sense",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid mcp.tools offline_access",
    }),
  });
  if (!reg.client_id) throw new Error("COROS client registration failed");
  await db.trackerOAuthClient.upsert({
    where: { provider: PROVIDER },
    create: { provider: PROVIDER, clientId: reg.client_id },
    update: { clientId: reg.client_id },
  });
  return reg.client_id as string;
}

export function newCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export async function buildAuthorizeUrl(opts: {
  state: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const { authorizationEndpoint } = await discoverOAuth();
  const clientId = await getOAuthClientId(opts.redirectUri);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: "openid mcp.tools offline_access",
    state: opts.state,
    code_challenge: codeChallenge(opts.codeVerifier),
    code_challenge_method: "S256",
    resource: baseUrl(),
  });
  return `${authorizationEndpoint}?${params.toString()}`;
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const { tokenEndpoint } = await discoverOAuth();
  const data = await fetchJson(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!data.access_token) throw new Error("COROS token request failed");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const clientId = await getOAuthClientId(opts.redirectUri);
  return tokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: clientId,
    code_verifier: opts.codeVerifier,
  });
}

export async function refreshTokenSet(refreshToken: string): Promise<TokenSet> {
  // client_id lookup needs a redirectUri; use the stored one via any client.
  const client = await db.trackerOAuthClient.findUnique({ where: { provider: PROVIDER } });
  if (!client) throw new Error("No COROS OAuth client registered");
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.clientId,
  });
}

export async function revokeToken(token: string): Promise<void> {
  try {
    const { revocationEndpoint } = await discoverOAuth();
    if (!revocationEndpoint) return;
    const client = await db.trackerOAuthClient.findUnique({ where: { provider: PROVIDER } });
    await fetchJson(
      revocationEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token,
          ...(client ? { client_id: client.clientId } : {}),
        }).toString(),
      },
      8000,
    );
  } catch {
    // Best-effort; the connection row is deleted regardless.
  }
}

// ---------------------------------------------------------------------------
// Authenticated MCP calls
// ---------------------------------------------------------------------------

let rpcId = 1;

/** JSON-RPC tools/call against the COROS MCP endpoint. */
export async function mcpCall(
  accessToken: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const body = {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "tools/call",
    params: { name: tool, arguments: args },
  };
  const res = await fetchJson(
    mcpUrl(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
    30000,
  );
  if (res.error) {
    throw new Error(`COROS tool ${tool} failed: ${JSON.stringify(res.error).slice(0, 300)}`);
  }
  return res.result;
}

/** Extract text payloads from an MCP tool result. */
export function mcpTextContent(result: any): string[] {
  const items = result?.content ?? [];
  const out: string[] = [];
  for (const item of items) {
    if (item?.type === "text" && typeof item.text === "string") out.push(item.text);
    // Some servers embed JSON in a single text block; keep each block separate.
    if (item?.type === "resource" && item?.resource?.text) out.push(item.resource.text);
  }
  return out;
}

export interface CorosActivityRecord {
  id: string;
  raw: any;
}

function extractRecords(texts: string[]): CorosActivityRecord[] {
  const records: CorosActivityRecord[] = [];
  for (const t of texts) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
        ? parsed.records
        : Array.isArray(parsed?.activities)
          ? parsed.activities
          : null;
    if (!list) continue;
    for (const r of list) {
      const id =
        r.activityId ?? r.id ?? r.workoutId ?? r.labelId ?? r.dataId ?? null;
      if (id != null) records.push({ id: String(id), raw: r });
    }
  }
  return records;
}

/**
 * Query COROS activities in [startIso, endIso]. The exact argument names come
 * from the tool's input schema; we probe tools/list first and adapt.
 */
export async function querySportRecords(
  accessToken: string,
  startIso: string,
  endIso: string,
): Promise<CorosActivityRecord[]> {
  // Discover the tool schema so arg names stay correct if COROS evolves them.
  let schema: any = null;
  try {
    const listRes = await fetchJson(
      mcpUrl(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} }),
      },
      20000,
    );
    const tools = listRes?.result?.tools ?? [];
    const q = tools.find((t: any) => t.name === "querySportRecords");
    schema = q?.inputSchema?.properties ?? null;
  } catch {
    // Fall through to best-guess args.
  }

  const pick = (candidates: string[]): string | null => {
    if (!schema) return null;
    for (const c of candidates) if (schema[c]) return c;
    return null;
  };
  const startKey = pick(["startDate", "startTime", "beginDate", "from"]) ?? "startDate";
  const endKey = pick(["endDate", "endTime", "finishDate", "to"]) ?? "endDate";

  const result = await mcpCall(accessToken, "querySportRecords", {
    [startKey]: startIso.slice(0, 10),
    [endKey]: endIso.slice(0, 10),
  });
  return extractRecords(mcpTextContent(result));
}

/**
 * Download a FIT file for an activity. Tries the binary tool first, then the
 * download-URL tool as a fallback.
 */
export async function downloadActivityFit(
  accessToken: string,
  activityId: string,
): Promise<Buffer | null> {
  // 1) Direct download tool.
  try {
    const result = await mcpCall(accessToken, "downloadActivityFitFiles", {
      activityIds: [activityId],
    });
    const items = result?.content ?? [];
    for (const item of items) {
      if (item?.type === "blob" && item?.data) {
        return Buffer.from(item.data, "base64");
      }
      if (item?.type === "resource" && item?.resource?.blob) {
        return Buffer.from(item.resource.blob, "base64");
      }
      if (typeof item?.text === "string") {
        const t = item.text.trim();
        // Raw base64 payload.
        if (/^[A-Za-z0-9+/=\s]+$/.test(t) && t.length > 1000) {
          return Buffer.from(t.replace(/\s/g, ""), "base64");
        }
      }
    }
  } catch {
    // Fall through to URL-based download.
  }

  // 2) Download URLs, then fetch with the bearer token.
  try {
    const result = await mcpCall(accessToken, "queryActivityFitFileDownloadUrls", {
      activityIds: [activityId],
    });
    const urls: string[] = [];
    for (const t of mcpTextContent(result)) {
      try {
        const p = JSON.parse(t);
        const list = Array.isArray(p) ? p : p.urls ?? p.downloadUrls ?? [];
        for (const u of list) {
          const url = typeof u === "string" ? u : u.url;
          if (url) urls.push(url);
        }
      } catch {
        const m = t.match(/https?:\/\/[^\s"']+/g);
        if (m) urls.push(...m);
      }
    }
    for (const url of urls.slice(0, 3)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: ctrl.signal,
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 100) return buf;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // No FIT available for this activity.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

export function redirectUri(): string {
  const web = (config.webUrl ?? "https://curvelo.onrender.com").replace(/\/$/, "");
  return `${web}/api/v1/trackers/coros/callback`;
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await db.trackerConnection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!conn) throw new Error("COROS not connected");
  const skewMs = 60_000;
  if (conn.expiresAt && conn.expiresAt.getTime() - skewMs < Date.now() && conn.refreshToken) {
    const tokens = await refreshTokenSet(decryptToken(conn.refreshToken));
    await db.trackerConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: encryptToken(tokens.accessToken),
        ...(tokens.refreshToken ? { refreshToken: encryptToken(tokens.refreshToken) } : {}),
        expiresAt: tokens.expiresIn
          ? new Date(Date.now() + tokens.expiresIn * 1000)
          : conn.expiresAt,
      },
    });
    return tokens.accessToken;
  }
  return decryptToken(conn.accessToken);
}

export async function getConnectionStatus(userId: string): Promise<{
  connected: boolean;
  lastSyncAt: string | null;
} | null> {
  const conn = await db.trackerConnection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  });
  if (!conn) return { connected: false, lastSyncAt: null };
  return { connected: true, lastSyncAt: conn.lastSyncAt?.toISOString() ?? null };
}
