import { execSync } from "node:child_process";

/**
 * Resets the test database schema before the suite runs.
 * Uses `prisma db push --force-reset` (test DB only — never pointed at dev).
 */
export default async function setup(): Promise<() => Promise<void>> {
  const databaseUrl =
    "postgresql://curvelo:curvelo_dev@localhost:5432/curvelo_test";
  execSync("npx prisma db push --skip-generate --accept-data-loss --force-reset", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  return async () => {};
}
