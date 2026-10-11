# Decisions

What Pascal is, the choices that are settled, and what is deliberately left to whoever — or whatever — is doing the work. Humans and agents respect these without re-arguing them. To change one, open a PR that adds a superseding entry; never edit history. Everything *not* listed here is open: pick the best technical solution for the stated goal.

The private repo (`pascalorg/private-editor`) inherits this file and adds the hosted-product rules in its own `DECISIONS.md`.

## Vision

Pascal is the intelligence layer for physical infrastructure. Its core is a **living graph representation of buildings** that people and AI agents create, inspect, correct and enrich over time. The editor is where that graph is built: through nodes, capabilities and tools that agents read and write *semantically*, so that building through Pascal is both easier and more legible than building raw 3D in Blender or Unreal. Geometry, rendering and simulation are representations of the graph; Pascal is not a 3D engine.

Principles (owner, 2026-10-01 — detail in the private plan `scene-agent/editor-ai-first.md`):

- The graph outlives each interaction; later sessions enrich the same identities with an inspectable history.
- Knowledge stays honest: measured, inferred, unknown and proposed are kept apart, even when the scene looks complete.
- Geometry can arrive before semantics; classification enriches an object, it never silently replaces its shape.
- Human editing is a first-class path; convenience tools (room builder, presets) are optional.
- One capability has one implementation; chat, MCP, API, CLI and benchmarks share scene semantics, validation and diagnostics.
- Every durable edit is attributable and reversible; generated content goes through the same scene authority as manual edits.
- Visual quality and semantic richness are separate achievements.

Fidelity work is ordered **geometry → piping/MEP → device and item placement → final rendering**.

## Delegated to the model

Decide these yourself; do not ask, do not look for a rule:

