import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import {
  adminAuditQuerySchema,
  adminUpdateUserSchema,
  adminUserParamsSchema,
  adminUsersQuerySchema,
} from "@curvelo/shared";
import {
  adminStats,
  auditLog,
  exitImpersonation,
  impersonateUser,
  listTeams,
  listUsers,
  requireSystemAdmin,
  updateUser,
} from "./service.js";
import { setSessionCookies } from "../auth/routes.js";

export async function adminRoutes(app: FastifyInstance) {
  const sysAdmin = async (request: import("fastify").FastifyRequest) => {
    await requireSystemAdmin(request.user!.id);
  };

  app.get(
    "/admin/stats",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => ({ stats: await adminStats(request.user!.id) }),
  );

  app.get(
    "/admin/users",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => {
      const q = adminUsersQuerySchema.parse(request.query);
      return listUsers(request.user!.id, q);
    },
  );

  app.patch(
    "/admin/users/:userId",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => {
      const { userId } = adminUserParamsSchema.parse(request.params);
      const input = adminUpdateUserSchema.parse(request.body);
      return {
        user: await updateUser(request.user!.id, userId, input, request.ip),
      };
    },
  );

  // "View as": open a session as another user. The cookies are switched to
  // the target's session (marked as impersonated); the admin exits back via
  // POST /admin/impersonate/exit. Both start and end are audit-logged.
  app.post(
    "/admin/users/:userId/impersonate",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request, reply) => {
      const { userId } = adminUserParamsSchema.parse(request.params);
      const { user, tokens } = await impersonateUser(
        request.user!.id,
        userId,
        request.ip,
      );
      setSessionCookies(reply, tokens);
      return reply.send({ user, impersonated: true });
    },
  );

  // Exit impersonation. Deliberately NOT sysAdmin-gated: the caller is the
  // impersonated user. The service verifies the signed session claim and
  // restores the originating admin.
  app.post(
    "/admin/impersonate/exit",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { user, tokens } = await exitImpersonation(
        request.user!.id,
        request.user!.impersonatedByAdminId,
        request.ip,
      );
      setSessionCookies(reply, tokens);
      return reply.send({ user, impersonated: false });
    },
  );

  app.get(
    "/admin/teams",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => ({ teams: await listTeams(request.user!.id) }),
  );

  app.get(
    "/admin/audit",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => {
      const q = adminAuditQuerySchema.parse(request.query);
      return auditLog(request.user!.id, q);
    },
  );

  app.get(
    "/admin/feedback",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => {
      const q = z
        .object({ status: z.enum(["OPEN", "REVIEWED", "RESOLVED"]).optional() })
        .parse(request.query);
      const items = await db.feedback.findMany({
        where: q.status ? { status: q.status } : {},
        include: {
          user: { select: { displayName: true } },
          team: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return {
        feedback: items.map((f) => ({
          id: f.id,
          userName: f.user.displayName,
          teamName: f.team?.name ?? null,
          category: f.category,
          body: f.body,
          status: f.status,
          createdAt: f.createdAt.toISOString(),
        })),
      };
    },
  );

  app.patch(
    "/admin/feedback/:id",
    { preHandler: [app.authenticate, sysAdmin] },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({ status: z.enum(["OPEN", "REVIEWED", "RESOLVED"]) })
        .parse(request.body);
      const updated = await db.feedback.update({
        where: { id },
        data: { status: body.status },
      });
      return { ok: true, status: updated.status };
    },
  );
}
