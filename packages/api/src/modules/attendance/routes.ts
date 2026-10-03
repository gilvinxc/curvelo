import type { FastifyInstance } from "fastify";
import { saveAttendanceSchema, teamParamsSchema } from "@curvelo/shared";
import { z } from "zod";
import { getAttendance, listAttendance, saveAttendance } from "./service.js";

const attendanceParams = z.object({ attendanceId: z.string().uuid() });

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/teams/:id/attendance",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = saveAttendanceSchema.parse(request.body);
      const attendance = await saveAttendance(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ attendance });
    },
  );

  app.get(
    "/teams/:id/attendance",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const attendance = await listAttendance(request.user!.id, id);
      return reply.send({ attendance });
    },
  );

  app.get(
    "/teams/:id/attendance/:attendanceId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { attendanceId } = attendanceParams.parse(request.params);
      const attendance = await getAttendance(request.user!.id, id, attendanceId);
      return reply.send({ attendance });
    },
  );
}
