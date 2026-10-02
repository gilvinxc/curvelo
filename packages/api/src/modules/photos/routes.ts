import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import {
  createAlbum,
  deletePhoto,
  getPhotoFile,
  listAlbums,
  listPhotos,
  pendingPhotos,
  reviewPhoto,
  uploadPhoto,
} from "./service.js";

const teamParamsSchema = z.object({ id: z.string().uuid() });
const photoParamsSchema = z.object({ photoId: z.string().uuid() });
const createAlbumSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
const photosQuerySchema = z.object({
  albumId: z.string().uuid().optional(),
  includePending: z.coerce.boolean().optional(),
});
const reviewSchema = z.object({ approve: z.boolean() });

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  // Albums
  app.post(
    "/teams/:id/albums",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createAlbumSchema.parse(request.body);
      const album = await createAlbum(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ album });
    },
  );

  app.get(
    "/teams/:id/albums",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { albums: await listAlbums(request.user!.id, id) };
    },
  );

  // Upload (multipart)
  app.post(
    "/teams/:id/photos",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
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
      const buffer = await file.toBuffer();
      const photo = await uploadPhoto(
        request.user!.id,
        id,
        {
          buffer,
          fileName: file.filename,
          mimeType: file.mimetype,
          caption: fields.caption,
          albumId: fields.albumId || undefined,
        },
        request.ip,
      );
      return reply.code(201).send({ photo });
    },
  );

  // List (approved for members; coaches can include pending)
  app.get(
    "/teams/:id/photos",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const q = photosQuerySchema.parse(request.query);
      return {
        photos: await listPhotos(request.user!.id, id, {
          albumId: q.albumId,
          includePending: q.includePending,
        }),
      };
    },
  );

  // Moderation queue (coaches)
  app.get(
    "/teams/:id/photos/pending",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      return { photos: await pendingPhotos(request.user!.id, id) };
    },
  );

  app.post(
    "/photos/:photoId/review",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { photoId } = photoParamsSchema.parse(request.params);
      const { approve } = reviewSchema.parse(request.body);
      return { photo: await reviewPhoto(request.user!.id, photoId, approve, request.ip) };
    },
  );

  app.delete(
    "/photos/:photoId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { photoId } = photoParamsSchema.parse(request.params);
      await deletePhoto(request.user!.id, photoId, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Serve bytes (team members only; pending hidden from non-reviewers)
  app.get(
    "/photos/:photoId/file",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { photoId } = photoParamsSchema.parse(request.params);
      const { buffer, mimeType } = await getPhotoFile(request.user!.id, photoId);
      return reply.type(mimeType).send(buffer);
    },
  );
}