- Libraries and patterns within the existing stack (React, R3F, three, zod, Bun, turbo).
- Refactors within the scope of the task, including rewriting code whose shape is wrong — say what you are replacing and why.
- File layout inside a package, naming, and the amount of abstraction a change needs.
- Test strategy for the change, within [T-001](#testing).
- Performance approach, as long as it feeds the existing caching, dirty lifecycle, batching and bake LODs rather than routing around them (E-010).
- How to verify: run the app, screenshot, write a probe — whatever proves the behaviour.

## Architecture invariants

Each entry: decision · why · enforced by · revisit when. Detail and examples live in `wiki/architecture/`.

**E-001 Dependency arrow.** `core → viewer → editor`; `nodes` (the built-in plugin) depends on all three and nothing imports `nodes` except the host. `core` has no runtime Three.js/R3F import; `viewer` knows no editor state (`useEditor`, tools, modes, paint, floorplan). · Why: core runs headless (MCP, CLI, workers); the viewer ships standalone. · Enforced: `biome.jsonc` `noRestrictedImports`, `packages/core/src/architecture.test.ts`, `review-architecture` skill. · Revisit: never.

**E-002 Registry-driven composition.** A node kind is one `NodeDefinition` in `packages/nodes/src/<kind>/` — schema, `geometry` / `renderer` / `system`, capabilities (`movable`, `paint`, `floorPlaced`, `cuts`, `selectable`, …), `floorplan`, `surfaceRole`, `snapProfile`. The framework dispatches through the registry; no new `case '<kind>'` in `viewer` or `editor`, no per-kind files in legacy locations. Capability names are verbs, not host kinds. · Why: plugins get the same powers as built-ins. · Enforced: `review-architecture` §B, `nodes/src/index.test.ts` registration gate. · Revisit: when a capability cannot be expressed as a definition field.

**E-003 Old scenes always load.** A schema change ships its load/migration path in the same PR; a floor-plate migration keeps visible area within 1 %. · Why: scenes are user data, some years old. · Enforced: `core/src/utils/*corpus*.test.ts`, `frozen-floor-gate.test.ts`. · Revisit: never.

**E-004 Snapping is a visible per-context mode.** Shift *tap* cycles the mode; Alt *hold* forces the raw cursor past snapping and collisions. No held-Shift bypass; never read `event.shiftKey` for snapping; grid steps are gated on `isGridSnapActive()`; snappable kinds declare `snapProfile`. · Why: hidden held keys are undiscoverable and un-portable to 2D. · Enforced: `review-architecture` §F. · See `wiki/architecture/tools.md`, `interaction-scope.md`.

**E-005 Interaction state has one owner.** "What the user is doing" lives in `useInteractionScope` (`begin / update / end / endIf`), not in new `useEditor` booleans. · Enforced: `review-architecture` §F.

**E-006 2D ↔ 3D parity.** A behaviour that applies to both views exists in both, ported in the same PR, or the PR says why it does not apply. · Why: the plan and the 3D view are two presentations of the same edit. · Enforced: review. · See `tools.md`.

**E-007 Live drags are imperative.** Drag motion goes through `useLiveTransforms` / `useLiveNodeOverrides`, never per-tick `useScene` writes; one gesture is one undo step. · Why: store writes per frame stall a complex scene. · Enforced: `review-architecture` §C/§D, perf harness.

**E-008 Dimension fields carry no arbitrary caps.** A numeric inspector field gets `min`/`max` only for a physical or schema reason. · See `inspector-field-limits.md`.

**E-009 Paintable surfaces are slots with metre-scale UVs.** Overrides live in a `slots` record on the node; texturable geometry emits UVs where 1 unit = 1 m. · Why: finishes tile identically on every kind. · Enforced: `review-architecture` §B.

**E-010 Fidelity non-negotiables (owner, 2026-09-24).** Any new mechanism must: keep existing plugins loading and rendering in published scenes; keep interactivity working in the published viewer and the bake; feed the existing caching, dirty lifecycle, batching and bake LODs; keep moving, stretching, zone detection, snapping, guides and undo fluid on a complex scene in 2D and 3D; plug into the registry, capabilities, parametrics, tools, floor plans, hosting protocol and MCP tools rather than beside them; let any geometry (custom designs, editable bodies, captured buildings) be moved, hosted, snapped, batched, zoned and exported like any node; and ship its agent tool and checks in the same slice. · Why: the abstractions and the semantic graph are the edge over raw 3D; a mechanism agents cannot drive does not exist for them. · Enforced: review against this list; a change that breaks one is redesigned, not shipped.

**E-011 Vertical model.** Levels store heights; wall and ceiling tops are plane-bound; slab thickness goes *down* from the stored top; controls hide the model rules from users. · See `vertical-model.md`.

**E-012 Room-first structure.** Rooms own intent (shared walls, raised floors, mezzanines); walls, plates and paint regions derive from them through the writers contract. · Enforced: `core/src/store/derived-writer-allowlist.test.ts`. · Rationale and migration acceptance (1 % floor-area) in the private plan `editor-modeling/editor-room-first-structure.md`.

**E-013 Surface hosting.** Any item can host any other on its top surfaces; the Y extent of the host is enough, there is no surface registry to expose. · Enforced: `core/src/services/surface-fit-policy.test.ts`.

**E-014 Plugin contract v1.** `Plugin` shape, `setPluginDiscovery`, lifecycle, materials/systems/panels scope as documented in `plugin-authoring.md`. Extending it is a decision, not a feature. · Enforced: `core/src/registry/plugin-v1-conformance.test.ts`.

**E-015 Public-repo hygiene (2026-10-01).** This repo is open source: no private plan paths in docs or skills (cite a wiki page or a decision ID), maintainer skills carry `metadata.internal: true`, product skills under `skills/` are the only discoverable ones. · Enforced: `scripts/validate-skills.ts` + policy tests.

**E-016 Plugins own their agent tools (owner, 2026-10-10).** A plugin's agent tools ship with the plugin, not in core: contracts as a `PluginAgentTools` in its `./agent-tools` export (zod only, like `core/agent-tools`, and versioned by the plugin), pure operations as an `AgentOperations` in `./agent-operations`, browser execution and cards as a `PluginChatExtension`. The `Plugin` manifest does not change (E-014), and one contract still serves both surfaces. Contract annotations are hints: the host decides which tools are offered, to whom, and with what authority. These are reviewed, trusted contributions, not a sandbox. · Why: a plugin with dozens of specialist tools keeps them versioned with its own code, and installing it extends every agent the way a connector does. · Enforced: `core/src/agent-tools/contracts-purity.test.ts` (the rule each plugin entry follows), `mcp/src/tools/shared-tools.test.ts` (a plugin's operation tool through a real client), the hosted parity test. · See `plugin-authoring.md`, `agent-surfaces.md`. · Revisit: when plugins are loaded without review.

## Testing

**T-001 (2026-10-01, owner).** A test protects an observable result, a persisted or wire contract, or an explicit architecture/performance invariant — and tolerates an equivalent implementation. Therefore: test through package exports; no source-grep, prose-pinning or import-spelling tests (use Biome rules); no cross-package `src/` imports in tests; no `mock.module` that forces sibling files to re-spawn `bun test`; no real sleeps (inject a clock); no tests named after review rounds or bots; refactor scaffolding (parity tables, "matches main" goldens, frozen copies of old code) is deleted in the PR that lands the refactor; performance claims live in `__bench__` / bench lanes, not unit gates; a bug fix is one repro in the feature's existing file, not a new `*-audit*` file; a test that needs an opt-in flag must have a lane that sets it, or go. "Internal" is not the deletion criterion: core's import boundary, the writers allowlist and the migration thresholds pin internals with external consequences and stay. · Why: 231k test lines (82k of them fixtures) had become the main cost of every change for people and agents alike. · Enforced: review; Biome rules as they land.

## Working agreements

- Rewrite when the current shape is wrong; say what you are replacing and why; keep the PR tied to its stated goal.
- No backwards-compatibility shims, dead code or speculative abstractions. Comments explain a non-obvious *why*.
- A PR describes only what its branch did and claims only checks that actually ran (`.agents/skills/open-pr`).
- `bun run ci` is exactly what CI runs; the git hooks are fast feedback, not the gate.

## Superseded

- "No massive rewrites unless warranted" (AGENTS.md, 2026-05) → replaced by the first working agreement on 2026-10-01: the codebase can be in a wrong shape and the rule was keeping it there.
