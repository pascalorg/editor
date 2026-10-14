# Systems

*Core and viewer systems architecture.*

Applies to: `packages/core/src/systems/**`, `packages/viewer/src/systems/**`.

Systems own business logic, geometry generation, and constraints. They run in the Three.js frame loop and are never rendered directly.

> **For registry-driven kinds, prefer no per-kind system.** If your kind's only job is "rebuild geometry on dirty", set `def.geometry` and let the framework's `<GeometrySystem>` handle the rebuild loop. Per-kind systems remain for *extra* responsibilities — animations, cross-kind dirty cascades, named-mesh material poking. See [node-definitions.md](node-definitions.md).

## Where systems live

### Core — `packages/core/src/systems/`

Plain data: no Three.js, no `useFrame` (DECISIONS.md E-001). Pure helpers, plus a few React components that subscribe to the scene store and write derived data back.

| Directory | Owns |
|---|---|
| `wall/` | Mitering, topology, tops, merge, finishes and layer bands, frame and reference line — the pure inputs of the viewer's `WallSystem` |
| `slab/` | Slab support and placement, `ensureSlabOpenings` |
| `stair/` | Rise, flight and footprints; `StairOpeningSystem` syncs rises and cuts slab openings |
| `elevator/` | Dispatch and runtime service, opening sync, `ElevatorOpeningSystem` |
| `roof/` | Footprint; `RoofElevationSystem` keeps wall-following roofs on their walls |
| `fence/` | Spline and centerline |

`owned-floor-openings.ts` / `reconcile-owned-floor-openings.ts` at the top level reconcile floor openings owned by other nodes.

### Viewer — `packages/viewer/src/systems/`

Three.js side-effects on registered objects (`sceneRegistry`). `<Viewer>` mounts the framework systems directly: `FloorElevationSystem`, `GeometrySystem`, core's `StairOpeningSystem` and `RoofElevationSystem`, and `<RegisteredSystems>`, which mounts every registered kind's `def.system`. The per-kind implementations below are exported by `@pascal-app/viewer` and wrapped by the kinds' `def.system` modules in `packages/nodes`.

| Directory | Owns |
|---|---|
| `geometry/` | `GeometrySystem`: rebuilds `def.geometry` kinds on dirty |
| `floor-elevation/` | `FloorElevationSystem`: lifts `floorPlaced` kinds over slabs |
| `level/` | `LevelSystem`: stacked / exploded / solo / manual level positions |
| `wall/` | `WallSystem` (dirty drain, miter cache, initial build) and `WallCutout` (opening holes) |
| `slab/`, `ceiling/`, `fence/`, `roof/`, `stair/`, `column/` | Kind geometry generators and their dirty consumers |
| `door/`, `window/` | Rebuild on dirty, plus the animation systems that advance `operationState` |
| `item/`, `item-light/`, `interactive/` | Item transforms, item lights, in-scene toggles and sliders |
| `zone/`, `guide/`, `scan/`, `elevator/` | Zone display and labels, helper geometry, point clouds, elevator interaction |
| `perf-action-settle/` | `?perf` settle detection |

### Frame priorities and the dirty lifecycle

Ceiling geometry consumes dirty marks at frame priority 2, like `GeometrySystem` (slabs).
The node batch snapshots marks at priority 1 and processes membership at priority 5,
so it releases old geometry and collects replacements after rebuilds. No consumer
clears a mark before priority 2: `FloorElevationSystem` lifts at priority 1 but
clears the marks it owns (floor-placed kinds with no `geometry` or `system`, such as
columns and procedural items) at priority 2. A definition's
`system.priority` orders mounted components; it does not set `useFrame` priority.

A kind joins by declaring `capabilities.batchable` (`BatchableConfig`): its scope
(`'level'` children, or `'wall'`-hosted openings that follow their wall), transient
exclusions, a settled test on the mounted root and, for geometry rebuilt in place, a
per-mesh allocation key. Items, columns, ceiling undersides, slab bodies, procedural
items, imported meshes and blocks directly under a level, plus wall-hosted
doors/windows, can join the level's `BatchedMesh` containers. Sources stay mounted and
draw-hidden. Only opaque single-material meshes join. Ceiling grids and hosted child
subtrees are excluded; containers preserve source shadow flags. Selection (including
external selection), live transforms and each slot paint preview target release
sources until settled; a playing procedural motion releases its item, and part
lights keep it out. Level mode/selected-level changes re-offer sources rejected while
shadow-only.

### Scene hydration and the initial wall build

