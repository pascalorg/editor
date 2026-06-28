---
name: review-architecture
description: Review a PR against the Pascal architectural rules — package boundaries (core/viewer/editor/nodes), the registry-driven composition model (def.geometry / def.renderer / def.system), legacy-dispatch regressions, the slots + world-scale-UV convention for new nodes/geometry, hook hygiene (useEditor/useScene/useViewer), and selector performance. Use when the user asks to review a PR, audit a branch, or check that changes respect the codebase's architecture.
allowed-tools: Bash(git *) Bash(gh *) Read Grep Glob
---

Architectural review for Pascal PRs. The user will provide a PR URL, branch name, or ask to review the current branch.

## 1. Load the rules (required — do not skip)

Read these before reviewing any diff. They are the source of truth, not your training data:

- `wiki/architecture/layers.md`
- `wiki/architecture/systems.md` — core systems vs viewer systems, what each may do
- `wiki/architecture/renderers.md` — renderer responsibilities and prohibitions
- `wiki/architecture/tools.md` — editor tools live only in `apps/editor/components/tools/` or `packages/nodes/src/<kind>/`
- `wiki/architecture/viewer-isolation.md` — viewer must stay editor-agnostic
- `wiki/architecture/node-definitions.md` — the three-checkbox composition model (`geometry` / `renderer` / `system`)
- `wiki/architecture/plugin-authoring.md` — public contract for external node packs

Required on every review. Read the remaining pages on demand when the diff touches their subject area:

- `wiki/architecture/selection-managers.md`
- `wiki/architecture/scene-registry.md`
- `wiki/architecture/spatial-queries.md`
- `wiki/architecture/node-schemas.md`
- `wiki/architecture/events.md`
- `wiki/architecture/interaction-scope.md` — the interaction state machine + the unified snapping/modifier convention. Read whenever the diff touches a tool, a `move-tool` / `selection` / endpoint / reshape file, `lib/interaction/**`, `lib/snapping-mode.ts`, or `use-interaction-scope`.

If anything in the diff looks like a new dispatch surface or registry concept, also skim the live charter at `plans/editor-node-registry.md` (in the private-editor repo) — it owns the current contract and which kind sits at which migration stage.

## 2. Fetch the diff

```bash
# If the user gave a PR URL or number:
gh pr diff <pr-number-or-url>

# If reviewing the current branch:
git diff main...HEAD
```

Also list changed files so you can map each to the relevant rule:

```bash
gh pr view <pr> --json files --jq '.files[].path'
# or
git diff --name-only main...HEAD
```

## 3. Layer classification — do this BEFORE the checklist

For every new file, new type, new store field, or new exported helper introduced by the diff, answer one question: **which package does this belong to — `core`, `viewer`, `editor`, or `nodes`?** If the answer is "editor" but the code lives in `packages/core` or `packages/viewer` (or vice versa), or if kind-specific code lands anywhere other than `packages/nodes/src/<kind>/`, flag it as a **blocker**. This is the most common and most damaging class of violation, and the checklist below won't reliably catch it on its own — do this pass explicitly.

### The four packages and what they own

**`packages/core` — domain data + pure logic.**
Owns: node schemas, the scene store (`useScene`), live transforms store, core systems (wall mitering, slab polygons, space detection), event bus, plain 2D/3D math helpers, `sceneRegistry`, the registry primitives (`nodeRegistry`, `registerNode`, `loadPlugin`, `discoverPlugins`/`setPluginDiscovery`, `SceneApi`, `Plugin`/`NodeDefinition` types). Consumed by every downstream package, including read-only embeds. Must not know about: Three.js/R3F, `packages/viewer`, `apps/editor`, `packages/nodes`, any rendering or UI concept, any tool/mode/phase concept, or any *view*-specific concept (floorplan, paint preview, cursor indicators, selection outline styling).

