import { db } from "../../db.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { newStorageKey, storage, MAX_UPLOAD_BYTES } from "../../lib/storage.js";
import { audit } from "../../lib/audit.js";
import { AppError, forbidden } from "../../lib/errors.js";

export const PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
export const MAX_PHOTOS_PER_POST = 5;

function photoKey(fileName: string): string {
  return newStorageKey("photo", fileName).replace(/^docs\//, "photos/");
}

function assertImage(buffer: Buffer, mimeType: string): void {
  if (!PHOTO_MIME.has(mimeType)) {
    throw new AppError(422, "INVALID_FILE", "Only JPEG, PNG, WebP, or HEIC photos are allowed.");
  }
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(422, "FILE_TOO_LARGE", "Photos must be under 10 MB.");
  }
  // Magic-byte check for the common formats (HEIC/HEIF containers vary).
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const webp =
    buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  const heic = mimeType === "image/heic" || mimeType === "image/heif";
  if (!(jpg || png || webp || heic)) {
    throw new AppError(422, "INVALID_FILE", "That file doesn't look like a photo.");
  }
}

export interface PhotoDTO {
  id: string;
  teamId: string;
  albumId: string | null;
  postId: string | null;
  uploaderId: string;
  uploaderName: string;
  mimeType: string;
  caption: string | null;
  status: string;
  createdAt: string;
}

