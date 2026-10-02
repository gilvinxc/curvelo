import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { importPreviewSchema, type ImportPreviewInput } from "@curvelo/shared";
import { confirmImport, previewImport } from "./service.js";
import { MAX_IMPORT_BYTES } from "./parse.js";

async function readMultipart(request: FastifyRequest): Promise<{
  fileName: string;
  buf: Buffer;
  options: ImportPreviewInput;
} | null> {
  let fileName: string | null = null;
  let buf: Buffer | null = null;
  const fields: Record<string, string> = {};

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (fileName) continue; // one file only
      fileName = part.filename;
      buf = await part.toBuffer();
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  if (!fileName || !buf) return null;

  const options = importPreviewSchema.parse({
    teamId: fields.teamId || undefined,
    visibility: fields.visibility || undefined,
    title: fields.title || undefined,
  });
  return { fileName, buf, options };
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  });

  // Parse-only preview: "here's what we found in your file."
  app.post(
    "/activities/import/preview",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      let upload;
      try {
        upload = await readMultipart(request);
      } catch {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid import options" },
        });
      }
      if (!upload) {
        return reply.status(400).send({
          error: { code: "NO_FILE", message: "Attach a .fit, .gpx, or .tcx file" },
        });
      }
      const summary = await previewImport(
        request.user!.id,
        upload.fileName,
        upload.buf,
        upload.options,
      );
      return reply.send({ summary });
    },
  );

  // Parse + persist as a FILE_IMPORT activity.
  app.post(
    "/activities/import/confirm",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      let upload;
      try {
        upload = await readMultipart(request);
      } catch {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid import options" },
        });
      }
      if (!upload) {
        return reply.status(400).send({
          error: { code: "NO_FILE", message: "Attach a .fit, .gpx, or .tcx file" },
        });
      }
      const result = await confirmImport(
        request.user!.id,
        upload.fileName,
        upload.buf,
        upload.options,
        request.ip,
      );
      return reply.status(201).send(result);
    },
  );
}
