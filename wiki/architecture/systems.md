# Systems

*Core and viewer systems architecture.*

Applies to: `packages/core/src/systems/**`, `packages/viewer/src/systems/**`.

Systems own business logic, geometry generation, and constraints. They run in the Three.js frame loop and are never rendered directly.

> **For registry-driven kinds, prefer no per-kind system.** If your kind's only job is "rebuild geometry on dirty", set `def.geometry` and let the framework's `<GeometrySystem>` handle the rebuild loop. Per-kind systems remain for *extra* responsibilities — animations, cross-kind dirty cascades, named-mesh material poking. See [node-definitions.md](node-definitions.md).

## Two Kinds of Systems

### Core Systems — `packages/core/src/systems/`

Pure logic: no rendering, no Three.js objects. They read nodes from `useScene`, compute derived values (geometry, constraints), and write results back.

| System | Responsibility |
|---|---|
| `WallSystem` | Wall mitering, corner joints |
| `CeilingSystem` | Polygon-based ceiling generation |
| `RoofSystem` | Pitched roof shape |
| `DoorSystem` | Placement constraints on walls |
| `WindowSystem` | Placement constraints on walls |
| `ItemSystem` | Item transforms, collision |

Slab geometry has no dedicated system: it renders through the registry `def.geometry` (`packages/nodes/src/slab/geometry.ts`, calling the pure generators in `packages/viewer/src/systems/slab/slab-system.tsx`) with a small `def.system` for dirty tracking.

Ceiling geometry consumes dirty marks at frame priority 2, like `GeometrySystem` (slabs).
The node batch snapshots marks at priority 1 and processes membership at priority 5,
so it releases old geometry and collects replacements after rebuilds. A definition's
`system.priority` orders mounted components; it does not set `useFrame` priority.

Items, columns, ceiling undersides and slab bodies directly under a level, plus
wall-hosted doors/windows, can join the level's `BatchedMesh` containers. Sources
stay mounted and draw-hidden. Ceiling grids and hosted child subtrees are excluded;
containers preserve source shadow flags. Selection (including external selection),
live transforms and each slot paint preview target release sources until settled.
Level mode/selected-level changes re-offer sources rejected while shadow-only.

### Initial wall build

`setScene` assigns a non-persisted hydration identity, then publishes its eligible
`hydrationToken` after synchronous reconciliation and hydration-owned deferred
normalization finish. Elevator openings and reconciliation of replaced levels run
inside the synchronous boundary; queued stair rise/opening normalization extends
that boundary through its microtask. The store owns these opening passes even if
their reactive systems mount after hydration, and honors the scene mutation lock.
Ordinary document writes cancel pending publication or invalidate an issued token atomically before subscribers run,
including paused, remote and undo/redo writes. History pausing alone grants no
exemption. Dirty marks alone do not invalidate it, so opening completion can still
re-dirty its parent wall.

The canvas ref installs pointerdown, pointermove and wheel capture before lazy
systems mount. Live override/transform interruption belongs to the scene store;
nonempty maps cancel hydration even if cleared before the wall consumer mounts.
`applySceneSnapshot` clears stale live maps before starting the replacement.
The eager wall lifecycle owner observes tokens independently of `WallSystem`, so a
consumer remount retains the same span, counters, built-wall identities and pending
neighbours. A fresh hydration resets that state; an interruption cannot re-enter
for the same token. These hydration-scoped records are an exception to the usual
system-unmount cache cleanup rule; the consumer still clears its miter cache.

Initial build ends on the first frame with no dirty walls and no pending
neighbours, or on interruption. If no walls rebuild for 30 consecutive frames
while dirty walls lack registered meshes (one placeholder-sweep interval), the
privilege is revoked. This bounded renderer grace period leaves their dirty marks
intact and does not report geometry completion; a later mount still rebuilds them.
Unavailable walls do not continually postpone the pending-neighbour quiet clock.
`isWallInitialBuildActive()` and `getPendingWallRebuildCount()` remain readable
without `?perf`.

