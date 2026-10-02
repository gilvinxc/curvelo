import type { FastifyInstance } from "fastify";
import { searchPlaces } from "../../lib/places.js";

/** GET /api/v1/places/search?q= — verified city/state suggestions. */
export async function placeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/places/search",
    { onRequest: [app.authenticate] },
    async (request) => {
      const q = (request.query as { q?: unknown } | undefined)?.q;
      const places = await searchPlaces(typeof q === "string" ? q : "");
      return { places };
    },
  );
}
