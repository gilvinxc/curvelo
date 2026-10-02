import type { FastifyInstance } from "fastify";
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
}
