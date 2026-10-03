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
  listTeams,
  listUsers,
  requireSystemAdmin,
  updateUser,
} from "./service.js";

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
