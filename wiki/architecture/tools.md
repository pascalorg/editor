# Tools

*Editor tools structure in `apps/editor`.*

Applies to: `apps/editor/components/tools/**`.

Tools are React components that capture user input (pointer, keyboard) and translate it into `useScene` mutations. They live exclusively in `apps/editor/components/tools/`.

## Lifecycle

`ToolManager` reads `useEditor` (phase + mode + tool) and mounts the active tool component. When the tool changes, the old component unmounts, cleaning up any transient state.

See `apps/editor/components/tools/tool-manager.tsx`.

> **What the user is doing right now** is owned by the interaction state machine, not by tool-local flags. A tool that starts a placement / move / handle / reshape / box-select / paint interaction enters it through `useInteractionScope.begin(...)` and leaves through `end()` — see [interaction-scope](interaction-scope.md). Do not add a new `useEditor` flag for a new interaction.

## Tool Categories by Phase

**Site**
- `site-boundary-editor` — draw/edit property boundary polygon

**Structure**
- `wall-tool` — draw walls segment by segment
- `slab-tool` + `slab-boundary-editor` + `slab-hole-editor`
- `ceiling-tool` + `ceiling-boundary-editor` + `ceiling-hole-editor`
- `roof-tool`
- `door-tool` + `door-move-tool`
- `window-tool` + `window-move-tool`
- `item-tool` + `item-move-tool`
- `zone-tool` + `zone-boundary-editor`

**Furnish**
- `item-tool` — place furniture

**Shared utilities**
- `polygon-editor` — reusable boundary/hole editing logic
- `cursor-sphere` — 3D cursor visualisation

## Pattern

```tsx
// apps/editor/components/tools/my-tool/index.tsx
import { useScene } from '@pascal-app/core'
import { useEditor } from '../../store/use-editor'

export function MyTool() {
  const createNode = useScene(s => s.createNode)
  const setTool = useEditor(s => s.setTool)

  // Pointer handlers mutate the scene store directly.
  // No local geometry — use a renderer for any preview mesh.

  return (
    <mesh onPointerDown={handleDown} onPointerMove={handleMove}>
      {/* ghost / preview geometry only */}
    </mesh>
  )
}
```

## Rules

- **Tools mutate `useScene` for committed changes and `useLiveTransforms` for ephemeral drag state.** A tool's end-of-interaction write (click-to-commit, release-to-commit) goes to `useScene` and is captured in undo history. Per-mouse-move previews go to `useLiveTransforms` so history and subscribers aren't spammed.
- **Live-drag exception for direct mesh transforms.** During an active drag a tool may apply a transform offset directly to `sceneRegistry.nodes.get(id).position`/`rotation`/`scale` *when and only when* the same offset is mirrored into `useLiveTransforms` for that node. This exception exists because the 3D renderers don't reconcile `useLiveTransforms` onto `mesh.position` yet; once a `LiveTransformSystem` does that, this exception goes away. Conditions:
  - The mesh offset must mirror the `useLiveTransforms` entry (**same exact value**, not "same conceptual translation"), so anything reading `useLiveTransforms` sees the same preview as the 3D view. `ParametricNodeRenderer` (used for every kind that ships `def.geometry`) binds `<group position={liveTransform.position}>` via React — every Zustand notification re-renders and reconciles the group's position back to whatever value `useLiveTransforms` holds. If `mesh.position.set(delta)` and `useLiveTransforms.set({ position: someOtherValue })` disagree, the two writes fight every frame and the user sees jitter during the drag.
  - **For position-based kinds (spawn / item / column)**: the `position` field on the node IS the group's local-frame position, so `useLiveTransforms.position` should hold the live world position of the node (matches the eventual `scene.update`).
  - **For polygon-based kinds (slab / fence / ceiling / wall)**: the node has no `position` field — the canonical group position is `[0,0,0]` with geometry built in level-local coords. `useLiveTransforms.position` must hold the **delta** the tool wants to translate by (`[deltaX, 0, deltaZ]`), not the world location of the polygon's center. The cursor sphere position (which IS the translated polygon center) is tracked separately via React `useState`, not `useLiveTransforms`.
  - The offset must be cleared on tool unmount, cancel, *and* commit — both `mesh.position.set(0, 0, 0)` and `useLiveTransforms.clear(id)`.
  - The tool must not generate or mutate geometry in this path — only transform writes. Geometry generation still belongs in a core system.
