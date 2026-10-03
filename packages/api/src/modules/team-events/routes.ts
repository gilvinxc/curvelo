import type { FastifyInstance } from "fastify";
import {
  createTeamEventSchema,
  teamParamsSchema,
  updateTeamEventSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  createTeamEvent,
  deleteTeamEvent,
  listTeamEvents,
  myTeamEvents,
  updateTeamEvent,
} from "./service.js";
import { db } from "../../db.js";
import { activeMembership } from "../../lib/permissions.js";
import { forbidden } from "../../lib/errors.js";

const eventParams = z.object({ eventId: z.string().uuid() });
const rangeQuery = z.object({ from: z.string().date(), to: z.string().date() });

export async function teamEventRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/teams/:id/events",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { from, to } = rangeQuery.parse(request.query);
      const events = await listTeamEvents(request.user!.id, id, from, to);
      return { events };
    },
  );

  // Unified personal calendar: events across all my teams.
  app.get(
    "/team-events/mine",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { from, to } = rangeQuery.parse(request.query);
      const events = await myTeamEvents(request.user!.id, from, to);
      return { events };
    },
  );

  // Meet-entry CSV export for external sites (MileSplit, Athletic.net).
  // Coaches only. One row per runner per selected meet; seed times are
  // blank in v1.
  app.get(
    "/teams/:id/entries/export",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const membership = await activeMembership(request.user!.id, id);
      if (membership.role !== "COACH") {
        throw forbidden("Only coaches can export meet entries");
      }
      const query = z
        .object({ eventIds: z.string().optional() })
        .parse(request.query);
      const eventIds = (query.eventIds ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const team = await db.team.findUniqueOrThrow({ where: { id } });
      const events = await db.teamEvent.findMany({
        where: { id: { in: eventIds }, teamId: id },
        orderBy: { startAt: "asc" },
      });
      const runners = await db.teamMembership.findMany({
        where: { teamId: id, status: "ACTIVE", role: "RUNNER" },
        include: { user: { select: { displayName: true } } },
        orderBy: { joinedAt: "asc" },
      });

      const csvCell = (v: string): string =>
        /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      const splitName = (displayName: string): [string, string] => {
        const parts = displayName.trim().split(/\s+/);
        return [parts[0] ?? "", parts.slice(1).join(" ")];
      };

      const rows: string[] = [
        "first_name,last_name,team_name,event_name,event_date,seed_time",
      ];
      for (const r of runners) {
        const [first, last] = splitName(r.user.displayName);
        if (events.length === 0) {
          rows.push(
            [first, last, team.name, "", "", ""].map(csvCell).join(","),
          );
        } else {
          for (const e of events) {
            rows.push(
              [
                first,
                last,
                team.name,
                e.title,
                e.startAt.toISOString().slice(0, 10),
                "",
              ]
                .map(csvCell)
                .join(","),
            );
          }
        }
      }
      const csv = rows.join("\r\n");
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="meet-entries-${team.slug}.csv"`,
        )
        .send(csv);
    },
  );

  app.post(
    "/teams/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createTeamEventSchema.parse(request.body);
      const event = await createTeamEvent(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ event });
    },
  );

  app.patch(
    "/teams/:id/events/:eventId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { eventId } = eventParams.parse(request.params);
      const body = updateTeamEventSchema.parse(request.body);
      const event = await updateTeamEvent(
        request.user!.id,
        id,
        eventId,
        body,
        request.ip,
      );
      return { event };
    },
  );

  app.delete(
    "/teams/:id/events/:eventId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { eventId } = eventParams.parse(request.params);
      await deleteTeamEvent(request.user!.id, id, eventId, request.ip);
      return reply.send({ ok: true });
    },
  );
}
