import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createTeamSchema,
  directoryQuerySchema,
  setTeamLogoSchema,
  teamMemberParamsSchema,
  teamParamsSchema,
  transferTeamSchema,
  updateMemberRoleSchema,
  updateTeamSchema,
} from "@curvelo/shared";
import {
  createTeam,
  discoverTeams,
  findSimilarTeams,
  getPublicTeam,
  getRoster,
  getTeam,
  getTeamLogo,
  listMyTeams,
  listPublicTeams,
  leaveTeam,
  removeMember,
  removeTeamLogo,
  setTeamLogo,
  transferTeam,
  requestJoinDirect,
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

  // Public team directory: paginated, searchable by name/city.
  // Safe fields only — never roster, member counts, feed, or internals.
  app.get(
    "/directory",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = directoryQuerySchema.parse(request.query);
      const result = await listPublicTeams(query);
      return reply.send(result);
    },
  );

  // Public team discovery. Name + description only — no roster or
  // member details leak. Private teams stay unfindable by design.
  app.get(
    "/discover",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { q } = z
        .object({ q: z.string().min(1).max(80) })
        .parse(request.query);
      const teams = await discoverTeams(q);
      return reply.send({ teams });
    },
  );

  // Similar-name lookup for the new-team nudge. Name + description only —
  // no roster or member details leak.
  app.get(
    "/similar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { name } = z
        .object({ name: z.string().min(1).max(80) })
        .parse(request.query);
      const teams = await findSimilarTeams(request.user!.id, name);
      return reply.send({ teams });
    },
  );

  // Public preview of a single PUBLIC team: safe fields only.
  // 404s for private teams. Joining still needs a coach-approved request.
  app.get(
    "/:id/public",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const team = await getPublicTeam(id);
      return reply.send({ team });
    },
  );

  app.get(
    "/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const team = await getTeam(request.user!.id, id);
      return reply.send({ team });
    },
  );

  app.post(
    "/:id/join-requests",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const result = await requestJoinDirect(request.user!.id, id, request.ip);
      return reply.status(201).send(result);
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
