#!/usr/bin/env node
/**
 * Runs a command with Prisma engine paths resolved from this repo's
 * node_modules/@prisma/engines, plus telemetry disabled.
 *
 * On a normal machine `npm install` places the engines there automatically;
 * in restricted environments they may have been fetched manually — either
 * way this wrapper points Prisma at them without machine-specific env vars.
 *
 * Usage: node scripts/with-engines.mjs <command> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const enginesDir = path.join(repoRoot, "node_modules", "@prisma", "engines");

function pick(pattern) {
  if (!existsSync(enginesDir)) return undefined;
  const hit = readdirSync(enginesDir).find((f) => pattern.test(f));
  return hit ? path.join(enginesDir, hit) : undefined;
}

const env = {
  ...process.env,
  CHECKPOINT_DISABLE: "1",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
  PRISMA_QUERY_ENGINE_LIBRARY:
    process.env.PRISMA_QUERY_ENGINE_LIBRARY ??
    pick(/^libquery_engine-.*\.so\.node$|^libquery_engine-.*\.dylib\.node$/),
  PRISMA_QUERY_ENGINE_BINARY:
    process.env.PRISMA_QUERY_ENGINE_BINARY ?? pick(/^query-engine-/),
  PRISMA_SCHEMA_ENGINE_BINARY:
    process.env.PRISMA_SCHEMA_ENGINE_BINARY ?? pick(/^schema-engine-/),
};
// Drop undefined entries (lets Prisma fall back to its defaults).
for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-engines.mjs <command> [args...]");
  process.exit(2);
}
const result = spawnSync(cmd, args, { stdio: "inherit", env, shell: true });
process.exit(result.status ?? 1);
