# Porting cheat-sheet: roof-system → registry shape

Reference for porting chimney / dormer / skylight / solar-panel / box-vent / ridge-vent into `packages/nodes/src/<kind>/`. Read alongside `packages/nodes/src/shelf/` (the canonical example) and `wiki/architecture/node-definitions.md`.

---

## 1. Folder layout (per kind)

```
packages/nodes/src/<kind>/
├── schema.ts              re-export from @pascal-app/core (Phase 5 keeps schemas there)
├── definition.ts          THE registration object — capabilities/parametrics/wiring
├── geometry.ts            pure (node, ctx) => Group              [if parametric]
├── renderer.tsx           custom React mount                     [only if you need JSX-only features]
├── system.tsx             per-frame useFrame component           [only if animation/cascade]
├── parametrics.ts         inspector descriptor (auto-derives UI)
├── preview.tsx            ghost preview for placement cursor
├── tool.tsx               placement tool (emits grid/node click → createNode)
├── floorplan.ts           pure (node) => FloorplanGeometry       [2D top-down]
├── floorplan-move.ts      2D drag handler (Path 1)               [if movable]
├── floorplan-affordances.ts handles/affordances in 2D            [optional]
├── index.ts               export { <kind>Definition }
└── __tests__/
    ├── schema.test.ts
    └── geometry.test.ts
```

You touch **only these files**. If you find yourself editing `node-renderer.tsx`, `tool-manager.tsx`, `panel-manager.tsx`, `node-display.ts`, `structure-tools.tsx`, `floorplan-panel.tsx`, or a sidebar tree file — stop. There's a `definition.ts` field for it.

---

## 2. The three-checkbox model

`def.geometry`, `def.renderer`, `def.system` are **independent**. Presence = participation.

| Combination | When | Examples |
|---|---|---|
| `geometry` only | Parametric meshes, no animation, no JSX-only primitives | shelf, item, column, wall |
| `geometry + system` | Parametric + per-frame work (animations, cascades) | **door, window, skylight** |
| `renderer` only | GLB / drei / `<Html>` / shader, no per-frame work | GLB-backed items |
| `renderer + system` | JSX-only tree + per-frame poking | zone |
| `renderer` (no geometry/system) | Static custom mount | rare |

Builders are PURE. No `useScene`, no store mutation, no React. Read scene via the `ctx` second arg if you need siblings/parent/children.

---

## 3. `NodeDefinition` field map

```ts
export const fooDefinition: NodeDefinition<typeof FooNode> = {
  // Identity
  kind: 'foo',
  schemaVersion: 1,
  schema: FooNode,
  category: 'roof' | 'furnish' | 'structure' | ...,

  // Initial state
  defaults: () => ({ ... }),                          // initial field values for new instances

  // Behaviour
  capabilities: {
    movable: { axes: ['x','z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, π/4, ...] },
    surfaces: {
      top: { height: (n) => ... },                    // single host surface
      custom: (n) => [{ position, normal }, ...],     // multi-surface hosts (shelf rows)
    },
    selectable: { hitVolume: 'bbox' | 'mesh' },
    duplicable: true,
    deletable: true,
    floorPlaced: {                                    // lift over raised slabs
      footprint: (n) => ({ dimensions: [w,h,d], rotation }),
    },
  },

  relations: {
    hosts: ['item', 'window', ...],                   // which kinds may parent to this
    cascadeDelete: 'descendants',
  },

  // Inspector
  parametrics: fooParametrics,

  // Three checkboxes
  geometry: buildFooGeometry,
  renderer: () => import('./renderer'),
  system:   () => import('./system'),                 // or { module: () => import('./system') }

  // 2D
  floorplan: buildFooFloorplan,
  floorplanMoveTarget: fooFloorplanMoveTarget,
  floorplanAffordances: fooFloorplanAffordances,

  // Tool
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [{ key: 'Left click', label: 'Place' }, { key: 'Esc', label: 'Cancel' }],

  // UI metadata
  presentation: {
    label: 'Foo',
    description: '...',
    icon: { kind: 'url', src: '/icons/foo.png' },
    paletteSection: 'roof',
    paletteOrder: 30,
  },

  // AI
  mcp: { description: 'A parametric foo. ...' },
}
```