**Where.** `setScene` gives each load a non-persisted hydration identity and publishes
its `hydrationToken` once synchronous reconciliation and deferred normalisation finish.
Openings are settled before that: the server-safe `ensureSceneOpenings(nodes)` runs in
`migrateNodes` right after M4/M5, derives stair rises from the graph (including slab and
terrain support), then ensures stair/elevator openings. It keeps what the scene already
has — a hole owned by that stair/elevator, or holes covering at least 99.9 % of the
proposed opening, count as present. Read-only snapshots get the same pure migration.

**What it guarantees.** Any ordinary document write — paused, remote and undo/redo
included — cancels a pending publication or invalidates an issued token before
subscribers run; pausing history grants no exemption. Dirty marks do not invalidate it,
so opening completion can still re-dirty its wall. Pointer input (captured on the canvas
before lazy systems mount) and any non-empty live override/transform map interrupt
hydration; `applySceneSnapshot` clears stale live maps first. The wall lifecycle owner
(`wall/wall-build-lifecycle.ts`) observes tokens independently of `WallSystem`, so a
consumer remount keeps the span, counters and pending neighbours; these
hydration-scoped records are the one exception to the unmount cache-cleanup rule below
(the miter cache is still cleared).

**Dirty lifecycle.** During the initial build `WallSystem` drains dirty walls under an
8 ms frame budget without the interactive 8-walls/frame cap; a wall with six or more
cutouts takes a frame of its own, and first builds skip neighbour re-invalidation
because the neighbours are queued for their own first builds. The build ends on the
first frame with no dirty walls and no pending neighbours, or on interruption. If no
wall rebuilds for 30 frames while dirty walls still lack meshes, the privilege is
revoked: their marks stay and a later mount rebuilds them. Afterwards interactive
scheduling applies — small edits rebuild immediately, larger queues progressively,
with an 80 ms trailing quiet window for neighbour invalidation. The wall batch waits
for the pending-neighbour queue; node batching keeps its 180 ms quiet clock.
`isWallInitialBuildActive()` and `getPendingWallRebuildCount()` report the state; with
`?perf`, `__pascalPerf.batchStats().wallDrain` and the `wall-initial-build` span add
per-frame counters.

### Floor elevation and hosted children

`FloorElevationSystem` writes mesh Y only for nodes directly parented to a level.
Hosted children inherit their host and any named-surface frame; a zero support lift
does not make a live world-space position safe to write into their local transform.
A plan-view exit can override the logical parent to a level while the mesh remains
mounted beneath its original host. The floor-elevation preview pass converts that
level pose through the inverse mounted ancestry, including a named-surface wrapper
and inherited slab lift. It saves the original local matrix state and restores it
when the override ends on cancel, re-entry or unmount; reparented commits keep their
new local pose. Ordinary hosted 3D previews retain their mounted local frame.
`packages/nodes/src/cabinet/__tests__/hosting-preview-pose.test.tsx` mounts the movers,
renderers and frame systems together to check this.

### Construction reveal

`ConstructionReveal` (mounted by the host inside `<Viewer>`, with a `reveals(commit)` policy and a
`level`) stages the new nodes of the commits it selects — the hosted editor selects commits whose
`author` is `agent` (`runAsSceneCommitAuthor` / `acquireSceneCommitAuthor` in core). It is
presentation only: the store write is done and is one undo step. A new node whose kind declares
`capabilities.reveal` stays unmounted (`NodeRenderer` returns null) until its start time, so its
geometry builds over frames. The order is phase (`foundation` → `structure` → `circulation` →
`openings` → `roof` → `furnishing`); every floor plays a phase at once, its nodes in a scattered
order (a stable hash of the id), evenly spaced, hosts before what they host; every start lands
within about 6 s by compressing the gaps, never by skipping a node.

A started node stays hidden until its first build clears its dirty mark, then moves in its
declared style, each a pose of `t` in [0, 1] that ends exactly at rest (`revealPoseAt`):

| Style | Motion | Built-in kinds |
|---|---|---|
| `rise` | scales Y up from its base | wall, fence |
| `scale` | grows from the base of its bounds' centre | (the `simple` level's fallback) |
| `settle` | lowered its declared `height` onto its support, soft landing | slab, ceiling |
| `drop` | falls its declared `height` like a load, lands with a squash and a small hop | column, stair, item, shelf, cabinet, procedural item |
| `cut` | pops from its centre with a small overshoot | door, window |
| `assemble` | holds still while its parts drop in one by one from its `height` | roof (its segments) |