**`packages/viewer` — the 3D canvas, shippable standalone.**
Owns: `<Viewer>`, the generic `<NodeRenderer>` / `<ParametricNodeRenderer>` / `<GeometrySystem>` / `<RegisteredSystems>` / `<FloorplanRegistryLayer>` plumbing, viewer systems (cutouts, zones, level positions, scans), the viewer store (`useViewer`) *for genuine presentation state only* (selection path, camera/level/wall/view modes, theme, display toggles, hover id), `useNodeEvents`. Consumed by both the editor and the read-only `/viewer/[id]` route. Must not know about: editor state (`useEditor`, tools, phases, modes), editor-only names baked into presentation modes (`'delete'`, `'paint-ready'`), editor-only state types (material preview, active paint target, floorplan anything), `packages/nodes`.

**`packages/editor` (and `apps/editor`) — the editing experience.**
Owns: the tool framework (`useDragAction`, `ParametricInspector`, `<MoveRegistryNodeTool>`, the registry-aware dispatchers in `tool-manager.tsx` / `MoveTool` / `panel-manager.tsx` / `helper-manager.tsx`), `useEditor`, action menus, panels, the floorplan panel and its helpers, paint mode, selection-manager phase/mode logic, cursor badges, command palette, keyboard shortcuts — anything absent from the read-only viewer route. Injects itself into `<Viewer>` via children and props, never the reverse. Must not import from `packages/nodes`.

**`packages/nodes` — the built-in plugin (`pascal:core`).**
Owns: one folder per node kind (`packages/nodes/src/<kind>/`) containing `definition.ts`, `schema.ts`, optionally `geometry.ts` / `renderer.tsx` / `system.tsx` / `floorplan.ts` / `tool.tsx` / `move-tool.tsx` / `panel.tsx` / `parametrics.ts` / `preview.tsx`. Exports `builtinPlugin`. Depends on `editor`, `viewer`, and `core` via their public surfaces — the same surfaces a third-party plugin uses (peer-dep style). **Nothing in `core/`, `viewer/`, or `editor/` may import from `@pascal-app/nodes`.** The dependency arrow is one-way: framework code consults `nodeRegistry`, never reaches into a specific kind's folder.

### Triggers that mean "this is probably in the wrong package"

1. **Would the read-only `/viewer/[id]` route need this?** If no, it belongs in `apps/editor` / `packages/editor`.
2. **Does the name contain an editor-specific word?** (`Floorplan`, `Paint…`, `Draft…`, `Marquee`, `CursorBadge`, `HoverMode`, `…Tool`, `Moving…`, `Curving…`.) Default to editor and justify loudly if it's anywhere else.
3. **Does the type or field reference a tool/mode/phase vocabulary?** (`'delete'`, `'paint-ready'`, `'material-paint'`, `'site'`/`'structure'`/`'furnish'`, `'build'`/`'edit'`.) Belongs in `useEditor`, not `useViewer` or core.
4. **Does the helper compute something only a 2D editor view needs?** (Floorplan transforms, measurement offsets, SVG path builders, marquee bounds scoped to floorplan.) Editor. Generic 2D geometry that any view could use (polygon math, rotation, clamping, line thickening) can live in core *as long as its names are generic* — no `Floorplan` prefix.
5. **Does a new store field have a setter that no part of the target layer ever calls?** (e.g. `setMaterialPreview` in `useViewer` that only the editor would ever invoke.) That's a layering smell — the state belongs in the caller's layer.
6. **Does the new file mention a specific kind by name?** (`door-…`, `wall-…`, `item-…`, etc.) Then it belongs in `packages/nodes/src/<kind>/`, **not** under `packages/viewer/src/components/renderers/<kind>/`, `packages/viewer/src/systems/<kind>.ts`, `packages/editor/src/components/tools/<kind>/`, or `packages/editor/src/components/ui/panels/<kind>-panel.tsx`. Those legacy locations were deleted at Phase 6 cleanup — reintroducing one is a regression to the dispatch model.
7. **Does an `import` line read `from '@pascal-app/nodes'` inside `core/`, `viewer/`, or `editor/`?** Blocker. The Biome `noRestrictedImports` rule already bans this; if it slipped through, the framework is reaching down into the plugin.

Write the classification down before writing findings. If core gains "Floorplan" types, the viewer gains paint-mode vocabulary, a renderer grows editor awareness, or a kind-specific file appears outside `packages/nodes/src/<kind>/` — those are the blockers to lead with, not downstream symptoms.