Initial build consumes walls under the existing **8 ms budget**, checked between
walls, without the interactive **8 walls/frame** cap. A wall with at least six
opening cutouts occupies its own frame. Each wall's first build during active
initial build skips adjacency scanning and neighbour re-invalidation because the
hydrated inputs are stable and its neighbours are queued for their own first
builds. Subsequent builds retain neighbour invalidation and the **80 ms** trailing
quiet window. Once initial build ends, the existing interactive scheduling applies
(progressive limits for queues larger than eight; small edits rebuild immediately).

Only with `?perf`, `__pascalPerf.batchStats().wallDrain` publishes the active state,
this frame's consumption, cumulative budget/heavy/drained/cap exits, pending-neighbour
count, first builds, re-invalidation builds and unique neighbour enqueues. Publication
reuses one mutable stats object without allocating frame snapshots. Counters reset
on each hydration identity, including one interrupted before token publication.
`firstBuilds` counts the first-ever geometry build of each wall in that hydration,
even after interruption; `reinvalidationBuilds` counts later builds of those walls.
The `wall-initial-build` span starts at eligible token publication and ends at drain
completion or interruption, spanning consumer unmounts. Counters do not imply that
opening-system completion has drained: late opening builds can still re-dirty walls.

The wall batch still waits for its pending-neighbour queue. Node batching retains
its global 180 ms quiet clock for now. Initial-drain batching is a follow-up: bounded
joins must preserve whole-wave `MIN_BATCH_ENTRIES` decisions and partial/leftover
membership, including candidates larger than one frame's allowance.

### Viewer Systems — `packages/viewer/src/systems/`

Access Three.js objects (via `useRegistry`) and manage rendering side-effects.

| System | Responsibility |
|---|---|
| `LevelSystem` | Stacked / exploded / solo / manual level positions |
| `WallCutout` | Cuts door/window holes in wall geometry |
| `ZoneSystem` | Zone display and label placement |
| `InteractiveSystem` | Item toggles and sliders in the scene |
| `GuideSystem` | Temporary helper geometry |
| `ScanSystem` | Point cloud rendering |

## Pattern

Systems are React components that render nothing (`return null`) and use `useFrame` for per-frame logic.

```tsx
// packages/core/src/systems/my-system.tsx
import { useFrame } from '@react-three/fiber'
import { useScene } from '../store/use-scene'

export function MySystem() {
  const nodes = useScene(s => s.nodes)

  useFrame(() => {
    // compute and write back derived state
  })

  return null
}
```

Core and viewer systems are mounted inside `<Viewer>` alongside renderers. See `packages/viewer/src/components/viewer/index.tsx` for the mount order.

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

There is no routine whole-scene history refresh or batch reset. The existing priority-1 batch
snapshot releases affected sources (including dirty walls' openings); untouched members stay
batched, and affected members rejoin through the normal settle window.

## Adding a New System

1. Decide the scope:
   - **Domain logic** → `packages/core/src/systems/`
   - **Viewer rendering side-effect** → `packages/viewer/src/systems/` — mount in `packages/viewer/src/components/viewer/index.tsx`
   - **Editor-specific or integration-specific** → keep it in the consuming app (e.g. `apps/editor/components/systems/`) and inject it as a child of `<Viewer>`

2. Create `<name>-system.tsx` in the appropriate directory.

3. Mount it in the right place:
   - Viewer-internal systems go in `packages/viewer/src/components/viewer/index.tsx`
   - App-specific systems are injected as children from outside:
     ```tsx
     // apps/editor — editor injects its own systems without modifying the viewer
     <Viewer>
       <MyEditorSystem />
       <ToolManager />
     </Viewer>
     ```

4. **Mount order matters.** Most viewer systems run *after* renderers in the JSX tree — they consume `sceneRegistry` data that renderers populate on mount. Only place a system before renderers if it explicitly does not read the registry.