Durations live in `REVEAL_TIMING.durationMs`, heights in each kind's declaration. The pose is
composed on the registered root by swapping its `updateMatrix`: a scale about the style's pivot
after the root's own transform, then a lift premultiplied in the parent's frame (so a root's own
non-uniform scale never stretches a fall). `position`, `quaternion` and `scale` stay owned by the
renderer, `FloorElevationSystem` and `LevelSystem`, and a rebuild keeps the pose.

An `assemble` node's new children that declare no reveal of their own are its parts: each drops in
on its own turn, including parts written in a later commit while the node still assembles.
`isRevealAssembling` / `subscribeRevealAssembling` tell its renderer to draw them apart; the roof
hides its merged shell and shows its segments, `RoofSystem` builds the shell meanwhile, and the
callback flips back synchronously, so a capture that ends the reveal sees the whole shell.

The host's `level` sets how much plays: `off` shows the build at once; `simple` keeps the order
with `rise` and `scale` only (no parts, no dust); `full` plays every style and the dust;
`framing` is `full` in the viewer, for plugins that stage their own members. Rising walls puff
dust along their base and landing drops around their foot: one instanced mesh of a fixed
512-sprite pool on `OVERLAY_LAYER`, the oldest sprite recycled when full.

It ends at once on a `load` commit or a new hydration, an undo or redo, `thumbnail:before-capture`
(synchronously, before the clone, dust included), an export, and for selected nodes, their hosts
and an assembled node's parts. It never plays under `prefers-reduced-motion`, at `off`, in
`renderContext: 'viewer'`, or on a level that is hidden or shadow-only — a level hidden mid-reveal
re-plans the rest so it holds no slot. Both batches keep revealing nodes out (`isNodeRevealing`):
the node batch defers them, and the wall batch holds the level's merge until its walls have risen.
`subscribeRevealPhases` reports each (phase, level) group once as it starts; the viewer plays no
sound, the host does.

The 2D floor plan follows the same schedule (E-006): an entry whose node waits
(`useRevealPending`) is not drawn; a `rise` node with a centreline (its `hit-line`) grows along it
from its start, everything else fades in, from `getRevealPlanState` on each
`subscribeRevealTicks` step. When only the plan shows, the canvas stops its frames, so the reveal
keeps its own clock (its steps capped at 50 ms, like the frame clock).

The events it says, the weight of a landing, the roof that lifts for the furniture, the reverse play for an undo (`retractNodes`) and Follow Pascal are in [construction-animation](construction-animation.md).

