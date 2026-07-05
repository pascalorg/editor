# Factory V2 Release Notes

Factory V2 turns industrial scene generation into a guided workflow rather than a loose collection of AI tools. A user can still type a simple request such as "generate a refinery", but the product now routes that request through industry-pack intent, process templates, semantic equipment assemblies, source metadata, quality reporting, and release-candidate checks.

## User Experience

- One-sentence factory prompts route through installed industry packs when the industry is known.
- Missing or disabled industry packs show an install gate instead of silently falling back to generic geometry.
- Generated factories are semantic assemblies: stations know their process role, equipment exposes editable parts, ports remain visible, routes are generated from process connections, and source metadata explains where the object came from.
- Users can inspect factory runs through workflow stages: intent router, pack resolver, template resolver, equipment compiler, route composer, and quality report.
- Applying a factory run writes one canvas change so undo/redo treats the generated factory as one workflow step.
- Live data binding remains part of the same semantic object model, so Data Lens and Inspector read the same equipment binding contract.

## What Changed From V1

- V1 generation could look like a large pile of primitives with limited explanation. V2 prefers industry-pack process templates and semantic assemblies for known factories.
- V1 required more manual interpretation after generation. V2 exposes source, station, profile, editable parts, ports, and data-binding capability in the shared Inspector and lenses.
- V1 quality was mostly judged by visual output. V2 adds release-readiness checks, quality summaries, fallback warnings, missing-pack gates, and optional visual smoke artifacts.
- V1 paths could diverge between AI factory generation, generated geometry, and data binding. V2 keeps them aligned around intent routing and semantic scene contracts.

## What Users Can Trust

- Known installed industry packs resolve process templates from both repository root and editor server working directories.
- Known factory prompts plan through `process_line` before heavier browser QA runs.
- The release gate checks installed intent-routed packs, cloud-pack coverage, server-cwd-safe template resolution, core factory tests, typecheck, and targeted Biome checks.
- Optional visual smoke can capture refinery screenshots and validate that generated scenes render to the canvas.

## Current Boundaries

- The simulated cloud is still local under `cloud/`; it models the future on-demand cloud pack download flow.
- Not every equipment type must be recipe-backed. Semantic profile-parts remain a valid high-quality path for industry packs.
- Unknown or highly custom equipment can fall back to generic editable geometry drafts.
- User-managed WebSocket source add/remove UI is deferred; fixed data sources are the current validation path.
- Full OpenUSD, real physics simulation, node-graph authoring, and multi-user collaboration are not part of this first release.

## Release Candidate Commands

Fast release-candidate gate:

```bash
bun run --cwd apps/editor factory:release-candidate
```

Write release-readiness JSON and product-facing notes:

```bash
bun run --cwd apps/editor factory:release-qa -- --out-dir apps/editor/qa-artifacts/factory-release-readiness/latest
```

Run visual smoke when a local editor server is available:

```bash
bun run --cwd apps/editor factory:release-candidate -- --with-visual-smoke --base-url http://localhost:3002
```

Generated QA artifacts are local release evidence and are intentionally ignored by git under `apps/editor/qa-artifacts/`.
