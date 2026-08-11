## Residual Review Findings

Recorded from the ce-code-review run (run-id `20260811-210518-012d2372`) on branch `feat/floorplan-export-routing-scope`, head `f2d3051`. All residuals were filed to GitHub Issues (repo `pascalorg/editor`); no `no_sink` or `failed` items.

- **P2** — `packages/editor/src/lib/floorplan/floorplan-export.tsx:768` — Add direct tests for floorplan export scope filtering at both collection sites — [tracker #635](https://github.com/pascalorg/editor/issues/635)
- **P3** — `packages/editor/src/lib/floorplan/floorplan-export.tsx:206` — Floorplan export schedules ignore scope: excluded categories still emit schedule pages — [tracker #631](https://github.com/pascalorg/editor/issues/631)
- **P3** — `packages/editor/src/lib/floorplan/floorplan-export.tsx:73` — Floorplan 'routing' export scope has no in-tree UI trigger — [tracker #632](https://github.com/pascalorg/editor/issues/632)
- **P3** — `packages/editor/src/index.tsx:362` — exportFloorplanPdf host API can't deliver its own contract: drawingType pinned — [tracker #633](https://github.com/pascalorg/editor/issues/633)
- **P3** — `packages/editor/src/lib/floorplan/floorplan-export.tsx:521` — Routing export: extreme-aspect utility runs can overflow fixed-pad PDF viewport — [tracker #634](https://github.com/pascalorg/editor/issues/634)

### Applied (not residual)

- **P2 conf 100** — plan's U2 compile-time smoke assertion for the `@pascal-app/editor` package-entry re-export — **applied** in commit `f2d3051` (`apps/editor/lib/floorplan-export-surface.test.ts`); verified it fails loudly (`TS2724`) when the re-export is broken.

### Source run context

- Plan: `docs/plans/2026-08-11-001-feat-floorplan-export-scope-plan.md` (origin: pascalorg/editor#619)
- Review artifact: `/tmp/compound-engineering-501/ce-code-review/20260811-210518-012d2372/`
- Reviewers: correctness (clean), project-standards (advisory only), testing, adversarial, api-contract