function toPhotoDTO(p: {
  id: string;
  teamId: string;
  albumId: string | null;
  postId: string | null;
  uploaderId: string;
  uploader: { displayName: string };
  mimeType: string;
  caption: string | null;
  status: string;
  createdAt: Date;
}): PhotoDTO {
  return {
    id: p.id,
    teamId: p.teamId,
    albumId: p.albumId,
    postId: p.postId,
    uploaderId: p.uploaderId,
    uploaderName: p.uploader.displayName,
    mimeType: p.mimeType,
    caption: p.caption,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

const PHOTO_INCLUDE = { uploader: { select: { displayName: true } } } as const;

export interface AlbumDTO {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  photoCount: number;
  coverPhotoId: string | null;
  createdAt: string;
}

export async function createAlbum(
  actorId: string,
  teamId: string,
  input: { title: string; description?: string },
  ipAddress?: string,
): Promise<AlbumDTO> {
  requireManager(await activeMembership(actorId, teamId));
  const album = await db.album.create({
    data: {
      teamId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      createdById: actorId,
    },
  });
  await audit({
    actorId,
    action: "ALBUM_CREATED",
    entityType: "Album",
    entityId: album.id,
    metadata: { teamId },
    ipAddress,
  });
  return {
    id: album.id,
    teamId,
    title: album.title,
    description: album.description,
    photoCount: 0,
    coverPhotoId: null,
    createdAt: album.createdAt.toISOString(),
  };
}

/** Photos are inner-circle only — alumni (outer tier) can't view them. */
function requireInnerCircle(membership: { role: string }): void {
  if (membership.role === "ALUMNI") {
    throw forbidden("Photos are only visible to current team members");
  }
}

export async function listAlbums(actorId: string, teamId: string): Promise<AlbumDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  requireInnerCircle(membership);
  const albums = await db.album.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    include: {
      photos: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true },
      },
      _count: { select: { photos: { where: { status: "APPROVED" } } } },
    },
  });
  return albums.map((a) => ({
    id: a.id,
    teamId,
    title: a.title,
    description: a.description,
    photoCount: a._count.photos,
    coverPhotoId: a.photos[0]?.id ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function uploadPhoto(
  actorId: string,
  teamId: string,
  input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    caption?: string;
    albumId?: string;
  },
  ipAddress?: string,
): Promise<PhotoDTO> {
  await activeMembership(actorId, teamId);
  assertImage(input.buffer, input.mimeType);

  if (input.albumId) {
    const album = await db.album.findUnique({ where: { id: input.albumId } });
    if (!album || album.teamId !== teamId) {
      throw new AppError(422, "INVALID_ALBUM", "That album doesn't belong to this team.");
    }
  }

  const key = photoKey(input.fileName);
  await storage().put(key, input.buffer, input.mimeType);

  const photo = await db.photo.create({
    data: {
      teamId,
      albumId: input.albumId ?? null,
      uploaderId: actorId,
      storageKey: key,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      caption: input.caption?.trim() || null,
      status: "PENDING",
    },
    include: PHOTO_INCLUDE,
  });

  await audit({
    actorId,
    action: "PHOTO_UPLOADED",
    entityType: "Photo",
    entityId: photo.id,
    metadata: { teamId, albumId: input.albumId ?? null },
    ipAddress,
  });
  return toPhotoDTO(photo);
}

export async function listPhotos(
  actorId: string,
  teamId: string,
  opts: { albumId?: string; includePending?: boolean },
): Promise<PhotoDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  requireInnerCircle(membership);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  const status =
    opts.includePending && isManager ? undefined : ("APPROVED" as const);
  const photos = await db.photo.findMany({
    where: {
      teamId,
      ...(opts.albumId ? { albumId: opts.albumId } : {}),
      ...(status ? { status } : {}),
    },
    include: PHOTO_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return photos.map((p) => toPhotoDTO(p));
}

export async function pendingPhotos(actorId: string, teamId: string): Promise<PhotoDTO[]> {
  requireManager(await activeMembership(actorId, teamId));
  const photos = await db.photo.findMany({
    where: { teamId, status: "PENDING" },
    include: PHOTO_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return photos.map((p) => toPhotoDTO(p));
}

export async function reviewPhoto(
  actorId: string,
  photoId: string,
  approve: boolean,
  ipAddress?: string,
): Promise<PhotoDTO> {
  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  requireManager(await activeMembership(actorId, photo.teamId));
  const updated = await db.photo.update({
    where: { id: photoId },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedById: actorId,
      reviewedAt: new Date(),
    },
    include: PHOTO_INCLUDE,
  });
  await audit({
    actorId,
    action: approve ? "PHOTO_APPROVED" : "PHOTO_REJECTED",
    entityType: "Photo",
    entityId: photoId,
    metadata: { teamId: photo.teamId },
    ipAddress,
  });
  return toPhotoDTO(updated);
}

export async function deletePhoto(
  actorId: string,
  photoId: string,
  ipAddress?: string,
): Promise<void> {
  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  const membership = await activeMembership(actorId, photo.teamId);
  requireInnerCircle(membership);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  if (photo.uploaderId !== actorId && !isManager) {
    throw new AppError(403, "FORBIDDEN", "You can only delete your own photos.");
  }
  await storage().delete(photo.storageKey).catch(() => {});
  await db.photo.delete({ where: { id: photoId } });
  await audit({
    actorId,
    action: "PHOTO_DELETED",
    entityType: "Photo",
    entityId: photoId,
    metadata: { teamId: photo.teamId },
    ipAddress,
  });
}

export async function getPhotoFile(
  actorId: string,
  photoId: string,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const photo = await db.photo.findUnique({ where: { id: photoId } });
  if (!photo) throw new AppError(404, "NOT_FOUND", "Photo not found.");
  const membership = await activeMembership(actorId, photo.teamId);
  requireInnerCircle(membership);
  const isManager = membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  // Pending photos are only visible to the uploader and coaches.
  if (photo.status !== "APPROVED" && photo.uploaderId !== actorId && !isManager) {
    throw new AppError(404, "NOT_FOUND", "Photo not found.");
  }
  const buffer = await storage().get(photo.storageKey);
  return { buffer, mimeType: photo.mimeType, fileName: `photo-${photo.id}` };
}

/** Attach approved team photos to a newly created post. */
export async function attachPhotosToPost(
  _actorId: string,
  teamId: string,
  postId: string,
  photoIds: string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  if (photoIds.length > MAX_PHOTOS_PER_POST) {
    throw new AppError(422, "TOO_MANY_PHOTOS", `At most ${MAX_PHOTOS_PER_POST} photos per post.`);
  }
  const photos = await db.photo.findMany({ where: { id: { in: photoIds } } });
  if (photos.length !== photoIds.length) {
    throw new AppError(422, "INVALID_PHOTO", "One of those photos doesn't exist.");
  }
  for (const p of photos) {
    if (p.teamId !== teamId || p.status !== "APPROVED" || p.postId) {
      throw new AppError(
        422,
        "INVALID_PHOTO",
        "Photos must be approved, from this team, and not already shared.",
      );
    }
  }
  await db.photo.updateMany({
    where: { id: { in: photoIds } },
    data: { postId },
  });
}
