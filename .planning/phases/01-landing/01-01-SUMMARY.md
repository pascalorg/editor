---
phase: 01-landing
plan: 01
subsystem: ui
tags: [nextjs, react, landing-page, cta, routing]

requires: []
provides:
  - Landing page with all primary CTAs routing to /signup
  - Sign In link routing to /login
  - Responsive hero, bento, pricing, footer sections
affects: [02-auth, 03-dashboard]

tech-stack:
  added: []
  patterns:
    - "GlassButton component used for primary CTAs throughout landing page"
    - "All public-facing auth entry points canonically use /signup"

key-files:
  created: []
  modified:
    - apps/editor/app/page.tsx

key-decisions:
  - "Standardized all 5 public CTA href attributes from /apply to /signup as canonical auth entry"
  - "/apply route preserved (not removed) for legacy beta funnel"
  - "Enterprise 'Contact Sales' plan also updated to /signup (plan routing all tiers through standard auth)"

patterns-established:
  - "CTA pattern: primary GlassButton with href=/signup, secondary links to /login"

duration: 10min
completed: 2026-04-28
---

# Phase 01 Plan 01: Landing Page CTA Standardization Summary

**Five public CTA links updated from /apply to /signup, canonicalizing the auth entry point across nav, hero, use-cases, pricing, and bottom CTA sections**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-28
- **Completed:** 2026-04-28
- **Tasks:** 1 of 2 complete (Task 2 is a human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Replaced all 5 `href="/apply"` with `href="/signup"` in `apps/editor/app/page.tsx`
- /login links left untouched and verified correct
- /apply route not removed — preserved for beta funnel
- Pre-existing TypeScript errors confirmed as unrelated to this plan's changes

## Task Commits

1. **Task 1: Standardize CTA destinations to /signup** - `be02249` (feat)

**Plan metadata:** (pending final commit after human verification)

## Files Created/Modified
- `apps/editor/app/page.tsx` - 5 CTA hrefs changed from /apply to /signup

## Decisions Made
- Preserved /apply route (plan spec: "Do NOT remove /apply route")
- Enterprise "Contact Sales" tier also updates to /signup — all tiers use unified auth path

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Build via `npx next build` returned an ENOENT temp-file error (pre-existing environment issue unrelated to this plan's changes — Windows temp write path issue)
- TypeScript errors found via `tsc --noEmit` are in unrelated packages (`packages/editor/src/...`) and pre-date this plan

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Landing page CTAs correctly route to /signup — auth phase (02-auth) can implement /signup and /login routes with confidence that landing links are wired
- Human verification (Task 2) still required: visit http://localhost:3000, confirm responsiveness at 375/768/1280px, confirm all CTA links navigate correctly

---
*Phase: 01-landing*
*Completed: 2026-04-28*
