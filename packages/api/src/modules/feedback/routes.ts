import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";

const submitSchema = z.object({
  category: z.enum(["BUG", "FEATURE", "OTHER"]).default("OTHER"),
  body: z.string().trim().min(1).max(5000),
  teamId: z.string().uuid().optional(),
});

function toDTO(f: {
  id: string;
  userId: string;
  user: { displayName: string };
  teamId: string | null;
  team: { name: string } | null;
  category: string;
  body: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: f.id,
    userId: f.userId,
    userName: f.user.displayName,
    teamId: f.teamId,
    teamName: f.team?.name ?? null,
    category: f.category,
    body: f.body,
    status: f.status,
    createdAt: f.createdAt.toISOString(),
  };
}

const INCLUDE = {
  user: { select: { displayName: true } },
  team: { select: { name: true } },
} as const;

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // Submit feedback (any signed-in user).
  app.post(
    "/feedback",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = submitSchema.parse(request.body);
      const feedback = await db.feedback.create({
        data: {
          userId: request.user!.id,
          teamId: body.teamId,
          category: body.category,
          body: body.body,
        },
        include: INCLUDE,
      });
      return reply.status(201).send({ feedback: toDTO(feedback) });
    },
  );

  // My submitted feedback.
  app.get(
    "/feedback/mine",
    { preHandler: [app.authenticate] },
    async (request) => {
      const items = await db.feedback.findMany({
        where: { userId: request.user!.id },
        include: INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      return { feedback: items.map(toDTO) };
    },
  );
}
