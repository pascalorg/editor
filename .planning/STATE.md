# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Make discovering, organizing, and sharing 3D spaces as fluid as Figma makes 2D design
**Current focus:** Phase 2 — Authentication

## Current Position

Phase: 2 of 7 (Authentication) — IN PROGRESS
Plan: 1 of N complete
Status: 02-01 complete — Google OAuth + NEXTAUTH_SECRET fix shipped; ready for 02-02
Last activity: 2026-04-28 — 02-01 complete: GoogleProvider + signIn upsert, env rename, Google button on login page

Progress: [███░░░░░░░] 30%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Viewer package used for marketplace + dashboard thumbnails (read-only embed, no editor overhead)
- Figma Community "duplicate" model for marketplace (preserves original, creates copy in workspace)
- Dribbble-style public profiles (self-contained; no separate portfolio app)
- Free-only marketplace for v1 (validate demand before monetization)
- All 5 public CTA links canonically use /signup (not /apply); /apply preserved for beta funnel
- Enterprise "Contact Sales" tier also routes through /signup for unified auth entry
- OG image uses next/og (bundled Next.js 16) — no @vercel/og install; Satori requires all styles inline
- twitter-image.tsx is a self-contained copy of opengraph-image (no cross-import; Next.js file convention)
- No @auth/prisma-adapter — manual signIn callback upsert preserves JWT session strategy; email as unique key prevents duplicate users
- allowDangerousEmailAccountLinking: true on GoogleProvider — safe for Google (verifies email); enables credential-user account linking
- BETTER_AUTH_SECRET renamed to NEXTAUTH_SECRET (was causing silent JWT signing failures)

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-04-28
Stopped at: Phase 2 Plan 01 complete — GoogleProvider + signIn upsert + env rename + Google button on login page
Resume file: Begin 02-02
