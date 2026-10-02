# @curvelo/web

Mobile-first web client for Curvelo ("Empower Your Run"). Vite + React 18 +
TypeScript + Tailwind CSS + React Router + TanStack Query.

## Prerequisites

- Node >= 20
- The API running at `http://localhost:4000` (see `packages/api`)

## Run

```sh
# from the repo root
npm run dev --workspace=@curvelo/web
```

Opens at `http://localhost:5173`.

To point at a different API, set `VITE_API_URL` (must include the
`/api/v1` path), e.g.:

```sh
VITE_API_URL=http://localhost:4000/api/v1 npm run dev --workspace=@curvelo/web
```

Auth uses cookies, so every request is sent with `credentials: "include"`.

## Checks

```sh
npm run typecheck --workspace=@curvelo/web   # tsc, strict
npm run build --workspace=@curvelo/web       # tsc + vite build
```

## What's implemented (slice 1)

- `/signin`, `/register` — email/password auth, Runner/Coach role cards,
  optional date of birth. Supports `?next=` redirects.
- `/dashboard` — greeting + "My teams" list with role badges, member
  counts, create-team entry point, empty state.
- `/teams/new` — create team (name, slug, description, visibility).
- `/teams/:id` — team header (name, description, my role, visibility,
  member count), sorted roster (emails shown only when the API includes
  them), coach/admin-only invite dialog with one-time token + copyable
  invite link.
- `/invite/:token` — public invitation preview; prompts logged-out users
  to sign in/register first, handles wrong-account mismatch, accepts and
  redirects to the team page.
- `/settings` — edit display name, bio, city, units, default share level;
  log out.

Design: dark "deep ink" theme with a volt-lime accent, bold type, cards,
48px touch targets — mobile-first (390px), scaling up on desktop.

## Notes

- Screens only use data the API exposes. There is intentionally no
  workouts/calendar/feed UI yet — those endpoints land in later slices.
- `GET /teams` returns only teams the user belongs to, so the dashboard
  doubles as the team list.
