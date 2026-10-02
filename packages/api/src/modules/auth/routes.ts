import type { FastifyInstance } from "fastify";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
} from "@curvelo/shared";
import { config } from "../../config.js";
import { getSession, login, logout, refresh, register } from "./service.js";

const ACCESS_COOKIE = "cv_access";
const REFRESH_COOKIE = "cv_refresh";

function setSessionCookies(
  reply: import("fastify").FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const base = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  };
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: config.accessTtlSec,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: config.refreshTtlSec,
  });
}

function clearSessionCookies(reply: import("fastify").FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
}

const authRateLimit = {
  config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/register", authRateLimit, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const { user, tokens } = await register(body, request.ip);
    setSessionCookies(reply, tokens);
    return reply.status(201).send({ user });
  });

  app.post("/login", authRateLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { user, tokens } = await login(body, request.ip);
    setSessionCookies(reply, tokens);
    return reply.send({ user });
  });

  app.post("/refresh", async (request, reply) => {
    // Cookie-first (web), body fallback (native clients later).
    const fromCookie = request.cookies?.[REFRESH_COOKIE];
    const parsed = refreshSchema.safeParse(
      fromCookie ? { refreshToken: fromCookie } : request.body,
    );
    if (!parsed.success) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }
    const { user, tokens } = await refresh(parsed.data.refreshToken, request.ip);
    setSessionCookies(reply, tokens);
    return reply.send({ user });
  });

  app.post("/logout", async (request, reply) => {
    await logout(request.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(reply);
    return reply.send({ ok: true });
  });

  app.get(
    "/me",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const user = await getSession(request.user!.id);
      return reply.send({ user });
    },
  );
}
