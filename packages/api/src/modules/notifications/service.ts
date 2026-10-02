import { db } from "../../db.js";

const PAGE_SIZE = 20;

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function toDTO(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  cursor?: string,
): Promise<{ notifications: NotificationDTO[]; nextCursor: string | null }> {
  const rows = await db.notification.findMany({
    where: {
      userId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    notifications: page.map(toDTO),
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, id: string): Promise<void> {
  await db.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
