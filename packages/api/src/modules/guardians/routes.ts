import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  acceptGuardianInviteSchema,
  athleteGuardianParamsSchema,
  createActivitySchema,
  guardianInviteParamsSchema,
  guardianLinkParamsSchema,
  inviteGuardianSchema,
} from "@curvelo/shared";
import {
  acceptInvite,
  familyCalendar,
  guardianTeams,
  inviteGuardian,
  listAthleteGuardians,
  logActivityForChild,
  myChildren,
  photoConsentStatus,
  previewInvite,
  revokeLink,
  setPhotoConsent,
} from "./service.js";

const childParamsSchema = z.object({ athleteId: z.string().uuid() });
const calendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const photoConsentSchema = z.object({ granted: z.boolean() });

export async function guardianRoutes(app: FastifyInstance): Promise<void> {
  // Coach invites a parent/guardian for an athlete.
  app.post(
    "/teams/:id/athletes/:userId/guardians/invite",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteGuardianParamsSchema.parse(request.params);
      const body = inviteGuardianSchema.parse(request.body);
      const invite = await inviteGuardian(
        request.user!.id,
        id,
        userId,
        body,
        request.ip,
      );
      return reply.status(201).send({ invite });
    },
  );

  // Coach views an athlete's guardians + consents.
  app.get(
    "/teams/:id/athletes/:userId/guardians",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteGuardianParamsSchema.parse(request.params);
      const result = await listAthleteGuardians(request.user!.id, id, userId);
      return reply.send(result);
    },
  );

  // Public invite preview (no auth).
  app.get(
    "/guardian-invites/:token/preview",
    async (request, reply) => {
      const { token } = guardianInviteParamsSchema.parse(request.params);
      const invite = await previewInvite(token);
      return reply.send({ invite });
    },
  );

  // Parent accepts (email must match the invite).
  app.post(
    "/guardian-invites/:token/accept",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { token } = guardianInviteParamsSchema.parse(request.params);
      const body = acceptGuardianInviteSchema.parse(request.body);
      const link = await acceptInvite(request.user!.id, token, body, request.ip);
      return reply.send({ link });
    },
  );

  // Revoke a guardian link (guardian themselves or a coach/admin).
  app.delete(
    "/guardian-links/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = guardianLinkParamsSchema.parse(request.params);
      await revokeLink(request.user!.id, id, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Parent view: my linked athletes.
  app.get(
    "/users/me/children",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const children = await myChildren(request.user!.id);
      return reply.send({ children });
    },
  );

  // Guardian logs an activity on behalf of a linked athlete.
  app.post(
    "/guardian/children/:athleteId/activities",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { athleteId } = childParamsSchema.parse(request.params);
      const body = createActivitySchema.parse(request.body);
      const activity = await logActivityForChild(
        request.user!.id,
        athleteId,
        body,
        request.ip,
      );
      return reply.status(201).send({ activity });
    },
  );

  // Guardian's merged family calendar.
  app.get(
    "/guardian/calendar",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { from, to } = calendarQuerySchema.parse(request.query);
      return { items: await familyCalendar(request.user!.id, from, to) };
    },
  );

  // Teams the guardian follows via linked athletes (feed access).
  app.get(
    "/guardian/teams",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { teams: await guardianTeams(request.user!.id) };
    },
  );

  // Photo-sharing consent for a linked athlete.
  app.get(
    "/guardian/photo-consent",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { consents: await photoConsentStatus(request.user!.id) };
    },
  );
  app.post(
    "/guardian/children/:athleteId/photo-consent",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { athleteId } = childParamsSchema.parse(request.params);
      const { granted } = photoConsentSchema.parse(request.body);
      return setPhotoConsent(request.user!.id, athleteId, granted, request.ip);
    },
  );
}