## 4. Review checklist

### A. Package boundaries

- `packages/viewer/**` does not import from `@pascal-app/editor`, `apps/editor`, or `@pascal-app/nodes`, and does not reference `useEditor`, tool state, phase, or mode.
- `packages/core/**` does not import Three.js, react-three-fiber, `@pascal-app/viewer`, `@pascal-app/editor`, or `@pascal-app/nodes`.
- `packages/editor/**` does not import from `@pascal-app/nodes`.
- `packages/core/**` does not introduce types or helpers named after an editor view (`Floorplan*`, `Paint*`, `Draft*`). Generic plan-geometry helpers are fine; view-specific vocabulary is not.
- No new `case '<kind>':` clauses (or equivalent kind-specific branching keyed on `node.type`) inside `packages/viewer/**` or `packages/editor/**`. Phase 6 deleted these; the dispatch happens via `nodeRegistry`. The exceptions left in tree are `treeNodeByType` (a lookup *map*, not a switch) and unit-formatting switches (`centimeters` / `feet` / `inches`). Any new `case 'door'|'wall'|'item'…` in a framework package is a blocker — the behavior belongs on the kind's `NodeDefinition`.
- Tools mutate `useScene` (committed state) and `useLiveTransforms` (ephemeral drag state); direct `sceneRegistry` mesh transforms are allowed only under the live-drag exception in `wiki/architecture/tools.md`. No business logic, no imports from `packages/viewer`.

### B. Node registry & composition (`packages/nodes`)

If the PR adds or modifies a node kind, check against `wiki/architecture/node-definitions.md` and `wiki/architecture/plugin-authoring.md`:

