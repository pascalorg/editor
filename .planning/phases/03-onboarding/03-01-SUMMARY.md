---
phase: 03-onboarding
plan: 01
subsystem: auth
tags: [prisma, nextauth, jwt, middleware, onboarding, postgres]

requires:
  - phase: 02-authentication
    provides: NextAuth JWT session strategy, User model with credentials + Google OAuth

provides:
  - onboardingComplete Boolean field on User model
  - OnboardingProgress model (currentStep, selections, completedAt)
  - OrganizationInviteToken model with org relation
  - JWT callback carrying onboardingComplete on sign-in and trigger=update
  - Edge-safe middleware gating /dashboard and /onboarding based on JWT state
  - Credential signup routes to /onboarding; Google OAuth callbackUrl = /onboarding

affects:
  - 03-onboarding (all subsequent plans — step UI, completion API)
  - dashboard (gated until onboardingComplete=true)

tech-stack:
  added: []
  patterns:
    - Edge middleware reads only from JWT (getToken) — never Prisma
    - JWT trigger=update pattern for client-forced session refresh
    - Suspense wrapper pattern for useSearchParams in Next.js App Router

key-files:
  created:
    - apps/editor/middleware.ts
    - apps/editor/prisma/migrations/20260429000000_add_onboarding_models/migration.sql
    - apps/editor/prisma/migrations/migration_lock.toml
  modified:
    - apps/editor/prisma/schema.prisma
    - apps/editor/lib/auth.ts
    - apps/editor/app/login/page.tsx

key-decisions:
  - "Middleware reads onboardingComplete from JWT only (no Prisma) — Edge Runtime compatibility"
  - "trigger=update in jwt callback enables client to force JWT refresh after onboarding completion"
  - "Google OAuth callbackUrl set to /onboarding; middleware redirects to /dashboard for returning users"
  - "Migration SQL manually created (no live DB available locally) — runs on deploy via prisma migrate deploy"

patterns-established:
  - "Pattern: All route guards in middleware.ts use getToken() — never import prisma in Edge code"
  - "Pattern: JWT carries onboardingComplete boolean, refreshed on sign-in and via useSession().update()"

duration: 25min
completed: 2026-04-29
---

# Phase 03 Plan 01: Onboarding Infrastructure Summary

**Prisma schema extended with OnboardingProgress + OrganizationInviteToken models; Edge middleware gates /dashboard behind onboardingComplete JWT flag; new signups routed to /onboarding**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-29T00:00:00Z
- **Completed:** 2026-04-29T00:25:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Schema adds `onboardingComplete Boolean @default(false)` to User, `OnboardingProgress` model, and `OrganizationInviteToken` model with all relations wired
- Migration SQL includes backfill: existing users with an OrganizationMember row get `onboardingComplete = true`
- JWT callback fetches `onboardingComplete` from DB on every sign-in and on `trigger === 'update'`
- Edge-safe `middleware.ts` redirects `/dashboard` → `/onboarding` when `!onboardingComplete`, and `/onboarding` → `/dashboard` when `onboardingComplete`
- Credential signup and Google OAuth both route to `/onboarding` post-auth

## Task Commits

1. **Task 1: Schema additions + migration** - `0254e37` (feat)
2. **Task 2: JWT callback + middleware** - `c988b91` (feat)
3. **Task 3: Signup redirect to /onboarding** - `6d60fcc` (feat)

## Files Created/Modified
- `apps/editor/prisma/schema.prisma` - Added onboardingComplete field, OnboardingProgress model, OrganizationInviteToken model, inviteTokens relation on Organization
- `apps/editor/prisma/migrations/20260429000000_add_onboarding_models/migration.sql` - Migration SQL with backfill
- `apps/editor/prisma/migrations/migration_lock.toml` - Prisma migrations lock file
- `apps/editor/lib/auth.ts` - Extended jwt callback with onboardingComplete + trigger=update support
- `apps/editor/middleware.ts` - New Edge middleware for /dashboard and /onboarding route guards
- `apps/editor/app/login/page.tsx` - Signup redirect to /onboarding, Google callbackUrl, Suspense wrapper

## Decisions Made
- Migration SQL created manually (no local DB) — will be applied at deploy time via `prisma migrate deploy`
- Backfill SQL embedded in migration file so existing users with org membership are correctly marked complete
- Middleware uses only `getToken()` — Prisma is never imported in Edge code
- `trigger === 'update'` pattern allows onboarding completion page to call `useSession().update()` to refresh JWT without sign-out

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed useSearchParams Suspense boundary in login page**
- **Found during:** Task 3 (build verification)
- **Issue:** `useSearchParams()` in `login/page.tsx` not wrapped in Suspense boundary, causing prerender error that failed the build
- **Fix:** Renamed `AuthPage` to `AuthPageInner`, added new default export `AuthPage` that wraps `AuthPageInner` in `<Suspense>`
- **Files modified:** `apps/editor/app/login/page.tsx`
- **Verification:** Build completed successfully — `/login` shows as `○ (Static)` in build output
- **Committed in:** `6d60fcc` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Pre-existing build error fixed as part of Task 3. No scope creep.

## Issues Encountered
- No local PostgreSQL available — migration applied manually as SQL file; client generated with placeholder DATABASE_URL. Migration will run via `prisma migrate deploy` in Docker on next deploy.

## Backfill SQL (for reference)
```sql
UPDATE "User" u
SET "onboardingComplete" = true
WHERE EXISTS (
  SELECT 1 FROM "OrganizationMember" om WHERE om."userId" = u.id
);
```
Embedded in `apps/editor/prisma/migrations/20260429000000_add_onboarding_models/migration.sql`.

## Next Phase Readiness
- Infrastructure is complete: schema, JWT, and routing are all wired
- Next: Build the /onboarding page UI with step components (03-02)
- After onboarding completion: call `useSession().update()` to force JWT refresh, then redirect — middleware will allow through to /dashboard

---
*Phase: 03-onboarding*
*Completed: 2026-04-29*
