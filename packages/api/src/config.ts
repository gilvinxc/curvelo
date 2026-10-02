// Centralized runtime config. All secrets come from the environment;
// dev defaults are intentionally insecure and must be overridden in prod.

const requiredInProd = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

if (process.env.NODE_ENV === "production") {
  for (const key of requiredInProd) {
    if (!process.env[key]) throw new Error(`Missing required env var ${key}`);
  }
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  accessTtlSec: 15 * 60,
  refreshTtlSec: 30 * 24 * 60 * 60,
  invitationTtlHours: 72,
  cookieSecure: process.env.NODE_ENV === "production",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  isProd: process.env.NODE_ENV === "production",
} as const;
