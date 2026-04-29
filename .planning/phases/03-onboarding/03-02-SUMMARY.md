---
phase: 03-onboarding
plan: 02
subsystem: ui
tags: [next-auth, prisma, onboarding, react, server-actions, jwt]

requires:
  - phase: 03-01
    provides: OnboardingProgress model, OrganizationInviteToken model, JWT onboardingComplete field, middleware route gate

provides:
  - 4-step onboarding flow (Role, Use Case, Team, First Project)
  - saveProgress / completeOnboarding server actions
  - /invite/[token] route for URL-based team joins
  - getFirstTeamId server action
  - createProject returns { id: string } for editor redirect

affects: [dashboard, editor, invite, 04-editor, 05-marketplace]

tech-stack:
  added: []
  patterns:
    - "useTransition wraps all server action calls in client components"
    - "useSession().update() called after completeOnboarding() to refresh JWT before routing"
    - "saveProgress called before window.location.href redirect to preserve step index"
    - "Role/use-case stored in OnboardingProgress.selections JSON, NOT User model fields"

key-files:
  created:
    - apps/editor/app/onboarding/page.tsx
    - apps/editor/app/onboarding/_components/OnboardingFlow.tsx
    - apps/editor/app/onboarding/_components/StepRole.tsx
    - apps/editor/app/onboarding/_components/StepUseCase.tsx
    - apps/editor/app/onboarding/_components/StepTeam.tsx
    - apps/editor/app/onboarding/_components/StepProject.tsx
    - apps/editor/app/invite/[token]/page.tsx
  modified:
    - apps/editor/app/onboarding/actions.ts
    - apps/editor/app/dashboard/actions.ts
    - apps/editor/app/dashboard/layout.tsx

key-decisions:
  - "Role/useCase stored in OnboardingProgress.selections JSON — NOT added as User.role field (defers migration to future phase)"
  - "createProject return type updated to { id: string } to enable /editor/[projectId] redirect from onboarding"
  - "StepTeam saves step=3 progress before invite redirect so user returns to Step 4 (First Project) after token consumption"
  - "WorkspaceSetupModal removed from dashboard layout — middleware from 03-01 guarantees only onboarded users reach /dashboard"

patterns-established:
  - "Server component loads DB state (OnboardingProgress) and passes as props to client state machine"
  - "useTransition + startTransition wraps all server action calls to avoid blocking UI"

duration: ~30min
completed: 2026-04-29
---

# Phase 03 Plan 02: Onboarding UI Summary

**4-step onboarding flow (Role/UseCase/Team/Project) with DB-persisted progress, invite token route, and JWT refresh on completion**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-29
- **Completed:** 2026-04-29
- **Tasks:** 2 (checkpoint pending human verification)
- **Files modified:** 10

## Accomplishments
- Full 4-step onboarding UI with back navigation and indigo-highlighted selection cards
- Progress persists to DB on every Next press — refresh restores correct step
- /invite/[token] validates token, creates OrganizationMember idempotently, redirects to onboarding or dashboard
- createProject now returns `{ id: string }` enabling direct /editor/[projectId] redirect on completion
- WorkspaceSetupModal removed — middleware gate makes it obsolete

## Task Commits

1. **Task 1: Server component, server actions, and invite route** - `5261650` (feat)
2. **Task 2: OnboardingFlow client component and all 4 step components** - `9d8b3af` (feat)

## Files Created/Modified
- `apps/editor/app/onboarding/page.tsx` - Server component that loads OnboardingProgress from DB
- `apps/editor/app/onboarding/actions.ts` - Added saveProgress and completeOnboarding server actions
- `apps/editor/app/onboarding/_components/OnboardingFlow.tsx` - 4-step state machine with progress indicator
- `apps/editor/app/onboarding/_components/StepRole.tsx` - Role selection (architect/designer/homeowner/student)
- `apps/editor/app/onboarding/_components/StepUseCase.tsx` - Use case selection (personal/team/client)
- `apps/editor/app/onboarding/_components/StepTeam.tsx` - Team create/join/skip with invite URL parsing
- `apps/editor/app/onboarding/_components/StepProject.tsx` - First project creation with getFirstTeamId lookup
- `apps/editor/app/invite/[token]/page.tsx` - Invite token validation and OrganizationMember creation
- `apps/editor/app/dashboard/actions.ts` - Added getFirstTeamId; updated createProject to return { id: string }
- `apps/editor/app/dashboard/layout.tsx` - Removed WorkspaceSetupModal and hasOrg branching

## Selections Type Shape

```typescript
type Selections = {
  role?: string           // 'architect' | 'designer' | 'homeowner' | 'student'
  useCase?: string        // 'personal' | 'team' | 'client'
  teamAction?: 'create' | 'join' | 'skip'
  teamId?: string
  projectAction?: 'blank' | 'skip'
  projectId?: string
}
```

Stored in `OnboardingProgress.selections` as JSON. NOT added to User model.

## Role Storage Decision

Role and use-case selections are stored in `OnboardingProgress.selections` JSON, NOT as a `User.role` field. This avoids a User model migration for v1. Future phases that need to read the user's role should query `OnboardingProgress.selections`.

## createProject Return Value

`dashboard/actions.ts:createProject` now returns `{ id: string; success: boolean }` instead of `{ success: boolean; project: Project }`. This enables `StepProject` to pass `projectId` through `onNext` to `OnboardingFlow`, which redirects to `/editor/[projectId]` on final step completion.

## StepTeam Invite Join Path

When a user selects "Join with invite link", `StepTeam` calls `saveProgress(3, { ...currentSelections, teamAction: 'join' })` BEFORE doing `window.location.href = /invite/[token]`. When the invite route processes the token and redirects back to `/onboarding`, `initialStep=3` causes `OnboardingFlow` to start at Step 4 (First Project). The token is marked `usedAt` so it cannot be re-used.

## Decisions Made
- Role/useCase stored in OnboardingProgress.selections JSON, NOT User.role (defers schema migration)
- createProject return type updated to { id: string } to enable editor redirect from onboarding
- StepTeam saves step=3 progress before invite redirect so user returns to Step 4
- WorkspaceSetupModal removed — middleware gate makes it obsolete

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Onboarding flow is fully built and TypeScript build passes
- Awaiting human verification of the 12-step browser walkthrough
- Once verified: Phase 3 is complete, ready for Phase 4 (Editor)
