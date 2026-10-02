import type { FastifyInstance } from "fastify";
import {
  addGroupMembersSchema,
  createGroupSchema,
  groupParamsSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  removeGroupMember,
} from "./service.js";

const memberParams = z.object({
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/teams/:id/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createGroupSchema.parse(request.body);
      const group = await createGroup(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ group });
    },
  );

  app.get(
    "/teams/:id/groups",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const groups = await listGroups(request.user!.id, id);
      return reply.send({ groups });
    },
  );

  app.get(
    "/groups/:groupId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId } = groupParamsSchema.parse(request.params);
      const group = await getGroup(request.user!.id, groupId);
      return reply.send({ group });
    },
  );

  app.post(
    "/groups/:groupId/members",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId } = groupParamsSchema.parse(request.params);
      const body = addGroupMembersSchema.parse(request.body);
      const group = await addGroupMembers(request.user!.id, groupId, body, request.ip);
      return reply.send({ group });
    },
  );

  app.delete(
    "/groups/:groupId/members/:userId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId, userId } = memberParams.parse(request.params);
      const group = await removeGroupMember(request.user!.id, groupId, userId, request.ip);
      return reply.send({ group });
    },
  );

  app.delete(
    "/groups/:groupId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { groupId } = groupParamsSchema.parse(request.params);
      await deleteGroup(request.user!.id, groupId, request.ip);
      return reply.send({ ok: true });
    },
  );
}
