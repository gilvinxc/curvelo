# Curvelo — System Architecture

**Tagline:** Empower Your Run.
**Status:** Living document. Updated as the platform grows.
**Date:** 2026-10-01

---

## 1. Overall System Architecture

Curvelo is built as a modular monolith API with a clean internal module
boundary, fronted by a mobile-first web client. The monolith is deliberate:
a small team gets one deployable, one database, and transactions that span
domains (e.g. "accept invitation → create membership → post feed item")
without distributed-systems overhead. Every domain lives in its own module
with its own router, service, and schema files, so high-churn domains
(feed, integrations, AI) can be extracted into standalone services later
without rewrites.

```
┌─────────────────────────────────────────────────────────────┐
│ Clients                                                     │
│  Web (React, mobile-first, PWA-ready) ──► API               │
│  Native apps (future, Expo) ──────────────► API (same REST) │
└─────────────────────────────────────────────────────────────┘
                              │ HTTPS /api/v1
┌─────────────────────────────▼───────────────────────────────┐
│ API — Node.js + TypeScript + Fastify (modular monolith)     │
│                                                             │
│  auth │ users │ teams │ invitations │ guardians │ workouts  │
│  activities │ feed │ notifications │ integrations │ ai │     │
│  compliance │ audit │ organizations                           │
│                                                             │
│  Shared kernel: config, db (Prisma), errors, pagination,     │
│  permissions (RBAC + team scope), validation (Zod)           │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ PostgreSQL 16 (Prisma ORM)                                  │
│ Redis (later: sessions cache, rate limits, feed fan-out)    │
└─────────────────────────────────────────────────────────────┘
        │                │                 │
   Object store     Push/email       External APIs
   (photos, FIT/   providers        (Strava, Garmin,
    GPX uploads)   (later)           HealthKit…)
```

**Key architectural decisions**

- **API-first.** Every feature the client does goes through the REST API.
  The future native app consumes the same endpoints — no backend rewrite.
- **Canonical internal activity model.** External providers (Garmin, Strava,
  FIT/GPX/TCX files) map into Curvelo's own `Activity` model through an
  integration layer. The core never imports a vendor schema.
- **Synchronous MVP, async later.** Slice 1 runs everything in-request.
  Feed fan-out, notifications, and file processing get a job queue
  (BullMQ + Redis) when volume demands it — the module boundaries already
  anticipate this.
- **Compliance as a service, not an afterthought.** A rules engine
  evaluates `can(action, context)` at enforcement points (assignments,
  announcements). MVP ships the data model + interface; enforcement
  points are wired as the rules mature.

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language across API, web, and shared contracts; catches API drift at compile time |
| Monorepo | npm workspaces | Zero extra toolchain; shared types via `@curvelo/shared` |
| API | Fastify | Production-proven, fast, schema-first; lighter than NestJS for a small team |
| ORM | Prisma | Typed queries, safe migrations, excellent DX |
| Database | PostgreSQL 16 | Relational integrity for teams/memberships/permissions; JSONB where flexibility helps |
| Validation | Zod | Single source of truth: request schemas double as TypeScript types, shared with the client |
| Auth | JWT access (15 min) + rotating refresh tokens, bcryptjs | Stateless API, mobile-ready; refresh rotation limits token theft |
| Web client | React 18 + Vite + Tailwind CSS | Mobile-first responsive; PWA-ready; verifiable and shippable now |
| Data fetching | TanStack Query | Caching, retries, optimistic updates for feed/calendar |
| Routing | React Router | — |
| Testing (API) | Vitest + Supertest | Fast, typed, co-located with modules |
| Testing (web) | Vitest + Testing Library (later slices) | — |
| Native (later) | Expo (React Native) | Reuses TypeScript skills; consumes the same REST API |
| File/activity import | Python or Node FIT/GPX/TCX parsers (later) | Behind the integration interface |
| AI (later) | Provider-agnostic `AIService` interface | Swap OpenAI/Anthropic/self-hosted without touching domains |

