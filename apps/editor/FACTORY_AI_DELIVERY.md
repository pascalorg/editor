# Factory AI Delivery Checklist

This document summarizes the factory conversation capability after the process-line and selection-edit work. It is meant to be the handoff surface for review, QA, and future template expansion.

## Capability Matrix

| User request shape | Route | Scene output | Primary files | Verification |
| --- | --- | --- | --- | --- |
| Factory shell, room, or production-line layout | Layout planner and patch composer | Editable `zone`, `slab`, `ceiling`, `wall`, `door`, `window`, station zones | `apps/editor/lib/ai-harness-runs/factory-planner.ts`, `apps/editor/lib/ai-harness-runs/factory-layout-patches.ts`, `apps/editor/lib/ai-harness-runs/factory-layout-composer.ts` | `factory-planner.test.ts`, `factory-layout-patches.test.ts`, `factory-layout-composer.test.ts` |
| Water electrolysis / hydrogen workshop | Process-line template | Factory shell, station zones, native tanks/boxes, routed pipes, routed cable tray, tee/elbow fittings, generated electrolyzer assembly | `process-template-registry.ts`, `process-line-composer.ts`, `process-line-routing.ts`, `process-equipment-resolver.ts`, `factory-runner.ts` | `process-line-composer.test.ts`, `process-equipment-resolver.test.ts`, `factory-ai-regression.test.ts`, `e2e/factory-ai.spec.ts` |
| Known factory catalog item | Catalog-item plan | Explicit catalog item patch only for direct item requests | `factory-planner.ts`, `factory-runner.ts`, `factory-agent-prompt.ts` | `factory-planner.test.ts`, `factory-runner.test.ts` |
| Long-tail equipment in a factory context | Primitive generation fallback | Generated editable primitive assembly, placed by the factory runner | `primitive-generation-service.ts`, `factory-runner.ts`, `packages/editor/src/lib/ai-generated-geometry-nodes.ts` | `primitive-generation-service.test.ts`, `factory-runner.test.ts` |
| Selected assembly recolor | Selection edit | Update patches for editable selected descendants | `factory-selection-edit.ts`, `ai-chat-panel/index.tsx` | `factory-selection-edit.test.ts`, `factory-runner.test.ts`, `e2e/factory-ai.spec.ts` |
| Selected tank shape change | Selection edit | Tank `kind` update patch (`vertical`, `horizontal`, `spherical`) | `factory-selection-edit.ts`, `ai-chat-panel/index.tsx` | `factory-selection-edit.test.ts`, `factory-runner.test.ts`, `e2e/factory-ai.spec.ts` |
| Process-line positioning quality | Layout solver and diagnostics | Linear placement, compact spacing fallback, parallel-bay fallback, boundary fit, clearance overlap, connection endpoint diagnostics, and clearance-aware orthogonal routing | `process-line-layout.ts`, `process-line-routing.ts`, `process-line-composer.ts`, `factory-runner.ts` | `process-line-layout.test.ts`, `process-line-composer.test.ts`, `factory-runner.test.ts` |
| Unsafe or legacy patch payload | Patch safety gate | Rejects catalog `item` nodes in automatic process lines and structural update fields | `packages/editor/src/lib/factory-scene-patch-safety.ts`, `ai-chat-panel/index.tsx` | `factory-scene-patch-safety.test.ts` |

## Current Browser Smoke

`apps/editor/e2e/factory-ai.spec.ts` covers the main end-to-end happy path:

1. Creates a fresh scene and AI conversation.
2. Sends `create a chemical factory hydrogen electrolysis workshop`.
3. Verifies native tanks, pipes, pipe fittings, cable tray, and generated electrolyzer assembly exist.
4. Selects the generated electrolyzer assembly and recolors its editable children green.
5. Selects a tank and changes its orientation.
6. Verifies the final graph through `/api/scenes/:id`.
7. Verifies no legacy factory GLB item requests were made.

The smoke uses `FACTORY_E2E_SMOKE=1` and `NEXT_PUBLIC_FACTORY_E2E_SMOKE=1` to avoid external LLM calls and to expose a test-only scene/selection bridge.

## CI

The factory workflow lives in `.github/workflows/editor-factory-ai.yml`.

It runs on PRs and pushes that touch factory AI, AI harness, relevant scene schemas/stores, Playwright config, or the lockfile.

Checks:

```bash
bunx biome check <factory AI surfaces>
bun run --cwd apps/editor check-types
bun run --cwd packages/editor check-types
bun test apps/editor/lib/ai-harness-runs packages/editor/src/lib/factory-scene-patch-safety.test.ts
bunx playwright install --with-deps chromium
bun run --cwd apps/editor e2e:factory
```

## Extension Rules

- Add a new process line by registering a template in `process-template-registry.ts`, then add resolver/composer tests before relying on the browser smoke.
- Prefer native editable nodes for known industrial primitives: `tank`, `pipe`, `pipe-fitting`, `cable-tray`, and simple `box` stations.
- Use primitive generation only for stations that do not have a good native editable node.
- Keep automatic process-line patches free of catalog `item` nodes unless an explicit future product decision allows that route.
- Keep every process-line template covered by layout diagnostics for boundary fit, clearance overlap, connection endpoint validity, and routed connection behavior.
- For selection edits, include selected assembly descendants in the context and update only editable surface fields or supported domain fields.
- Any new update patch field should be checked against `factory-scene-patch-safety.ts` before being emitted by the runner.

## Known Gaps

| Gap | Risk | Recommended next step |
| --- | --- | --- |
| Browser smoke uses deterministic smoke planning/generation | It validates app integration, not live LLM quality | Add a separate manual or scheduled live-provider eval when credentials are available |
| Only one process template is implemented | New production-line domains still need curated templates/resolvers | Add templates one at a time with unit coverage and fixture prompts |
| Layout solver is intentionally small | It can compact spacing or switch to parallel bays, but does not optimize globally | Add scoring and richer strategies such as U-shaped layout, aisle reservation, and utility corridors |
| Routing is local per connection | Individual pipe and cable-tray routes avoid station clearance boxes, but there is no global pipe rack, shared corridor, or route bundling yet | Add scored utility corridors and shared route lanes before adding many more dense process templates |
| Selection edits cover color and tank kind only | Users may ask for scale, move, rotate, label, or material finish | Add a typed selection-edit intent table before broadening edit operations |
| E2E is desktop Chromium only | Mobile and other browser regressions are not covered | Add mobile viewport smoke only after factory UI stabilizes |
| No pixel-level visual assertion | Graph correctness can pass while visual framing degrades | Add a lightweight screenshot or canvas nonblank assertion once e2e runtime is stable |
| Final API assertion depends on autosave | Slow CI machines can spend most of the test waiting for persistence | If this flakes, expose a test-only flush/save hook instead of increasing timeout further |

## Local Verification Run

Last known-good local verification:

```bash
bunx biome check apps/editor/e2e/factory-ai.spec.ts apps/editor/playwright.config.ts packages/editor/src/components/ui/sidebar/panels/ai-chat-panel/index.tsx
bun run check-types # from apps/editor
bun run check-types # from packages/editor
bun test apps/editor/lib/ai-harness-runs packages/editor/src/lib/factory-scene-patch-safety.test.ts
bun run e2e:factory # from apps/editor
git diff --check
```