A presentation that plays beside the reveal (a plugin's own layer, landing before a group ends)
reads `planRevealWindows(commit)`: when each (phase, level) group of that commit starts and ends,
from the reveal's first frame, planned as if nothing else were revealing.

## Pattern

A kind's system is a React component that renders nothing and does its per-frame work in `useFrame`, shipped as the kind's `def.system`:

```tsx
// packages/nodes/src/my-kind/system.tsx
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

export default function MyKindSystem() {
  useFrame(() => {
    const { dirtyNodes, nodes } = useScene.getState()
    for (const id of dirtyNodes) {
      if (nodes[id]?.type !== 'my-kind') continue
      const object = sceneRegistry.nodes.get(id)
      // update object, then useScene.getState().clearDirty(id)
    }
  })
  return null
}
```

Core systems have no frame loop: they subscribe to the scene store in an effect and write derived data back.

**Systems are a customization point.** Any consumer of `<Viewer>` — the editor app, an embed, a read-only preview — can inject its own systems as children. This is how editor-specific behaviour (space detection, tool feedback) is added without touching the viewer package.

## Rules

- **Core systems must not import Three.js** — they work with plain data.
- **Viewer systems must not contain business logic** — delegate to core if the rule is domain-level.
- **Never duplicate logic** between a system and a renderer — if the renderer needs it, the system should compute and store it, and the renderer reads the result.
- Systems should be **idempotent**: given the same nodes, they produce the same output.
- Mark nodes as `dirty` in the scene store to signal that a system should re-run. Avoid running expensive logic every frame without a dirty check.
- **Clear module-level caches on unmount.** A cache that survives between frames also survives the mount, and one keyed by level or node ID grows with every project opened in the tab. Reset it from the system's unmount effect, the same way editor teardown calls `spatialGridManager.clear()`.

## Reconciliation and scene commits

Reconciliation that writes persisted scene data must keep every derived write in a transmittable
scene commit. Space detection, for example, can create slabs and ceilings, update wall-side
classification, and grow `level.children` in response to one wall edit. Those writes are part of
the originating edit: they must appear in that edit's `SceneCommit.current` snapshot and remain one
undo step.

The current store-subscription ordering satisfies this contract because reconciliation finishes
before the history middleware captures the commit. Moving reconciliation to
`subscribeSceneCommits` breaks the contract unless it emits a separate transmittable commit: commit
listeners run after the snapshots have already been captured, and writes made while history is
paused would otherwise exist only in the local live store.

Remote operations apply the generated nodes carried by the originating commit. Receiving clients
must not independently regenerate them; mutation locking and read-only guards prevent clients from
minting different IDs for the same derived surfaces.

Any optimization that scopes reconciliation to a subset of nodes or rooms must be tested for
equivalence with a full level scan. Representative create, update, delete, cascade, split, merge,
and corridor-enclosure edits must produce the same spaces and surfaces as full reconciliation.

## Undo and redo invalidation

Standalone history jumps clear live transforms and node overrides, including surface-hole
previews. Before a jump, the editor captures the effective layout by merging live overrides
onto committed nodes. Before clearing previews it runs the same pure dependency closure used
for committed history snapshots, with that effective layout as `before` and the committed
target as `after`: wall neighbours in either layout and hosted children on host dimension
changes must rebuild even when only the discarded preview connected them. Overrides published
during restoration/cleanup also contribute their closure before being cleared. Surviving live
transform targets and their parents receive restoration marks too. Empty commands preserve
previews, and collaborative delegates own their own refresh.

Core diffs the before/after node snapshots in a microtask before paint. It marks changed nodes,
old and new parents, wall neighbours in both layouts (scoped to the wall's level), and hosted
doors/windows/items when wall thickness, height or curvature changes. Deletion retains its
conservative surviving-sibling refresh and removes marks for missing IDs. Both layouts are
captured per jump; reconciliation's history pause/resume notifications cannot replace them.
The cold-start fallback without a previous snapshot remains conservative.

Temporal restoration writes to the scene store, so existing subscriptions still own spatial
index updates, slab context tracking, space detection, stair rise/openings, elevator openings,
and level-height dependents. Spatial sync also checks before/after rendered slab boundaries:
wall bands and sibling seams can change support even when the slab's stored polygon is unchanged.
Support invalidation tests the gained/lost rendered bands in both layouts, so objects on a
former boundary re-elevate while consumers in the unchanged interior stay clean. Each pass
groups affected-level walls, slabs and consumers once and caches each slab's rendered polygon
once per layout. Discovering changes still scans the snapshots; it does not scan the scene
again for each candidate slab.

Standalone undo/redo scopes reconciliation candidates to every identity-changed node in the
current and target snapshots, including additions/removals and every step of a multi-step jump.
Changed site, building or level identities retain full-level reconciliation. The slab tracker
mirrors the renderer's context through `slabPolygonContextForLevel`, preserving `level.children`
membership and order for wall adoption and sibling seams. It signs each derived polygon,
elevation, thickness and recessed state, plus building transforms for terrain-filled slabs.
Unchanged input references skip serialization; changed levels share prepared wall bands and
sibling segments, and conservative bounds in both layouts limit polygon derivation. Direct
slab writes retain their existing invalidation. This is not a complete terrain-fill eligibility
signature: level base elevations, stack heights and building-to-site ancestry remain outside it.

There is no routine whole-scene history refresh or batch reset. The existing priority-1 batch
snapshot releases affected sources (including dirty walls' openings); untouched members stay
batched, and affected members rejoin through the normal settle window.

## Adding a New System

1. Decide the scope:
   - **One kind's per-frame work** → `def.system` in `packages/nodes/src/<kind>/system.tsx`; `<RegisteredSystems>` mounts it. Prefer `def.geometry` when the only job is rebuilding on dirty.
   - **Domain logic over plain data** → `packages/core/src/systems/` (no three, no `useFrame`).
   - **A framework-wide rendering side-effect** → `packages/viewer/src/systems/`, mounted in `packages/viewer/src/components/viewer/index.tsx`.
   - **Editor- or integration-specific** → keep it in the consuming package and inject it as a child of `<Viewer>`:
     ```tsx
     <Viewer>
       <MyEditorSystem />
       <ToolManager />
     </Viewer>
     ```

2. **Mount order matters.** Systems run *after* renderers in the JSX tree because they consume the `sceneRegistry` entries renderers populate on mount. Only place a system before renderers if it does not read the registry.
