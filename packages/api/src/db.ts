import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. In dev with tsx watch, HMR isn't a concern,
// but the global guard keeps tests (which import repeatedly) safe.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
