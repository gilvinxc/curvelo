# Curvelo — Empower Your Run

Mobile-first social running + team management platform. Monorepo:

- `packages/shared` — `@curvelo/shared`: Zod schemas + TypeScript types (single API contract)
- `packages/api` — `@curvelo/api`: Fastify + Prisma + PostgreSQL REST API
- `packages/web` — `@curvelo/web`: React + Vite + Tailwind mobile-first client
- `docs/ARCHITECTURE.md` — system architecture, domain model, phasing

## Prerequisites

- Node.js ≥ 20
- PostgreSQL 16 (see below)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. PostgreSQL (this VM needs a manual install; re-runnable and idempotent)
python3 scripts/setup-postgres.py

# 3. Build shared contracts, then migrate the dev database
npm run build --workspace=@curvelo/shared
npm run db:migrate --workspace=@curvelo/api

# 4. Run the API (http://localhost:4000) and web client (http://localhost:5173)
npm run dev:api
npm run dev:web   # in another terminal
```

API config lives in `packages/api/.env` (`DATABASE_URL`, JWT secrets, `CORS_ORIGIN`).

## Tests

```bash
npm run test:api   # 19 integration tests: auth, teams, invitations (uses curvelo_test DB)
```

## Notes

- Auth: JWT access (15 min) + rotating refresh tokens via httpOnly cookies
  (web) or `Authorization: Bearer` (future native clients).
- Invitations are token links; email sending is stubbed in MVP — the token is
  returned to the coach (and logged in dev).
- Prisma engines are resolved via `packages/api/scripts/with-engines.mjs`
  so CLI commands work even where the engine auto-download is blocked.
- If the VM is replaced, re-run `scripts/setup-postgres.py` and
  `npm run db:migrate --workspace=@curvelo/api`. Dev data is ephemeral;
  migrations are the source of truth.