**What we are deliberately NOT using yet:** Redis, a job queue, object
storage (local disk for MVP uploads), push notifications, or a separate
microservice fleet. Each has a defined insertion point below.

---

## 3. Domain Model & Database Schema

Prisma schema lives at `packages/api/prisma/schema.prisma`. Design rules:

- Every table has `id` (UUID), `createdAt`, `updatedAt`.
- Soft-delete nothing in MVP except where audit matters (memberships keep
  history via status fields).
- Money/precision fields use `Decimal` where needed (not in slice 1).
- No giant tables: workouts, activities, posts, etc. are separate models
  joined by foreign keys.

### Slice 1 models (implemented now)

```
User            id, email (unique), passwordHash, displayName,
                dateOfBirth (nullable → age-aware permissions),
                role (SYSTEM_ADMIN), status, emailVerifiedAt

Profile         id, userId (unique), avatarUrl, bio, city,
                units (metric/imperial), privacy defaults

Team            id, name, slug (unique), description, orgId?,
                visibility (private|public), joinPolicy

TeamMembership  id, teamId, userId, role (COACH|RUNNER|PARENT|
                TEAM_ADMIN|ALUMNI), status (ACTIVE|INVITED|REMOVED),
                joinedAt. Unique(teamId, userId).

Invitation      id, teamId, email, role, token (unique, secret),
                invitedById, expiresAt, acceptedAt, status.
                (Email sending is stubbed in MVP — token returned
                to the coach to share.)

GuardianLink    id, guardianId (User), athleteId (User),
                relationship, verifiedAt, status.
                Basis for parental consent + visibility.

Season          id, teamId, name, startsAt, endsAt, isActive

Organization    id, name, type (SCHOOL|CLUB|ASSOCIATION|OTHER)

ComplianceRule  id, orgId?, teamId?, name, appliesTo
                (COMMUNICATION|WORKOUT_ASSIGNMENT|...),
                minAge, maxAge, seasonId?, startsAt, endsAt,
                action (BLOCK|REQUIRE_APPROVAL|LOG_ONLY),
                isActive. Evaluated by the rules engine.

AuditLog        id, actorId?, action, entityType, entityId,
                metadata (JSONB), ipAddress?, createdAt.
                Append-only. Records consent, invites, role
                changes, moderation, message sends.
```

### Later-slice models (schema sketched, built per slice)

```
TrainingPlan / Workout / WorkoutStep / WorkoutAssignment
  - WorkoutStep: order, kind (WARMUP|INTERVAL|RECOVERY|COOLDOWN|
    STEADY|REST), distanceM?, durationS?, targetPaceS?,
    targetHr?, targetEffort(1-10), repetitions?
  - WorkoutAssignment: workoutId, teamId?, userId? (team/group/
    individual), scheduledDate, createdById

Activity / ActivityMetric / Route / Shoe / EquipmentLink
  - Activity: userId, assignmentId?, kind (RUN|INTERVAL|TEMPO|
    PROGRESSION|LONG_RUN|RECOVERY|RACE|CROSS_TRAINING|STRENGTH),
    startedAt, distanceM, durationS, avgPace, avgHr, effort,
    notes, routeId?, visibility (PRIVATE|TEAM|PUBLIC),
    shareLevel (FULL|SUMMARY|ACHIEVEMENT_ONLY|NONE),
    source (MANUAL|FIT|GPX|TCX|STRAVA|GARMIN|HEALTH)

Race / RaceResult, Post / Comment / Reaction, Notification,
ExternalAccount (provider, providerUserId, tokens encrypted),
MessageThread / Message (team-scoped only — see §6),
Report (content reports + moderation queue)
```

### ER sketch (slice 1)

