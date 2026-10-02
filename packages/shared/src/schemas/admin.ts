import { z } from "zod";

export const adminUsersQuerySchema = z.object({
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminUserParamsSchema = z.object({
  userId: z.string().uuid(),
});

export const adminUpdateUserSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  systemRole: z.enum(["SYSTEM_ADMIN"]).nullable().optional(),
});

export const adminAuditQuerySchema = z.object({
  action: z.string().max(80).optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
