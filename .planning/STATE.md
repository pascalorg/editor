# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** Make discovering, organizing, and sharing 3D spaces as fluid as Figma makes 2D design
**Current focus:** Phase 3 — Onboarding

## Current Position

Phase: 4 of 7 (Dashboard) — IN PROGRESS
Plan: 2 of 2 complete (awaiting human verify checkpoint)
Status: 04-02 built — 5 client components (StarButton, ProjectContextMenu, RenameModal, DeleteConfirmModal, ProjectsGrid), server projects page, Starred+Recent sections on dashboard home
Last activity: 2026-04-29 — 04-02 tasks complete: all 8 DASH requirements implemented, awaiting human verify checkpoint

Progress: [██████████] 93%

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
- v1 password reset returns resetUrl in API response (no email provider); MUST be replaced with transactional email in v2
- Token stored as raw 64-char hex — acceptable for v1; v2 hardening: store SHA-256 of token instead
- Middleware reads onboardingComplete from JWT only (getToken) — never Prisma; Edge Runtime compatibility
- trigger=update in jwt callback enables client to force JWT refresh after onboarding completion via useSession().update()
- Google OAuth callbackUrl set to /onboarding; middleware redirects to /dashboard for returning users with onboardingComplete=true
- Role/useCase stored in OnboardingProgress.selections JSON — NOT added as User.role field (defers migration to future phase)
- createProject return type updated to { id: string } to enable /editor/[projectId] redirect from onboarding
- StepTeam saves step=3 progress before invite redirect so user returns to Step 4 (First Project) after token consumption
- WorkspaceSetupModal removed from dashboard layout — middleware from 03-01 guarantees only onboarded users reach /dashboard
- session.user cast to { id?: string } in dashboard server actions — consistent with getFirstTeamId pattern; no next-auth.d.ts module augmentation needed
- StarredProject migration deferred to deployment (no local DB); schema validated via bunx prisma validate; client regenerated against updated schema

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-04-29
Stopped at: 04-01 complete — data layer done, ready for 04-02 (dashboard UI)
Resume file: Run 04-02-PLAN.md next
