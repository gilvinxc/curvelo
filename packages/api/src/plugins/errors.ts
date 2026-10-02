import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Single error shape for the whole API:
 *   { error: { code, message, details? } }
 * Never leaks stack traces or internal fields to clients.
 *
 * Wrapped in fastify-plugin so the handler covers every route,
 * not just this plugin's encapsulation context.
 */
export const errorPlugin = fp(async function errorPlugin(
  app: FastifyInstance,
): Promise<void> {
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      const body: ErrorBody = {
        error: { code: err.code, message: err.message },
      };
      if (err.details !== undefined) body.error.details = err.details;
      return reply.status(err.statusCode).send(body);
    }

    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      });
    }

    // Prisma unique violation → 409
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return reply.status(409).send({
        error: { code: "CONFLICT", message: "Resource already exists" },
      });
    }

    app.log.error(err);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
});
