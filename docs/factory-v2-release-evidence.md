# Factory V2 Release Evidence

Last verified: 2026-07-05

## Release Candidate Gate

Command:

```bash
bun run --cwd apps/editor factory:release-candidate -- --with-visual-smoke --base-url http://localhost:3002 --out-dir qa-artifacts/factory-release-candidate/final-phase9
```

Result: passed.

Steps:

- `factory-release-readiness`: passed.
- `factory-core-tests`: passed, 62 tests, 167 expectations.
- `editor-typecheck`: passed.
- `factory-biome-check`: passed.
- `refinery-visual-smoke`: passed.

## Refinery Smoke Evidence

Prompt: `generate a refinery`

Result:

- Run status: `succeeded`.
- Quality score: `100`.
- Static quality score: `100`.
- Issue count: 0 errors, 0 warnings, 0 info.
- Patch count: 1110.
- Node count: 1110.
- Root node count: 273.
- Station assembly count: 15.
- Canvas count: 1.
- Captured views: isometric, top, side.
- Views distinct: true.
- Browser console errors: 0.
- Browser page errors: 0.
- Browser request failures: 0.

Required station coverage:

- `crude_storage_tank`: present.
- `atmospheric_distillation_unit`: present.
- `fluid_catalytic_cracking_unit`: present.
- `hydrotreating_unit`: present.
- `catalytic_reformer_unit`: present.
- `flare_system`: present.
- `pipe_rack`: present.

## Artifact Policy

The visual run writes local QA JSON and screenshots for inspection. Those generated artifacts are not committed; this document keeps only the release evidence summary needed for review.