---

## 4. Decisions for each of your 6 kinds

| Kind | geometry | renderer | system | parent kind | hosts | notes |
|---|---|---|---|---|---|---|
| **box-vent** | ✓ pure builder | — | — | roof-segment | — | smallest — port first |
| **ridge-vent** | ✓ pure builder | — | — | roof / roof-segment | — | similar to box-vent |
| **chimney** | ✓ (parent thickness via `ctx.parent`) | — | — | roof / roof-segment | — | CSG cutout into roof — mirror door's wall-cut pattern, look at how `ctx.parent` feeds wall thickness in door's geometry.ts |
| **solar-panel** | ✓ instanced array of cells | — | — | roof-segment | — | needs `roof-segment` to declare `surfaces` capability so placement coordinator can target it (see shelf's `surfaces.custom` for multi-surface) |
| **skylight** | ✓ frame/glass | — | ✓ open/close animation | roof / roof-segment | — | mirror `door` (geometry + system) — animation state lives in `useInteractive`, system advances + calls `markDirty` |
| **dormer** | ✓ trimmed against parent roof | possibly | possibly | roof-segment | window | the gnarliest — save for last. May need `relations.hosts: ['window']` + `children` field on schema (see "Host kinds need children" pitfall below) |

**Order: box-vent → ridge-vent → chimney → solar-panel → skylight → dormer.**

---

## 5. Wiring (two places, both small)

### 5a. Register the kind in the built-in plugin

In `packages/nodes/src/index.ts` add to the `nodes:` array + the re-export list:

```ts
import { fooDefinition } from './foo'
// ...
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [..., fooDefinition as unknown as AnyNodeDefinition],
}
export { fooDefinition } from './foo'
```

### 5b. Register the kind in the event bus

`useNodeEvents(node, 'foo')` typechecks against an `EditorEvents` map that hand-enumerates every kind. Without this step the renderer's `useNodeEvents` call fails to compile.

`packages/core/src/events/bus.ts`:
```ts
import type { FooNode } from '../schema'
// ...
export type FooEvent = NodeEvent<FooNode>
// ...
type EditorEvents = GridEvents &
  ...
  NodeEvents<'foo', FooEvent> &
  ...
```

`packages/core/src/index.ts` — add `FooEvent` to the type re-exports.

### 5c. Add to the AnyNode union (if the schema lives in core)

If `schema.ts` is a re-export from `core/schema/nodes/<kind>.ts`:
- Add an `export { FooNode } from './nodes/foo'` line to `packages/core/src/schema/index.ts`.
- Add `FooNode` to the discriminated union in `packages/core/src/schema/types.ts`.

That's everything. The registry bootstrap then wires palette entry, sidebar tree, inspector panel, renderer mount, and tool dispatch from `def.presentation` / `def.renderer` / `def.tool` / `def.parametrics`.

---

## 6. Pitfalls — read these BEFORE writing geometry

1. **Don't mutate `group.position` / `group.rotation` in geometry.** The renderer binds those via JSX (`<group position={liveTransform?.position ?? node.position}>`). Mutating them imperatively means R3F has no reason to re-apply them on the next render and the node snaps to origin on every rebuild.
2. **Builders emit local-space children.** Don't bake `node.position` into vertex coords. The group's transform is the parent's job.
3. **Tag geometry-built children with `userData.__fromGeometry`.** Otherwise the rebuild disposer will tear out hosted children (items dropped onto your shelf/roof). `<GeometrySystem>` does this for you when you return from `def.geometry`; only an issue if a custom `system.tsx` adds children imperatively.
4. **Preview must clone materials before mutating.** Module-level material caches are shared across every instance — setting `transparent=true` on the preview's material leaks into every placed shelf. See `shelf/preview.tsx` — it traverses, clones, swaps, and disposes only the clones.
5. **Host kinds need a `children: z.array(...).default([])` field on the schema.** Without it, `createNode(child, parentId)` writes `parentId` but the parent-side append is a no-op, so the child is in the store but never mounts. Applies to: dormer (if it hosts windows), any roof kind that hosts vents/skylights/solar-panels.
6. **`floorplanMoveTarget` Path 1 vs Path 2.** If 2D drag feels "ultra slow, lands in the wrong place," you forgot `def.floorplanMoveTarget` — see comment in shelf's `definition.ts`.

---

## 7. Porting recipe (per kind)

```bash
# 1. Snapshot the old source on the archive branch
git show roof-system-archive:packages/core/src/schema/nodes/<kind>.ts
git show roof-system-archive:packages/viewer/src/systems/<kind>/<kind>-geometry.ts
git show roof-system-archive:packages/viewer/src/components/renderers/<kind>/<kind>-renderer.tsx
git show roof-system-archive:packages/editor/src/components/tools/<kind>/move-<kind>-tool.tsx
git show roof-system-archive:packages/editor/src/components/ui/panels/<kind>-panel.tsx

# 2. Create the new folder
mkdir packages/nodes/src/<kind>

# 3. Port file-by-file in this order:
#   a. schema.ts        — re-export from core (move zod schema to core/schema/nodes/ if not already there)
#   b. geometry.ts      — extract the pure pieces. NO useScene, NO React, NO mutation.
#   c. parametrics.ts   — convert the old <kind>-panel.tsx fields into a ParametricDescriptor
#   d. preview.tsx      — call buildFooGeometry, clone+ghost materials (see shelf/preview.tsx)
#   e. tool.tsx         — use shelf/tool.tsx as the template
#   f. floorplan.ts     — pure (node) => FloorplanGeometry
#   g. floorplan-move.ts — only if movable in 2D (see shelf/floorplan-move.ts)
#   h. system.tsx       — only if you have animation (skylight)
#   i. renderer.tsx     — only if you need JSX-only features (probably none of yours)
#   j. definition.ts    — wire everything via capabilities/relations/parametrics/presentation/mcp
#   k. index.ts         — export { <kind>Definition }
#   l. __tests__/       — schema.test.ts + geometry.test.ts (parity test against snapshot is enough)

# 4. Register in packages/nodes/src/index.ts

# 5. Build, lint, run
pnpm build
pnpm lint
pnpm dev    # place, move, rotate, edit panel, delete, undo/redo

# 6. Verify via review-architecture skill before opening PR
```

---

## 8. Pre-PR checklist (per kind)

- [ ] All code lives under `packages/nodes/src/<kind>/`. Zero files modified outside this folder + `packages/nodes/src/index.ts` + (maybe) `apps/editor/public/icons/<kind>.png`.
- [ ] `def.geometry` is pure (no `useScene`, no React, no store mutation).
- [ ] Preview clones materials and disposes only clones.
- [ ] Children are in local space (no `node.position` baked into vertices).
- [ ] If host kind: `children` field on schema, `relations.hosts` declared, `cascadeDelete` set.
- [ ] `parametrics` covers every field a user might want to edit; `visibleIf` for style-dependent fields.
- [ ] `presentation.icon` exists; `paletteSection` and `paletteOrder` chosen.
- [ ] `mcp.description` describes the kind from an LLM's POV.
- [ ] `__tests__/schema.test.ts` round-trips defaults; `__tests__/geometry.test.ts` snapshots the built `Group` for a representative node.
- [ ] Place → move (2D + 3D) → rotate → paint → edit panel → undo all work.
- [ ] `review-architecture` skill passes on the branch.

---

## 9. Key files to keep open

- `packages/nodes/src/shelf/*` — canonical reference, every file.
- `packages/nodes/src/door/*` — geometry+system pattern (use for skylight).
- `packages/nodes/src/window/*` — cutout-into-parent pattern (use for chimney).
- `wiki/architecture/node-definitions.md` — three-checkbox model authority.
- `wiki/architecture/plugin-authoring.md` — registration contract.

---

## 10. Non-node work from this branch (port separately)

These don't fit the node migration — they're cross-cutting fixes that need their own small PRs against main:
- Wall placement perf + mitering + draft-angle arcs
- Stair opening system + spiral clamps
- Elevator improvements + first-person scoping
- Fence chaining + 2D move handles
- Door/window panel reorg by family
- Material library expansion + new textures
- Camera-aware move handles

Do these AFTER the node ports — they may already partially exist on main, or need re-baselining against the registry-era file layout.