- **Three independent fields**: `def.geometry?: (node, ctx) => Object3D`, `def.renderer?: () => Promise<{ default }>`, `def.system?: () => Promise<{ default }>`. There is no discriminator — presence is participation. Setting all three is fine if the kind genuinely needs them; setting a `def.system` whose only job is to rebuild geometry on dirty is a smell — collapse to `def.geometry` and let `<GeometrySystem>` do the work.
- **Builders must be pure.** A `def.geometry` function must not import `useScene`, must not mutate the store, and must not depend on React context. Read other nodes via `GeometryContext` (`ctx.resolve` / `ctx.children` / `ctx.siblings` / `ctx.parent`).
- **Builders emit local-space children.** `<ParametricNodeRenderer>` binds `<group position={liveTransform?.position ?? node.position}>` in JSX. A builder that bakes world position into vertex coords, or a system that imperatively writes `group.position` / `group.rotation`, will desync R3F's prop binding — the node will snap to `(0,0,0)` after rebuild. Flag any imperative `group.position.set(...)` inside `def.geometry` or a registered system. (Tool-driven `sceneRegistry.nodes.get(id).position.set(...)` during a live drag is fine and is the documented pattern — see hook hygiene below.)
- **Tag geometry-built children.** `<GeometrySystem>` only disposes children carrying `userData.__fromGeometry = true`. Custom systems that imperatively add children to a registered group must follow the same convention if the group can host React-mounted children (e.g. shelf surfaces hosting items).
- **One registered mesh per node ID.** If a custom renderer mounts multiple objects, register the parent group (or whichever object the system needs to address via `sceneRegistry.nodes.get(id)`).
- **Previews must clone cached materials.** If `def.preview` calls the geometry builder and then sets `material.opacity = 0.5`, but the builder caches materials at module scope (most do, keyed on `material` / `materialPreset`), the mutation leaks into every committed instance. Clone, mutate the clone, reassign `mesh.material`, dispose only the clone on unmount. Reference: `nodes/src/shelf/preview.tsx`.
- **Schema changes must keep old scenes loadable.** Any diff that adds, renames, removes, or retypes a property on a node schema needs a load path for scenes saved before the change (parsed through `AnyNode` in `SceneState.setScene`). A *new* field needs a Zod `.default()` / `.optional()`. A *rename / removal / retype* needs a `migrateNodes` entry in `packages/core/src/store/use-scene.ts` that rewrites the legacy shape before parse — a `.default()` alone silently drops the old value. A schema diff that does neither is a blocker: it breaks every existing scene. See `wiki/architecture/node-schemas.md` § Schema Evolution.
- **Host kinds need `children` on the schema.** If `def.relations.hosts` is set, the schema must declare `children: z.array(z.string()).default([])` (and `migrateNodes` must patch existing scenes). Otherwise `useScene.createNode(child, parentId)` writes a `parent.children` entry into nothing and the host never sees the new child.
- **Movable opt-in.** `MoveTool` dispatches to `MoveRegistryNodeTool` only when `def.capabilities.movable` is set. Kinds with bespoke move semantics (wall endpoint drag with linked-wall cascade, slab vertex edit, etc.) deliberately omit `movable` and supply `def.affordanceTools.move` instead. Force-routing a bespoke-move kind through generic dispatch (`nodeRegistry.has(kind)` instead of `def.capabilities.movable`) is a regression — call it out. The bug history is documented in `plans/editor-node-registry.md` ("Capability-driven move dispatch").
- **Paint dispatch lives on `def.capabilities.paint`.** A paintable kind declares `resolveRole` / `buildPatch` / `applyPreview` (+ optional `getEffectiveMaterial`) on `PaintCapability`; the editor's selection-manager routes hover / click / preview through the generic dispatcher. A PR that adds an `if (node.type === '<kind>')` arm to paint-mode handling, paint-preview application, or material picker resolution is a regression — the behaviour belongs on the kind's `paint` capability. See `packages/core/src/registry/types.ts` (`PaintCapability`).
- **Slots + world-scale UVs for paintable surfaces.** A new kind (or geometry change) that exposes paintable parts must follow the unified slot convention, not reinvent it:
  - **Paintable parts are slots, carried on the node.** Overrides live in a `slots` record (`slotId → MaterialRef`, `scene:`/`library:`) on the schema, resolved via `def.capabilities.paint` — not ad-hoc per-surface `material` / `materialPreset` fields, and not a parallel store. A new paintable kind whose schema lacks `slots` (or whose duplicate / preset / clone path drops it) is a blocker: it silently loses painted materials. (Slots are plain data — generic clone/parse preserves them; bespoke draft-rebuild placement paths must thread them through explicitly. Reference bug: item duplicate rebuilt the draft from `asset` and dropped `slots`.)
  - **Texturable geometry emits UVs in metres (1 UV unit = 1 m).** Any `def.geometry` producing a surface a finish can tile onto must generate UVs at the same world scale walls / slabs / roofs use, because catalog finishes set `repeat` as tiles-per-metre. Unitless, bounding-box-normalised, or hardcoded UVs that don't scale with the surface are a blocker — finishes won't tile consistently. Flat-colour-only surfaces need no UVs. GLB item authoring follows the same contract via `slot_`-prefixed materials (case-insensitive, `slot_` → slot id). See `wiki/architecture/materials-and-themes.md` § "Texture world scale" and `wiki/architecture/item-authoring.md`.
