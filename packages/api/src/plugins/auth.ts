import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { db } from "../db.js";
import { unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

export interface RequestUser {
  id: string;
  email: string;
  displayName: string;
  systemRole: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user: RequestUser | null;
  }
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

const ACCESS_COOKIE = "cv_access";

/**
 * Wrapped in fastify-plugin (skip-override) so `request.user` and
 * `app.authenticate` are visible to every module route, not just
 * this plugin's encapsulation context.
 *
 * Accepts the access token from the `cv_access` httpOnly cookie (web)
 * or the `Authorization: Bearer` header (future native clients).
 */
export const authPlugin = fp(async function authPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest("user", null);

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const fromCookie = request.cookies?.[ACCESS_COOKIE];
      const fromHeader = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7)
        : undefined;
      const token = fromCookie ?? fromHeader;
      if (!token) throw unauthorized();

      const claims = verifyAccessToken(token);
      const user = await db.user.findUnique({
        where: { id: claims.sub },
        select: {
          id: true,
          email: true,
          displayName: true,
          systemRole: true,
          status: true,
        },
      });
      if (!user || user.status !== "ACTIVE") throw unauthorized();

      request.user = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        systemRole: user.systemRole,
      };
    },
  );
});
