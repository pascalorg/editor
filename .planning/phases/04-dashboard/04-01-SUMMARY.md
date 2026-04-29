---
phase: 04-dashboard
plan: "01"
subsystem: database
tags: [prisma, postgres, nextauth, server-actions, next-cache]

requires:
  - phase: 03-onboarding
    provides: User model, project creation action, onboarding middleware

provides:
  - lastOpenedAt DateTime? field on Project model
  - StarredProject join table with composite PK and Cascade deletes
  - renameProject server action
  - deleteProject server action
  - starProject server action
  - unstarProject server action
  - updateLastOpened server action
  - getDashboardData updated to return starredProjectIds string[]

affects: [04-02-dashboard-ui, any component consuming getDashboardData]

tech-stack:
  added: []
  patterns:
    - "session.user cast to { id?: string } for NextAuth id access (no next-auth module augmentation)"
    - "StarredProject composite PK pattern @@id([userId, projectId]) with Cascade deletes"
    - "revalidatePath called for both /dashboard and /dashboard/projects in every mutation"

key-files:
  created: []
  modified:
    - apps/editor/prisma/schema.prisma
    - apps/editor/app/dashboard/actions.ts
    - apps/editor/prisma/generated-client/

key-decisions:
  - "session.user cast to { id?: string } rather than augmenting NextAuth module types — consistent with getFirstTeamId pattern already in codebase"
  - "Migration deferred to runtime (no local DB available); schema validated with bunx prisma validate; Prisma client generated against updated schema"

patterns-established:
  - "Cast session.user as { id?: string } for NextAuth id in server actions"
  - "All dashboard mutations revalidatePath /dashboard and /dashboard/projects"

duration: 15min
completed: 2026-04-29
---

# Phase 04 Plan 01: Dashboard Data Layer Summary

**StarredProject join table + lastOpenedAt on Project, plus 5 server actions (rename/delete/star/unstar/updateLastOpened) with full revalidation, unblocking the dashboard UI in plan 04-02**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-29T00:00:00Z
- **Completed:** 2026-04-29T00:15:00Z
- **Tasks:** 2
- **Files modified:** 3 (schema.prisma, actions.ts, generated-client/)

## Accomplishments

- Added `lastOpenedAt DateTime?` to Project model and `StarredProject` join table with composite PK `@@id([userId, projectId])` and `onDelete: Cascade` on both FK relations
- Regenerated Prisma client with new types (`starredProject.create`, `starredProject.delete` with composite key, `project.update` with `lastOpenedAt`)
- Added 5 server actions: `renameProject`, `deleteProject`, `starProject`, `unstarProject`, `updateLastOpened`; all guard with session userId, call appropriate Prisma mutations, and revalidate `/dashboard` + `/dashboard/projects`
- Updated `getDashboardData` to include `starredProjects: { select: { projectId: true } }` and return `starredProjectIds: string[]` mapped from the join rows

## Task Commits

1. **Task 1: Schema** - `9b19509` (feat)
2. **Task 2: Server actions** - `9f147d1` (feat)

**Plan metadata:** (final docs commit follows)

## Files Created/Modified

- `apps/editor/prisma/schema.prisma` - Added `lastOpenedAt`, `starredBy` on Project; `starredProjects` on User; new `StarredProject` model
- `apps/editor/app/dashboard/actions.ts` - Updated `getDashboardData`; added 5 new exported server actions
- `apps/editor/prisma/generated-client/` - Regenerated Prisma client reflecting schema changes

## Decisions Made

- Cast `session.user as { id?: string }` for NextAuth id — consistent with the `getFirstTeamId` pattern already in the file; avoids needing a `next-auth.d.ts` module augmentation file
- Migration was not run locally (Docker Desktop not running, no local DB). Schema was validated with `bunx prisma validate` and Prisma client was generated using a placeholder DATABASE_URL. Migration must be applied when deploying or when Docker DB is available.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript error: `session.user.id` not in NextAuth default types**
- **Found during:** Task 2 verification (tsc --noEmit)
- **Issue:** Plan code used `session?.user?.id` directly, but NextAuth's default `Session` type only has `name`, `email`, `image` on `user`. TypeScript reported 7 errors in actions.ts.
- **Fix:** Replaced `session?.user?.id` with `(session?.user as { id?: string } | undefined)?.id` cast pattern — identical to how `getFirstTeamId` already handles this in the same file.
- **Files modified:** apps/editor/app/dashboard/actions.ts
- **Verification:** `bunx tsc --noEmit 2>&1 | grep actions.ts` — zero errors
- **Committed in:** 9f147d1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for TypeScript correctness. No scope creep.

## Issues Encountered

- Docker Desktop not running — `prisma migrate dev` failed with missing DATABASE_URL. Schema validated via `bunx prisma validate` (accepts placeholder URL for validation). Prisma client generated successfully with placeholder URL. **Migration must be applied when database is accessible.**

## User Setup Required

Before running the app after this plan, apply the pending migration:

```bash
cd apps/editor
DATABASE_URL="postgresql://pascal:pascal@localhost:5432/pascal_db" bunx prisma migrate dev
# or when deploying via Docker:
docker compose up db -d
docker compose run --rm app bunx prisma migrate deploy
```

## Next Phase Readiness

- Data layer fully built — 04-02 (dashboard UI) can import all 5 server actions and use `starredProjectIds` from `getDashboardData`
- Only blocker: migration must be applied before server-side rendering works at runtime

---
*Phase: 04-dashboard*
*Completed: 2026-04-29*