```
User 1──1 Profile
User 1──* TeamMembership *──1 Team 1──* Season
User 1──* Invitation (as invitedBy)      Team 1──* Invitation
User *──* GuardianLink (guardian ↔ athlete, both Users)
Team *──1 Organization
Organization/Team 1──* ComplianceRule
User 1──* AuditLog (as actor)
```

---

## 4. API / Service Boundaries

Base path `/api/v1`. All requests/validations defined as Zod schemas in
`@curvelo/shared`; the API imports them, the web client imports the
inferred types. One contract, two consumers, zero drift.

**Module → route mapping (slice 1 live, rest stubbed/roadmapped):**

| Module | Routes | Notes |
|---|---|---|
| auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | Cookies (web) or `Authorization` header (future native) |
| users | `GET /users/:id`, `PATCH /users/me`, `GET /users/me/profile` | |
| teams | `POST /teams`, `GET /teams`, `GET /teams/:id`, `PATCH /teams/:id`, `GET /teams/:id/roster` | Coach/team-admin gated |
| invitations | `POST /teams/:id/invitations`, `GET /invitations/:token`, `POST /invitations/:token/accept` | Token secret; expiry enforced |
| guardians | (slice 2) link/verify/list | Parental consent records |
| workouts | (slice 3) CRUD + builder + templates | |
| assignments | (slice 3) assign to team/group/individual | Compliance check point |
| activities | (slice 4) log/list/detail, planned-vs-actual | |
| feed | (slice 5) team feed, reactions, comments | Fan-out later via queue |
| notifications | in-app list (slice 5); push later | Dispatcher interface now |
| integrations | (later) `/integrations/:provider/connect`, `/sync`, file import | Provider interface now |
| ai | (later) `/ai/summarize`, `/ai/workout-from-text` | Interface now, stubbed |
| compliance | (later) CRUD rules; `evaluate()` used by assignments/announcements | Model + interface now |
| audit | internal; `GET /admin/audit` (system admin) | |

**Cross-cutting conventions**

- Cursor pagination (`?cursor&limit`) on all list endpoints.
- Consistent error shape: `{ error: { code, message, details? } }`.
- Idempotency-Key header honored on invitation/workout creation (later).
- Every mutating request runs the permission check:
  `can(user, action, scope)` — RBAC role + team membership + age-aware
  rules + compliance evaluation.

---

## 5. Repository / Project Structure

```
curvelo/
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   └── ADRs/                    # decision records (as needed)
├── packages/
│   ├── shared/                  # @curvelo/shared
│   │   └── src/
│   │       ├── schemas/         # Zod schemas (auth, teams, …)
│   │       ├── types.ts         # inferred + shared types
│   │       └── constants.ts     # roles, activity kinds, …
│   ├── api/                     # @curvelo/api
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── index.ts         # bootstrap
│   │   │   ├── app.ts           # Fastify wiring
│   │   │   ├── config.ts
│   │   │   ├── db.ts            # Prisma client
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts      # JWT verify, request.user
│   │   │   │   ├── errors.ts    # error shape + handler
│   │   │   │   └── cookies.ts
│   │   │   ├── lib/
│   │   │   │   ├── permissions.ts  # can(user, action, scope)
│   │   │   │   ├── audit.ts        # audit() helper
│   │   │   │   └── tokens.ts       # invite/JWT helpers
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── users/
│   │   │       ├── teams/
│   │   │       └── invitations/
│   │   │       # later: guardians, workouts, activities,
│   │   │       #   feed, notifications, integrations, ai,
│   │   │       #   compliance, organizations
│   │   └── test/                # supertest suites per module
│   └── web/                     # @curvelo/web (Vite + React)
│       └── src/
│           ├── main.tsx, App.tsx, routes.tsx
│           ├── lib/
│           │   ├── api.ts       # typed fetch client
│           │   └── auth.tsx     # session context
│           ├── components/      # buttons, cards, forms…
│           └── features/
│               ├── auth/        # SignIn, Register
│               ├── teams/       # TeamList, TeamPage, Roster, Invite
│               └── dashboard/   # RunnerHome, CoachHome
├── package.json                 # npm workspaces
└── README.md
```

