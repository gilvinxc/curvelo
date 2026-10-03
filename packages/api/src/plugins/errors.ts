import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// Optional: serve the built web client from the same origin (preview or
// single-host deployments). Set WEB_DIST to the web dist/ directory.
// Same-origin serving avoids CORS and cookie issues entirely.
const WEB_DIST = process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null;
const WEB_INDEX = WEB_DIST ? path.join(WEB_DIST, "index.html") : null;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

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

    // Pass through HTTP errors from other plugins (e.g. rate limiter's 429).
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      typeof (err as { statusCode: unknown }).statusCode === "number"
    ) {
      const statusCode = (err as { statusCode: number }).statusCode;
      if (statusCode === 429) {
        return reply.status(429).send({
          error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
        });
      }
    }

    app.log.error(err);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const urlPath = request.url.split("?")[0];
    // Serve the SPA for non-API paths when WEB_DIST is configured.
    if (WEB_DIST && WEB_INDEX && !urlPath.startsWith("/api/")) {
      let file = path.normalize(path.join(WEB_DIST, urlPath));
      if (
        !file.startsWith(WEB_DIST) ||
        !fs.existsSync(file) ||
        fs.statSync(file).isDirectory()
      ) {
        file = WEB_INDEX; // SPA fallback
      }
      const ext = path.extname(file).toLowerCase();
      reply.header("content-type", MIME[ext] ?? "application/octet-stream");
      return reply.send(fs.readFileSync(file));
    }
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Not found" },
    });
  });
});
