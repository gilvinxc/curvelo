import type { FastifyInstance } from "fastify";
import {
  createTeamSchema,
  setTeamLogoSchema,
  teamMemberParamsSchema,
  teamParamsSchema,
  transferTeamSchema,
  updateMemberRoleSchema,
  updateTeamSchema,
} from "@curvelo/shared";
import {
  createTeam,
  getRoster,
  getTeam,
  getTeamLogo,
  listMyTeams,
  leaveTeam,
  removeMember,
  removeTeamLogo,
  setTeamLogo,
  transferTeam,
  updateMemberRole,
  updateTeam,
} from "./service.js";
import { teamHealth } from "../health/service.js";

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = createTeamSchema.parse(request.body);
      const team = await createTeam(request.user!.id, body, request.ip);
      return reply.status(201).send({ team });
    },
  );

  app.get("/", { preHandler: [app.authenticate] }, async (request, reply) => {
    const teams = await listMyTeams(request.user!.id);
    return reply.send({ teams });
  });

  app.get(
    "/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const team = await getTeam(request.user!.id, id);
      return reply.send({ team });
    },
  );

  app.patch(
    "/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = updateTeamSchema.parse(request.body);
      const team = await updateTeam(request.user!.id, id, body, request.ip);
      return reply.send({ team });
    },
  );

  app.get(
    "/:id/roster",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const roster = await getRoster(request.user!.id, id);
      return reply.send({ roster });
    },
  );

  app.get(
    "/:id/health",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const health = await teamHealth(request.user!.id, id);
      return reply.send({ health });
    },
  );

  app.patch(
    "/:id/members/:userId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = teamMemberParamsSchema.parse(request.params);
      const body = updateMemberRoleSchema.parse(request.body);
      const result = await updateMemberRole(
        request.user!.id,
        id,
        userId,
        body.role,
        request.ip,
      );
      return reply.send(result);
    },
  );

  app.delete(
    "/:id/members/:userId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = teamMemberParamsSchema.parse(request.params);
      const result = await removeMember(request.user!.id, id, userId, request.ip);
      return reply.send(result);
    },
  );

  app.post(
    "/:id/leave",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = (request.body ?? {}) as { content?: "keep" | "remove" };
      const content = body.content === "remove" ? "remove" : "keep";
      await leaveTeam(request.user!.id, id, request.ip, content);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/:id/transfer",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = transferTeamSchema.parse(request.body);
      const result = await transferTeam(
        request.user!.id,
        id,
        body.newOwnerId,
        request.ip,
      );
      return reply.send(result);
    },
  );

  app.put(
    "/:id/logo",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = setTeamLogoSchema.parse(request.body);
      const result = await setTeamLogo(request.user!.id, id, body.image, request.ip);
      return reply.send(result);
    },
  );

  app.delete(
    "/:id/logo",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const result = await removeTeamLogo(request.user!.id, id, request.ip);
      return reply.send(result);
    },
  );

  app.get(
    "/:id/logo",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { image, mime } = await getTeamLogo(request.user!.id, id);
      return reply.header("Content-Type", mime).header("Cache-Control", "public, max-age=3600").send(image);
    },
  );
}