- **Floor elevation lives on `def.capabilities.floorPlaced`.** Kinds that rest on a level and lift over overlapping slabs declare a `footprint` (and optional `applies` predicate) on `FloorPlacedConfig`; the generic `<FloorElevationSystem>` writes `slabElevation + node.position[1]` onto the registered mesh on each dirty mark. A new per-kind `useEffect` / per-kind system that recomputes Y from slab overlap is a regression — the per-kind block was lifted out of `ItemSystem` in Phase 6.1. See `packages/core/src/registry/types.ts` (`FloorPlacedConfig`).
- **Render-mode behaviour goes through `def.surfaceRole`.** Solid / Rendered / Clay viewer modes look up the kind's `surfaceRole` on `NodeDefinition` to pick the right material strategy (clay overrides, edge passes, theme overlays). New `if (node.type === '<kind>')` arms inside the render-mode pipeline or theme application are a regression — the behaviour belongs on `def.surfaceRole`. See `packages/core/src/registry/types.ts:529`.
- **Capability names must describe verbs, not host kinds.** `movable` / `paint` / `floorPlaced` / `cuttable` / `selectable` describe *what the node does*. A new capability named after a host kind (`slabAccessory`, `wallAccessory`, `siteAccessory`, anything `Xaccessory` / `Xhosted` shaped) couples the registry's type surface to one specific host and reads as precedent for the next reviewer. Blocker. Push back: generalise into a paired *host-side* capability ("I merge subtractive accessories from my children") + *accessory-side* capability ("I provide a cut geometry, cascade my dirty mark to my host's parent"). The single existing case — `capabilities.roofAccessory` (`packages/core/src/registry/types.ts:791`, consumed by `packages/viewer/src/systems/roof/roof-system.tsx`) — is documented tech debt; do not extend the pattern.
- **Per-kind files in legacy locations are a regression.** New `viewer/src/components/renderers/<kind>/*`, `viewer/src/systems/<kind>-system.tsx`, `editor/src/components/tools/<kind>/*`, `editor/src/components/ui/panels/<kind>-panel.tsx`, `editor/src/components/ui/helpers/<kind>-helper.tsx`, or inline `useMemo` floor-plan entry-builders inside `editor/src/components/editor/floorplan-panel.tsx` — all of these were systematically deleted at Phase 6. The behavior belongs on the kind's `NodeDefinition` (`def.renderer` / `def.system` / `def.geometry` / `def.tool` / `def.affordanceTools` / `parametrics.customPanel` / `def.toolHints` / `def.floorplan`).
- **Floor-plan output via `def.floorplan`.** New per-kind floor-plan rendering must return `FloorplanGeometry` from `def.floorplan(node, ctx)` and be rendered by `<FloorplanRegistryLayer>`. New inline branches in `floorplan-panel.tsx` are a blocker.
- **Plugin contract surface.** A PR that extends the v1 plugin surface — adding `plugin.materials`, `plugin.systems`, `plugin.panels`, or making plugins extend host stores (`useScene` / `useEditor` / `useViewer`) — is out of scope for the v1 contract documented in `wiki/architecture/plugin-authoring.md`. Either the change belongs as a new field on `NodeDefinition` (additive, doesn't bump `apiVersion`) or it needs its own plan.

### C. Hook hygiene (`useEditor`, `useScene`, `useViewer`)

- Stores hold state + setters only. No business logic, side effects, async work, or derived computations inside the store definition.
- Derived values belong in selectors or systems, not in the store body.
- No cross-store coupling: a store's action should not call another store's actions inside itself.
- New state added to `useViewer` must be presentation-only (selection, camera, level mode, display toggles). Editor-only state (active tool, phase, edit mode, paint preview, floorplan state) goes in `useEditor`.
- **Node code does not import `useScene` directly.** A kind's geometry / system / tool should read and write through `SceneApi` (passed in by the framework) or `GeometryContext`. Direct `useScene.getState()` calls inside `packages/nodes/src/<kind>/` are a smell — they bypass the registry's IoC point and make the code harder to test.
- **Live drag motion is imperative, not store-driven.** Tools must not call `useLiveTransforms.set(...)` per `grid:move` tick to animate registered parametric kinds — the selector path doesn't reliably re-render and the mesh visibly disappears mid-drag. Use `sceneRegistry.nodes.get(node.id)?.position.set(x, y, z)` instead, and commit once at the end via `useScene.temporal.getState().resume() → updateNode → pause()`. The reference implementation is `MoveRegistryNodeTool`. This is the *only* sanctioned use of imperative mesh transforms by a tool; flag any other location that does the same.
- **Data-driven drags preview via `useLiveNodeOverrides`, never per-tick `useScene`.** A kind whose geometry is recomputed from data fields (wall `start`/`end`, opening host-cut, endpoint reshape) previews by publishing field patches to `useLiveNodeOverrides` (merged by `getEffectiveWall` / `getEffectiveNode`), writing the scene store **once on commit**. A tool that calls `useScene.updateNodes`/`updateNode` on `grid:move` (or any per-pointer-move tick) is a **blocker** — it swaps the `nodes` map ref and re-renders every `useScene(s => s.nodes)` subscriber app-wide each frame (`markDirty` per tick is fine). Grep tell: `updateNode(s)?(` in an `onGridMove`/`onMove`/`applyPreview` path under `packages/nodes/src/<kind>/`. See `wiki/architecture/tools.md` § "Data-driven live drag".

### D. Selector performance

- Top-level components (pages, layouts, providers, `<Viewer>` siblings) must not subscribe to large or frequently-changing slices — e.g. `useScene(s => s.nodes)`, `useScene(s => s)`. Flag these: they re-render the whole subtree on every mutation.
- Selectors that return new object or array references each call (e.g. `s => ({ a: s.a, b: s.b })`, `s => s.items.filter(...)`) without a custom equality function (shallow or custom) are re-render hazards.
- Prefer subscribing by ID deep in the tree (one node per renderer) over subscribing to the full collection high up.
- Inside a `<XxxPanel>` (legacy or `parametrics.customPanel`-mounted), avoid `useScene(s => s.nodes[selectedId])` as a callback dep — it changes every tick and pushes `useCallback` into infinite-loop territory. The recipe is in `plans/editor-node-registry.md` under "Panel slider-drag fix recipe".
- **Per-node list renderers subscribe per-node, not to the whole live Map.** A list that draws one child per node (`FloorplanRegistryLayer` → `FloorplanRegistryEntry`) must have each child subscribe to its **own** slice (`useLiveTransforms(s => s.transforms.get(id))` / `overrides.get(id)`) and be `memo`'d with referentially stable props; the parent subscribes only to the stable id list. Subscribing the parent or a child to the whole `transforms`/`overrides` Map, dropping a `memo`, or passing unstable props re-renders all N children every drag tick — a flood that type-checks and passes tests. Sibling invalidation goes through a per-node epoch, not a whole-layer re-render. See `wiki/architecture/tools.md` § "Floorplan registry: per-node subscriptions".

### E. Separation of concerns

- Viewer and core stay unaware of editor-specific concepts (tools, phases, active modes, editor UI state, view-specific helpers).
- Editor-only overlays and systems are injected as children of `<Viewer>`, not added inside the viewer package.
- **Editor overlay meshes must carry the editor layer.** Any new `<mesh>` / `<line*>` / `<points>` / `<sprite>` an editor overlay or tool component adds to the 3D scene (gizmos, handles, guides, previews, cursor meshes, marquees) must set `layers={EDITOR_LAYER}` — or `GRID_LAYER` for the ground grid, `ZONE_LAYER` for zone fills. The thumbnail/snapshot camera renders only layer 0, so an untagged overlay leaks into exports (and gets inked / SSGI-darkened in the live view). Flag any overlay-component primitive that omits the layer assignment. See `wiki/architecture/layers.md`.
- New node types are added by creating one folder under `packages/nodes/src/<kind>/` and registering its definition in `builtinPlugin.nodes`. Adding to a hand-maintained list elsewhere is a sign the registry hasn't absorbed that surface yet — check `plans/editor-node-registry.md` § "Known un-shimmed hardcoded lists" before assuming it's a violation.
- `AnyNode` is hand-maintained for now (full runtime derivation would lose static typing); `packages/nodes/src/index.test.ts` is the drift gate. If a PR adds a kind to `AnyNode` without adding it to `builtinPlugin.nodes` (or vice versa), the parity test catches it — but flag it in review too.

### F. Interaction scope, snapping & modifiers

Apply when the diff touches a tool, a `move-tool` / `selection` / endpoint / reshape file, `lib/interaction/**`, `lib/snapping-mode.ts`, or `use-interaction-scope`. Source of truth: `wiki/architecture/interaction-scope.md` and `wiki/architecture/tools.md`.

- **No new `useEditor` interaction flag.** "What the user is doing" is owned by `useInteractionScope` (`begin` / `update` / `end` / `endIf`). A new `useEditor` boolean for an in-flight interaction (`moving…`, `curving…`, `dragging…`, `editing…`, `…InFlight`) is a **blocker** — it goes through the scope. The legacy mirror flags are being retired, not extended.
- **Snapping is mode-driven; Shift is not a bypass.** A tool / `move-tool` / `selection` file that reads `event.shiftKey`, `event.nativeEvent?.shiftKey`, or `modifiers.shiftKey` to **bypass snapping** (raw cursor, skip grid, skip angle) is a **blocker** — the convention is Shift = *cycle the mode*, Alt = force/free. Snap state must come from `isGridSnapActive()` / `isMagneticSnapActive()` / `isAngleSnapActive()`. Grep tell: `shiftKey` near a snap / step / `projectToAngleLock` / alignment expression in `packages/nodes/src/<kind>/{tool,move-tool,selection}.tsx`. (Shift for *multi-select* in select mode, or a documented topology opt-out, is fine — confirm which it is.)
- **No hardcoded, ungated grid step.** A quantize that isn't gated on `isGridSnapActive()` — always `useEditor.getState().gridSnapStep`, or a constant `WALL_GRID_STEP` / `0.5` / `getSegmentGridStep()` applied unconditionally — ignores the active mode and is a **blocker**. The gated form is `const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0`.
- **Snappable kinds declare `snapProfile`.** A kind whose tool snaps but whose `NodeDefinition` omits `snapProfile` (`'item' | 'structural'`) gets no contextual chip and the wrong default mode-set — flag it (suggestion, blocker if it ships a bespoke per-kind snapping switch instead).
- **Bespoke movers must not open a `moving` scope.** `useMovingNode()` reads the scope, and `tool-manager` mounts the generic `MoveRegistryNodeTool` whenever it's non-null. A bespoke `move-tool.tsx` that calls `begin(movingScope(...))` or `setMovingNode(node)` re-creates the dual-path double-handling (FPS collapse / teleport on move). **Blocker.** Mode-driven snapping inside a bespoke mover must resolve the mode without a global `moving` / `reshaping` scope (see `interaction-scope.md` § "Snapping mode & modifiers").
- **`event.altKey` is not an alignment bypass.** A drafting/preview path that reads `event.altKey` to suppress Figma-alignment is a **blocker** in any **new** or **touched** tool — alignment follows the magnetic snap mode (`bypass: !isMagneticSnapActive()`). Alt is force/free for placement/move; it is **not** a snap/alignment modifier. The one sanctioned Alt use outside force is the **wall/fence chain-mode toggle** (clean Alt-tap → `cycleWallChainMode` / `cycleFenceChainMode`, via `hooks/use-keyboard.ts` `isChainModeContext()`), allowed only because wall/fence drafting has no force role. Grep tell: `event.altKey` near an `align` / `bypass` expression in a `tool.tsx` / floorplan preview path.
- **Known-legacy exceptions (migrate on touch).** Tracked debt in `plans/editor-placement-interaction-overhaul.md`; a PR that **touches** one must migrate it, not extend it; a **new** tool on either legacy pattern is a blocker regardless. (1) `shiftKey` snap-bypass in the MEP move/endpoint tools (`packages/nodes/src/{duct-segment,pipe-segment,liquid-line,lineset,duct-fitting}/{move-tool,selection}.tsx`). (2) `altKey` alignment-bypass in the roof / polygon / slab pointer-move previews (`components/editor/floorplan-panel.tsx`) and the `resolveSlabPlanPointSnap` / `resolveCeilingPlanPointSnap` paths. **Already migrated — do not regress:** wall + fence drafting (both modifier patterns) and `zone` drafting (`components/tools/zone/zone-tool.tsx` — mode-driven grid/angle gates, no Shift bypass).

## 5. Output format

Group findings by severity:

- **Blocker** — violates a rule in `wiki/architecture/` or breaks a layer/package boundary. Must be fixed before merge.
- **Suggestion** — likely problem, worth discussing. Not a hard block.
- **Nit** — minor, optional.

For each finding, include:

1. File and line: `path/to/file.ts:42`
2. The offending snippet (short — 1–5 lines)
3. The rule it violates, linked to the wiki page (e.g. `wiki/architecture/viewer-isolation.md`, `wiki/architecture/node-definitions.md`)
4. A concrete proposed fix

Skip formatting, import ordering, and anything CI already covers.

If the PR fully complies, say so explicitly — do not invent nits to appear thorough.

## 6. Final summary

End with:

- Blocker count, suggestion count, nit count
- One-sentence verdict: ready to merge / needs changes / needs discussion
- If blockers exist, list the files the author should open first