- **No business logic in tools** — delegate geometry/constraint rules to core systems.
- **Snapping is mode-driven, not a held-Shift bypass.** Placement, move, rotate, resize,
  endpoint drag, and handle drag are guided building — grid/object snapping, canonical angle
  increments, alignment guides, distance feedback — but the active behaviour is an explicit,
  always-visible, **per-context** mode (the contextual HUD chip), not a hidden held key:
  - **Shift (tap)** cycles the snapping mode for the active context (`wall` grid/lines/angles/off ·
    `item` lines/grid/off · `polygon` grid/lines/off — one persisted mode per context).
  - **Alt (hold)** is force / free: commit the raw cursor past snap *and* past an invalid /
    colliding drop. It is the only momentary "bypass" key (plus the vertical-riser carve-out for MEP runs).
  - **Ctrl (tap)** cycles the grid step.
  - Read snapping through the single path — `isGridSnapActive()` / `isMagneticSnapActive()` /
    `isAngleSnapActive()` (`store/use-editor`), which resolve the active mode from the interaction
    scope via `getActiveSnapContext()`. **Never** read `event.shiftKey` / `event.nativeEvent.shiftKey` /
    `modifiers.shiftKey` to bypass snapping, and never apply a grid step that isn't gated on
    `isGridSnapActive()` (`const step = isGridSnapActive() ? gridSnapStep : 0`). A snappable kind declares
    `NodeDefinition.snapProfile` (`'item' | 'structural'`) so its context, mode-set, and chip fall out
    with no per-kind switch. The contextual HUD renders the snapping chip for **any** tool that resolves
    to a snap context — `helper-manager` gates the generic `RegisteredToolHelper` on `snapContext` (or
    `continuationContext`), not on the presence of hand-written `def.toolHints`, so a snappable draft tool
    with no bespoke hints (e.g. `zone`) still advertises the Shift = cycle control it already honors. See
    [interaction-scope](interaction-scope.md) § "Snapping mode & modifiers" and `lib/snapping-mode.ts`.
- **Constraints and guides can be decoupled.** When a stronger constraint owns the proposal —
  a wall segment's 45° lock while in `angles` mode — the tool may still publish passive dashed
  alignment/proximity guides as long as it does not apply the guide snap delta. Use this for chained
  wall segments: users keep the fast constrained draft but still see proximity feedback for later points.
- **Help mirrors the model.** The shortcut dialog and the contextual HUD are part of the interaction
  contract: they describe the always-visible mode chip + `Alt` = force, **not** a hidden Shift bypass.
  The HUD is driven by the active interaction scope, so it shows only the current context's controls.
- **Preview geometry is local** — transient meshes shown while a tool is active live in the tool component, not in the scene store.
- **Clean up on unmount** — remove any pending/incomplete nodes *and* any live transforms/mesh offsets when the tool unmounts.
- **Tools must not import from `@pascal-app/viewer`** — use the scene store and core hooks only. `sceneRegistry` is exported from `@pascal-app/core` and is the allowed door into the Three.js graph for the narrow purposes above.
- Each tool should handle a single, well-scoped interaction. Split complex tools (e.g. "draw + move") into separate components selected by `useEditor`.

## Adding a New Tool

1. Create `apps/editor/components/tools/<name>/index.tsx`.
2. Register the tool in `ToolManager` under the correct phase and mode.
3. Add the tool identifier to the `useEditor` tool union type.
4. If the tool requires new node types, add schema + renderer + system first.

## 2D ↔ 3D behavioral parity (default expectation)

The 2D floor-plan view and the 3D view are two presentations of the **same** edit. Whenever a behavior is applicable to both, it must exist in both — the *mechanism* may differ (a 3D raycast hover vs a plan-space nearest-wall query; a real mesh ghost vs an SVG symbol), but the *felt behavior* should match. When you add or change an interaction in one view, port it to the other in the same change, or write down why it genuinely doesn't apply.

