import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import {
  backgroundCheckSchema,
  documentAthleteParamsSchema,
  documentDeleteSchema,
  documentParamsSchema,
  documentRequirementSchema,
  documentSignSchema,
  documentUploadSchema,
  requirementParamsSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import {
  deleteDocument,
  deleteRequirement,
  downloadDocument,
  getDocument,
  listAthleteDocuments,
  listMyCertifications,
  listMyDocuments,
  listRequirements,
  listTeamDocuments,
  recordBackgroundCheck,
  signDocument,
  teamDocumentStatus,
  uploadDocument,
  upsertRequirement,
  verifyDocument,
} from "./service.js";

export async function documentRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  // ---- Coach checklist ----
  app.get(
    "/teams/:id/document-requirements",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { requirements: await listRequirements(request.user!.id, id) };
    },
  );

  app.post(
    "/teams/:id/document-requirements",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const input = documentRequirementSchema.parse(request.body);
      const requirement = await upsertRequirement(
        request.user!.id,
        id,
        input,
        request.ip,
      );
      return reply.code(201).send({ requirement });
    },
  );

  app.delete(
    "/teams/:id/document-requirements/:requirementId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { requirementId } = requirementParamsSchema.parse(request.params);
      return deleteRequirement(request.user!.id, id, requirementId, request.ip);
    },
  );

  // ---- Status board (coach) ----
  app.get(
    "/teams/:id/document-status",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { athletes: await teamDocumentStatus(request.user!.id, id) };
    },
  );

  // ---- Upload (multipart) ----
  app.post(
    "/documents/upload",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply
          .status(400)
          .send({ error: { code: "BAD_REQUEST", message: "No file uploaded." } });
      }
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(file.fields)) {
        const v = value as { value?: unknown } | undefined;
        if (v && typeof v.value === "string") fields[key] = v.value;
        else if (typeof value === "string") fields[key] = value;
      }
      const input = documentUploadSchema.parse({
        ...fields,
        visibility: fields.visibility || "TEAM",
      });
      const buffer = await file.toBuffer();
      const document = await uploadDocument(
        request.user!.id,
        input,
        {
          buffer,
          fileName: file.filename,
          mimeType: file.mimetype,
          sizeBytes: buffer.length,
        },
        request.ip,
      );
      return reply.code(201).send({ document });
    },
  );

  // ---- Read / download ----
  app.get(
    "/documents/:documentId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { documentId } = documentParamsSchema.parse(request.params);
      return { document: await getDocument(request.user!.id, documentId, request.ip) };
    },
  );

  app.get(
    "/documents/:documentId/file",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { documentId } = documentParamsSchema.parse(request.params);
      const { buffer, fileName, mimeType } = await downloadDocument(
        request.user!.id,
        documentId,
        request.ip,
      );
      return reply
        .header("Content-Type", mimeType)
        .header(
          "Content-Disposition",
          `inline; filename="${fileName.replace(/"/g, "")}"`,
        )
        .send(buffer);
    },
  );

  // ---- Lists ----
  app.get(
    "/teams/:id/documents/mine",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { documents: await listMyDocuments(request.user!.id, id) };
    },
  );

  app.get(
    "/teams/:id/documents/athlete/:userId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { userId } = documentAthleteParamsSchema.parse(request.params);
      return {
        documents: await listAthleteDocuments(request.user!.id, id, userId),
      };
    },
  );

  app.get(
    "/teams/:id/documents/team",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { documents: await listTeamDocuments(request.user!.id, id) };
    },
  );

  app.get(
    "/users/me/certifications",
    { preHandler: [app.authenticate] },
    async (request) => {
      return { documents: await listMyCertifications(request.user!.id) };
    },
  );

  app.post(
    "/documents/background-check",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const input = backgroundCheckSchema.parse(request.body);
      const document = await recordBackgroundCheck(
        request.user!.id,
        input,
        request.ip,
      );
      return reply.code(201).send({ document });
    },
  );

  // ---- Verify / sign / delete ----
  app.post(
    "/documents/:documentId/verify",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { documentId } = documentParamsSchema.parse(request.params);
      return {
        document: await verifyDocument(request.user!.id, documentId, request.ip),
      };
    },
  );

  app.post(
    "/documents/:documentId/sign",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { documentId } = documentParamsSchema.parse(request.params);
      const { signedByName } = documentSignSchema.parse(request.body);
      return {
        document: await signDocument(
          request.user!.id,
          documentId,
          signedByName,
          request.ip,
        ),
      };
    },
  );

  app.delete(
    "/documents/:documentId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { documentId } = documentParamsSchema.parse(request.params);
      const { reason } = documentDeleteSchema.parse(request.body ?? {});
      return deleteDocument(request.user!.id, documentId, reason, request.ip);
    },
  );
}
