import type { FastifyInstance } from "fastify";
import {
  conversationParamsSchema,
  editMessageSchema,
  messageParamsSchema,
  messagesQuerySchema,
  sendMessageSchema,
  teamConversationsParamsSchema,
} from "@curvelo/shared";
import {
  deleteMessage,
  editMessage,
  listConversations,
  listMessages,
  postMessage,
} from "./service.js";

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/teams/:id/conversations",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamConversationsParamsSchema.parse(request.params);
      const conversations = await listConversations(request.user!.id, id);
      return reply.send({ conversations });
    },
  );

  app.get(
    "/teams/:id/conversations/:convId/messages",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, convId } = conversationParamsSchema.parse(request.params);
      const { before, limit } = messagesQuerySchema.parse(request.query);
      const result = await listMessages(request.user!.id, id, convId, before, limit);
      return reply.send(result);
    },
  );

  app.post(
    "/teams/:id/conversations/:convId/messages",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, convId } = conversationParamsSchema.parse(request.params);
      const body = sendMessageSchema.parse(request.body);
      const message = await postMessage(
        request.user!.id,
        id,
        convId,
        body,
        request.ip,
      );
      return reply.status(201).send({ message });
    },
  );

  app.patch(
    "/messages/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = messageParamsSchema.parse(request.params);
      const { body } = editMessageSchema.parse(request.body);
      const message = await editMessage(request.user!.id, id, body, request.ip);
      return reply.send({ message });
    },
  );

  app.delete(
    "/messages/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = messageParamsSchema.parse(request.params);
      await deleteMessage(request.user!.id, id, request.ip);
      return reply.send({ ok: true });
    },
  );
}
