import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "./service.js";

const cursorSchema = z.object({ cursor: z.string().optional() });
const idParamsSchema = z.object({ id: z.string().uuid() });

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/notifications",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { cursor } = cursorSchema.parse(request.query);
      return listNotifications(request.user!.id, cursor);
    },
  );

  app.get(
    "/notifications/unread-count",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { unread: await unreadCount(request.user!.id) };
    },
  );

  app.post(
    "/notifications/:id/read",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      await markRead(request.user!.id, id);
      return { ok: true };
    },
  );

  app.post(
    "/notifications/read-all",
    { preHandler: [app.authenticate] },
    async (request) => {
      await markAllRead(request.user!.id);
      return { ok: true };
    },
  );
}