---

## 6. Security & Privacy Considerations

1. **Auth hardening.** bcryptjs-hashed passwords (cost 12), short-lived
   access JWTs, rotating refresh tokens with reuse detection, rate-limited
   login/register, generic "invalid credentials" responses.
2. **RBAC + team scope.** Permissions are checked per request against
   `(system role, team membership role, resource ownership)`. A coach of
   Team A cannot see Team B's roster. Coaches see athlete data only for
   their teams.
3. **Youth safety by architecture (not cosmetics).**
   - `GuardianLink` + `dateOfBirth` drive age-aware permissions.
   - Messaging is **team-scoped group threads only** — no 1:1 private
     adult↔minor messaging. All messages land in `AuditLog`.
   - Parental consent records gate minor accounts; parents get
     visibility into their athlete's shared content.
   - Content reporting → moderation queue; team communication policies
     are team settings, enforced by the compliance engine.
4. **Data minimization.** Collect DOB only to derive age band; store the
   band where the exact date isn't needed. Health data (HR, etc.) is
   encrypted at rest in production and never used for ads.
5. **Privacy controls.** Per-activity `visibility` + `shareLevel`
   (FULL/SUMMARY/ACHIEVEMENT_ONLY/NONE). Team feed only surfaces what
   the athlete chose to share.
6. **Audit everything sensitive.** Invites, role changes, consent,
   moderation actions, message sends, compliance blocks → `AuditLog`.
7. **Input hygiene.** Zod validation on every boundary, Prisma
   parameterized queries (no raw SQL in MVP), file-upload type/size
   limits (later slices).
8. **Secrets.** Env-driven config; never committed. Tokens encrypted
   (ExternalAccount, later).

---

## 7. MVP vs Later Phases

### MVP (this build)
The 12-step workflow: account → role select → coach creates team →
invite runner → runner joins → structured workout → assignment →
calendar → manual activity entry → planned-vs-completed → optional
team feed → coach dashboard. Screens: auth, runner/coach dashboards,
team page, roster, calendar, workout builder, workout detail, activity
entry, activity detail, feed, athlete profile, coach athlete view,
settings/privacy.

### Phase 2 — Guardians & safety depth
Parent accounts, consent flows, guardian visibility dashboards, group
messaging with audit, reporting/moderation queue.

### Phase 3 — Integrations
Strava/Garmin OAuth, Apple Health / Google Health Connect, FIT/GPX/TCX
import through the provider interface.

### Phase 4 — AI assistant
Training summaries, anomaly detection, planned-vs-actual narratives,
natural-language → structured workout. Always advisory; coach approves.

### Phase 5 — Compliance enforcement
Org-defined rules (dead periods etc.) enforced at assignment and
communication points via the rules engine.

### Phase 6 — Scale & native
Redis + queues, object storage, push notifications, Expo native apps,
advanced analytics.

---

## 8. Implementation Sequence

1. **Scaffold + schema + auth** — monorepo, Prisma models (slice 1),
   register/login/refresh/me, tests. ← we are here
2. **Teams + memberships + invitations** — create team, invite by
   email/token, accept flow, roster, role guards, tests.
3. **Workouts** — builder data model (steps), templates, CRUD.
4. **Assignments + calendar** — assign to team/group/individual,
   training calendar views.
5. **Activities** — manual entry, detail, planned-vs-completed
   comparison service.
6. **Feed + dashboards** — share controls, team feed, coach team
   dashboard, runner home.
7. **Hardening** — rate limits, audit coverage, PWA polish, docs.

Each slice ships vertical: migration → API → tests → client screens →
docs. No placeholder code — if it isn't wired, it isn't merged.
