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
  // AI coaching assistance. When both are set, the LLM provider is used;
  // otherwise the built-in local analyst generates insights (no key needed).
  aiApiKey: process.env.AI_API_KEY || null,
  aiModel: process.env.AI_MODEL || null,
  // Transactional email (password resets). When RESEND_API_KEY is set,
  // mail goes through Resend; otherwise reset links are logged server-side
  // (dev fallback — never used as the production path).
  resendApiKey: process.env.RESEND_API_KEY || null,
  mailFrom: process.env.MAIL_FROM ?? "Curvelo <noreply@curvelo.app>",
  // Public web URL used to build links in emails.
  webUrl: process.env.WEB_URL ?? "http://localhost:5173",
  passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES ?? "60", 10),
} as const;
