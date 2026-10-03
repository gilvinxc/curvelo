import type { FastifyInstance } from "fastify";
import {
  createRaceResultSchema,
  createShoeSchema,
  lineupQuerySchema,
  logTeamRaceSchema,
  raceResultParamsSchema,
  shoeParamsSchema,
  teamParamsSchema,
  updateShoeSchema,
} from "@curvelo/shared";
import {
  createRaceResult,
  createShoe,
  deleteRaceResult,
  deleteShoe,
  getPersonalRecords,
  getLineup,
  getTeamRecords,
  listMyRaceResults,
  listShoes,
  logTeamRaceResults,
  setDefaultShoe,
  updateShoe,
} from "./service.js";

export async function recordRoutes(app: FastifyInstance) {
  // ---- Race results (official, exact) ----
  app.post(
    "/race-results",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const input = createRaceResultSchema.parse(request.body);
      const result = await createRaceResult(request.user!.id, input, request.ip);
      return reply.code(201).send({ raceResult: result });
    },
  );

  // Coach bulk entry: official results for many athletes in one race.
  app.post(
    "/race-results/team-log",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const input = logTeamRaceSchema.parse(request.body);
      const result = await logTeamRaceResults(request.user!.id, input, request.ip);
      return reply.code(201).send(result);
    },
  );

  // Lineup helper: runners ranked by best time at one distance (coach only).
  app.get(
    "/teams/:id/lineup",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { distanceM } = lineupQuerySchema.parse(request.query);
      return reply.send({
        lineup: await getLineup(request.user!.id, id, distanceM),
      });
    },
  );

  app.get(
    "/race-results",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      return reply.send({ raceResults: await listMyRaceResults(request.user!.id) });
    },
  );

  app.delete(
    "/race-results/:raceResultId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { raceResultId } = raceResultParamsSchema.parse(request.params);
      return reply.send(await deleteRaceResult(request.user!.id, raceResultId, request.ip));
    },
  );

  // ---- Personal records ----
  app.get(
    "/users/me/records",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      return reply.send({ records: await getPersonalRecords(request.user!.id) });
    },
  );

  // ---- Team records ----
  app.get(
    "/teams/:id/records",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      return reply.send({ records: await getTeamRecords(request.user!.id, id) });
    },
  );

  // ---- Shoes ----
  app.post("/shoes", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = createShoeSchema.parse(request.body);
    const shoe = await createShoe(request.user!.id, input, request.ip);
    return reply.code(201).send({ shoe });
  });

  app.get("/shoes", { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.send({ shoes: await listShoes(request.user!.id) });
  });

  app.patch(
    "/shoes/:shoeId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { shoeId } = shoeParamsSchema.parse(request.params);
      const input = updateShoeSchema.parse(request.body);
      const shoe = await updateShoe(request.user!.id, shoeId, input, request.ip);
      return reply.send({ shoe });
    },
  );

  app.post(
    "/shoes/:shoeId/default",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { shoeId } = shoeParamsSchema.parse(request.params);
      const shoe = await setDefaultShoe(request.user!.id, shoeId, request.ip);
      return reply.send({ shoe });
    },
  );

  app.delete(
    "/shoes/:shoeId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { shoeId } = shoeParamsSchema.parse(request.params);
      return reply.send(await deleteShoe(request.user!.id, shoeId, request.ip));
    },
  );
}