Concretely, door/window placement/move keeps these in lockstep across `{door,window}/move-tool.tsx` (3D) and `{door,window}/floorplan-move.ts` (2D):

- **Snap target**: nearest wall to the true cursor (shared `findClosestWallInPlan` / wall raycast), free-follow off-wall, commit only on a host.
- **Move SFX**: a soft `sfx:grid-snap` click per grid step while sliding (free-follow plan XZ or on-wall along-X, quantized + deduped so it isn't a machine-gun) and a soft `sfx:item-pick` cue on the floor→wall snap. Both tools carry an identical `tickGridStep` / `tickWallSnap` pair — keep them in sync.
- **R-flip** facing mid-placement, **Shift** to free snap/alignment (guides stay visible) and force-place over collisions, faithful ghost/symbol, deterministic single-undo commit.

Tells that you've broken parity: a sound/guide/snap that fires in 3D but is silent in 2D (or vice-versa), or a fix landed in one move file but not its sibling. The two move files are deliberately near-mirrors; diff them when in doubt.

## Move coexistence: 2D `FloorplanRegistryMoveOverlay` + legacy 3D mover

While a kind is mid-migration its move can run through two paths at once: the registry-driven 2D `FloorplanRegistryMoveOverlay` (`def.floorplanMoveTarget`) and the legacy 3D mover (e.g. `MoveItemContent`). Both react to `setMovingNode(node)`, both mount, both want to commit. Two pitfalls surfaced and have stable fixes; replicate the patterns when porting another kind to coexist.

### Pitfall: the 2D cleanup clobbering the 3D commit

`FloorplanRegistryMoveOverlay` pauses scene history at mount and snapshots the moving node. If the user actually commits in 3D, the 3D path writes new state and clears `movingNode`. The 2D overlay then unmounts — and its cleanup `useEffect` would call `updateNodes(snapshot)`, overwriting the just-committed 3D state with the original.

Fix in `floorplan-registry-move-overlay.tsx`: gate the cleanup revert on a `hasMovedSinceStart` flag that is only set inside `onMove` **after** the `target.closest('[data-floorplan-scene]')` guard. If no 2D apply ever ran, the divergence in scene state must be an external committer's — skip the revert, just resume history. Symptom when missing: items snap back to their pre-drag position / rotation on 3D commit.

### Pitfall: `useDraftNode.destroy()` clobbering the 2D commit

Mirror problem in the other direction. The legacy 3D mover's `usePlacementCoordinator` cleanup unconditionally calls `draftNode.destroy()`, which for adopted moves writes the original position back to scene. If the 2D path committed first, the destroy reverts it.

Fix in `use-draft-node.ts`: in move-mode `destroy()`, compare the live scene position to the `adopt()`-time snapshot. If they diverge, an external committer has already written the new value — skip the restore (and the mesh reset). Cancellation paths (Escape) still revert, because they revert before unmount so live == snapshot at destroy time.

### Pitfall: pointermove fires globally; treat 3D-canvas events as out of scope

`FloorplanRegistryMoveOverlay` listens to `window` pointermove. When the user drags in 3D the listener still fires — without a target check it converts 3D-canvas client coords through the floor-plan SVG's CTM, producing garbage plan coordinates that fight the 3D mover's mesh updates.

Always gate `onMove` (and `onPointerUp`) with `target.closest('[data-floorplan-scene]')` so the 2D path only acts when the pointer is actually over the floor plan scene.

## `useLiveTransforms` contract is per-kind, not generic

The store name suggests a uniform contract; the writes in practice are not. Document the frame on the writer side; consumers must either know the kind or be narrowed.

| Writer | `position` frame | `rotation` frame |
|---|---|---|
| `usePlacementCoordinator` (item floor / wall / ceiling) | world plan (level-local) | world Y |
| `door` / `window` move tools | wall-local | wall-local (0 or π) |
| `slab` / `ceiling` / `fence` / polygon-based movers | position **delta** (`[Δx, 0, Δz]`) | unused / 0 |
| `column` / `roof` / `elevator` / `spawn` / single-position kinds | world plan | world Y |

Anything that subscribes to `useLiveTransforms` to inform 2D rendering needs to handle these frames explicitly. The `FloorplanRegistryLayer` override currently branches by kind: `item` / `shelf` / `column` are treated as world-plan (it copies `live.position` onto the effective node and forces `parentId: null` so the resolver skips the parent-chain transform), while `slab` / `ceiling` / `zone` are treated as a polygon **delta** (it translates the polygon vertices by `live.position`). Each kind added to the live-drag path grows this consumer-side switch; the preferred long-term fix is to standardise the frame at the writer so the consumer stops branching by `node.type`.

## Data-driven live drag: `useLiveNodeOverrides`, never per-tick `useScene`

`useLiveTransforms` (above) carries a rigid position/rotation offset — right when the renderer can preview the move by transforming the node's group. It's **wrong** when the geometry is *recomputed from data fields* (a wall re-miters from its `start`/`end`, an opening re-cuts its host wall, an endpoint drag reshapes the segment and cascades to linked walls): the shape itself changes, so there's no rigid offset to apply. Those preview via **`useLiveNodeOverrides`** (`@pascal-app/core`) — the tool publishes the changed fields per tick (`set(id, patch)` / `setMany(...)`) and the geometry systems merge them (`getEffectiveWall` in 3D, the floor-plan sibling-override merge in 2D, `getEffectiveNode` in panels). The scene store stays untouched during the drag; on commit the tool clears overrides and writes it **once** (`resumeSceneHistory → updateNodes([...]) → pauseSceneHistory`), so the gesture is a single undo step. Esc/unmount just clears overrides — cancel is free.

**Writing `useScene.updateNodes`/`updateNode` per `grid:move` tick is a blocker:** it replaces the `nodes` map ref, so every `useScene(s => s.nodes)` subscriber app-wide (panels, HUD, tooltips, floor plan, catalog) re-renders each frame → FPS collapse. (`markDirty` per tick is fine — it never calls `set()`.) Reference: `packages/nodes/src/wall/{move-tool,move-endpoint-tool}.tsx`.

## Floorplan registry: per-node subscriptions, stable props

`FloorplanRegistryLayer` draws one `FloorplanRegistryEntry` per node. The perf invariant — a live drag must re-render only the changed node(s), not all ~150 entries — rests on three things, and breaking any of them is a re-render-flood regression that still type-checks and passes tests (see `floorplan-registry-layer.tsx`):

- Each entry subscribes to **its own slice** — `useLiveTransforms(s => s.transforms.get(id))` / `useLiveNodeOverrides(s => s.overrides.get(id))`, never the whole Map. This works because the live stores write a fresh value only for the changed node (the Map is cloned but unchanged value refs are reused), so an unchanged node's selector stays identity-stable and Zustand skips it. The parent subscribes only to the stable id list.
- `FloorplanRegistryEntry` and `InteractiveGeometry` are `memo`'d, so the parent must pass **referentially stable props** (hoisted styles, `useCallback` handlers, memoized descriptors) — a fresh inline object/handler per entry defeats the memo.
- Sibling-dependent geometry (wall miters, opening cuts) invalidates via a **per-node sibling epoch** bumped from a store `subscribe` (`computeAffectedSiblingIds`), not a whole-layer re-render.

## Wall-attached node rotations must be wall-local

`door` / `window` / wall-attached `item` are children of the wall mesh in 3D. The wall's `mesh.rotation.y = -atan2(dy, dx)`. The child node's `rotation.y` therefore lives in the wall's local frame and composes with the wall's rotation at render time.

The 3D source of truth is `calculateItemRotation(normal)` in `editor/src/components/tools/item/placement-math.ts`, which returns 0 (front face) or π (back face). Any 2D move helper that writes `node.rotation[1]` for wall-attached nodes must produce the same wall-local value. Writing a world-space rotation gets you orientation bugs that vary with wall direction — typically 90° on horizontal walls and 180° on vertical walls (which sometimes "looks OK" by symmetry, which is worse — silent corruption).

See `nodes/src/shared/wall-attach-target.ts`'s `WallHit.itemRotation`. Side determination there is calibrated to the same convention: in wall-local space the wall extends along +X, the front-face normal is +Z, and `perpRaw >= 0` is the front side.

## Move / placement: disable raycast on the moved mesh

A 3D move tool that follows the cursor by writing `mesh.position.set(x, 0, z)` runs into a feedback loop: as the mesh tracks the cursor it sits between the camera and the grid plane, so R3F's raycaster hits the moved mesh first → only `${kind}:move` fires → `grid:move` stops firing → the cursor snapshot (used as the commit position) freezes at its initial value. The user clicks at a new spot and the node commits at the starting one.

Fix in `MoveRegistryNodeTool`: at drag-start, traverse the moved mesh and overwrite `child.raycast = () => {}` on every descendant; restore the originals in the effect's cleanup. The ray now passes through the moved mesh, hits the grid plane, and `grid:move` keeps firing.

The same applies to placement previews — see `nodes/src/shelf/preview.tsx` for the `(obj as { raycast: () => void }).raycast = () => {}` pattern. A preview that captures rays starves the placement tool's own `grid:move` snapshot.

## Move / placement: commit handlers listen to every `${kind}:click`

R3F's pointer raycaster dispatches the click event to whichever mesh is closest, even when the user thinks they're clicking the ground. A tool that only listens to `grid:click` misses commits whenever the click ray lands on a wall face, a shelf side, an item, or the still-being-placed cursor mesh itself. Symptom: clicks visibly hit "near" the cursor but the tool does nothing.

The fix is the pattern used by `ShelfTool` and `MoveRegistryNodeTool`: keep the latest `grid:move` snapshot in a ref, then register one shared commit handler against `grid:click` **and** every common kind-click event:

```ts
const CLICK_TRIGGER_KINDS = [
  'shelf', 'item', 'slab', 'ceiling', 'wall',
  'fence', 'column', 'roof', 'roof-segment',
  'stair', 'stair-segment',
] as const

emitter.on('grid:click', commitAtCursor)
for (const kind of CLICK_TRIGGER_KINDS) {
  emitter.on(`${kind}:click` as `${typeof kind}:${EventSuffix}`, commitAtCursor as never)
}
```

The commit reads `lastCursorRef.current` (set by `grid:move`), not the click event's position — clicks on vertical surfaces carry the hit point on that surface, which can be metres away from the cursor the user was visually targeting.

## Move tools must preserve the node's actual rotation in `useLiveTransforms`

A tool that writes `useLiveTransforms.set(id, { position: [x, 0, z], rotation: 0 })` during drag wipes the node's true Y-rotation for the duration of the drag. `ParametricNodeRenderer` reads `liveTransform.rotation` and applies `<group rotation={[0, liveTransform.rotation, 0]}>`, so the moved node visually un-rotates to 0 the moment the tool mounts, then snaps back to its real rotation on commit when the live transform clears. Users perceive that snap as "the node went to a weird position."

Capture the original `node.rotation[1]` at mount time and forward it on every `set`:

```ts
const originalRotationY = useMemo(() => {
  const r = (node as { rotation?: unknown }).rotation
  return typeof r === 'number' ? r : Array.isArray(r) ? (r[1] ?? 0) : 0
}, [node])

// in onMove:
useLiveTransforms.getState().set(node.id, {
  position: [x, 0, z],
  rotation: originalRotationY,
})
```

If the tool *also* rotates the node during the drag, it should drive `rotation` from the current tool state — not from 0, not from the stale node value.

## SVG `fill="none"` is click-through

When emitting a `FloorplanGeometry` polygon that should remain interactive but visually invisible (e.g. an item with a thumbnail image carrying the visual weight), use `fill="transparent"`, not `fill="none"`. The default `pointer-events: visiblePainted` only hit-tests the interior when there's a paint server — `none` is not paint, `transparent` is. Without this the floor-plan layer's wrapping `<g>` never sees the `onPointerDown` and clicks don't select the node.
