# Interaction Scope

*The authoritative interaction state machine ("the spine") — one scope describes "what the user is currently doing".*

Applies to: `packages/editor/src/lib/interaction/**`, `packages/editor/src/store/use-interaction-scope.ts`.

Before this, "what is the user doing right now?" was re-derived from 7+ independent
`useEditor` flags (`movingNode`, `placementDragMode`, `activeHandleDrag`,
`curvingWall`, `curvingFence`, `editingHole`, `movingWallEndpoint`,
`movingFenceEndpoint`). Every overlay and pick site re-derived its behaviour from
a different subset, so the flags could drift into illegal combinations (moving +
curving at once; a stale `movingNode` after a drag ended). The scope collapses
them into one discriminated union, making those combinations unrepresentable: a
scope is exactly one interaction at a time, and `idle` carries no payload.

---

## The model

`InteractionScope` (`lib/interaction/scope.ts`) is a discriminated union on `kind`:

| `kind` | Payload | What |
|---|---|---|
| `idle` | — | Nothing in flight. The only state where selection/hover picking is meaningful. |
| `placing` | `nodeId`, `nodeType`, `view`, `pressDrag` | Placing a fresh node (catalog/preset/build tool). `pressDrag` = gizmo press-drag (commit on release) vs click-to-place. |
| `moving` | `nodeId`, `nodeType`, `view` | Moving an existing node. |
| `handle-drag` | `nodeId`, `handle` | Dragging a resize/translate/rotate handle of a selected node. |
| `drafting` | `tool` | Click-to-click drafting of a polyline/polygon kind (wall/fence/slab/…). |
| `reshaping` | `nodeId`, `reshape`, `holeIndex?` | Reshaping a selected node's geometry. `reshape` is `curve \| hole \| endpoint \| boundary`. |
| `box-select` | — | Marquee selection drag. |
| `painting` | — | Material paint application. |

`reshaping` groups endpoint/curve/hole/boundary edits as sub-states of one scope
(rather than four sibling kinds) — there is one node and one in-flight reshape,
so "curving and hole-editing at once" stays unrepresentable. `view` is `'2d' | '3d'`.

### Helpers

- `isIdle(scope)` / `isActive(scope)` — `idle` vs anything else (`ActiveInteractionScope`).
- `scopeNodeId(scope)` — the node a scope acts on, or `null`. `drafting`/`box-select`/`painting`/`idle` target no single existing node.
- `selectionEnabled(scope)` — true only while `idle`. During any active interaction the pointer belongs to that interaction's body, not to selecting a different object; the picking choke point must not route a hover/click to selection while this is false.

---

## The store contract

`useInteractionScope` (default export of `store/use-interaction-scope.ts`) is the
single owner. Exactly one scope at a time; the only writable shape is
`InteractionScope`, so there is no setter that can leave a half-state.

| Method | Behaviour |
|---|---|
| `begin(scope: ActiveInteractionScope)` | Enter an interaction. If one is already active it is replaced (single owner, no producer races). |
| `update(patch)` | Patch the current scope's payload. **Ignored when idle, and ignored when the patch's `kind` differs from the active kind** — payload updates must not change which interaction is running (use `begin` for that). |
| `end()` | Return to idle atomically. Both commit and cancel call it; the write-vs-revert distinction lives in the interaction body, not here. |
| `endIf(match)` | Return to idle only if the active scope satisfies `match`. |

**Atomic-end invariant.** `end()` sets the scope back to `IDLE_SCOPE` in one
write — no interaction payload can leak past the end of its interaction (no stale
`nodeId`, no half-cleared flags). `endIf` exists because scope is currently
driven from independent legacy flag clears (below): clearing one flag (e.g. a
fence curve) must not stomp an unrelated active scope (e.g. a wall move), so the
clear only ends the scope if it owns it.

---

## Hot-set: what is raycast-eligible during an interaction

`lib/interaction/hot-set.ts` answers "which scene objects can the active
interaction target?" It is never hand-authored per interaction — it falls out of
the node's `asset.attachTo` plus whether a candidate exposes a top surface.

`attachClassOf(attachTo)` collapses attachment to three `AttachClass` values:

- `wall` — `attachTo` of `wall` or `wall-side`.
- `ceiling` — `attachTo` of `ceiling`.
- `surface` — everything else ("floor item" really means *surface-resting*: rests on the floor **or** any host's top surface).

`isPickableForAttach(placed, candidate)` decides, for a node of attach class
`placed`, whether a `HotSetCandidate` is a valid host/surface:

- `wall` → only `wall` candidates.
- `ceiling` → only `ceiling` candidates.
- `surface` → the floor (`isFloorLike`), or any candidate that `exposesTop` (registry `capabilities.surfaces.top`) — but **never** a ceiling-mounted host. A floor lamp must not land on a ceiling fan; a ceiling fan's `attachClass` is `ceiling` and is excluded as a host top (Track E).

`isCandidateInHotSet(scope, placedAttachClass, candidate)` lifts this to a whole scope:

- `idle` → `true` (selection/phase filtering stays in the selection manager; the hot-set only narrows what an *active* interaction can target).
- `placing` / `moving` → `isPickableForAttach`, or `true` when `placedAttachClass` is `null`.
- every other active scope → `false`: nothing in the scene is a placement target, so the interaction body's own raycast owns the pointer.

`HotSetCandidate` (`type`, `isFloorLike`, `exposesTop`, `attachClass`) is derived
from the candidate node + its registry definition by the caller, keeping this
module pure and unit-testable without the scene or registry.

---

## Overlay policy: the scope matrix

`resolveOverlayPolicy(scope)` (`lib/interaction/overlay-policy.ts`) returns the
"Sims-light" overlay behaviour: default-off, opt-in for the active action. During
any non-idle scope, scene objects stay visible but non-pickable, and DOM/HUD
overlays step back differentiated by how distracting they are.

| Overlay | Idle | Any active scope |
|---|---|---|
| Zone labels | shown | hidden (not a primary editing concern) |
| Context badges (hover name pills) | shown | faded + `pointer-events: none` |
| Conflicting controls (other objects' handles, floating action menu) | shown | hidden |
| Scene objects pickable | yes | no (the hot-set owns targeting; context preserved, can't grab the wrong thing) |
| Active affordances (ghost, snap guides, dimension labels, the active handle) | shown | shown |
| Contextual control HUD interactive | yes | yes (it *is* the active interaction's own controls — exempt from the pointer-events step-back) |

The policy is binary (`IDLE_POLICY` vs `ACTIVE_POLICY`) keyed on `isActive`.

---

## Snapping mode & modifiers (the unified model)

Snapping is a persistent, **per-context**, always-visible mode — not a held-Shift bypass.
The active scope selects the *context*; the context's current mode selects the *behaviour*.
There is no per-kind snapping switch.

- **Contexts** (`lib/snapping-mode.ts`, `SNAP_PROFILES`): `wall` (grid/lines/angles/off, default grid),
  `item` (lines/grid/off, default lines), `polygon` (grid/lines/off, default grid). A kind opts in by
  declaring `NodeDefinition.snapProfile` (`'item' | 'structural'`); `snapContextOf(scope × profile)` maps
  it — `structural` while **setting direction** (drafting / endpoint drag) → `wall` (angle-bearing),
  `structural` otherwise (translate / curve) → `polygon` (no angle), `item` → `item`. No profile → no chip.
- **Single read path.** Tools read `isGridSnapActive()` / `isMagneticSnapActive()` / `isAngleSnapActive()`
  (`store/use-editor`); the grid step is `useEditor.getState().gridSnapStep` gated on `isGridSnapActive()`.
  These resolve the mode from the scope via `getActiveSnapContext()` → `snappingModeByContext[context]`.
- **Modifiers.** Shift (tap) cycles the mode for the active context; Ctrl (tap) cycles the grid step;
  Alt (hold) is force / free (raw cursor + commit past invalid; for MEP runs, the vertical-riser carve-out).
  Shift is **not** a snap bypass. Alt is **not** a snap toggle. Placement continuation (wall room/single,
  fence continuous/single, point once/repeat) is a separate per-context mode, cycled by **C** and surfaced as
  a clickable HUD chip.
- **The chip is the scope's.** The contextual HUD shows the active context's mode and is the only place the
  mode is cycled — so a tool that wants its chip must run inside a scope whose `snapContextOf` resolves
  (a build tool, `drafting`, `placing`/`moving`, or `reshaping`).

**Known-legacy (migrate on touch).** Two legacy modifier patterns predate this model and survive in
spots not yet touched; both are tracked in `plans/editor-placement-interaction-overhaul.md`. A PR that
**touches** one must migrate it to the model above, not extend the legacy path:
1. **`event.shiftKey` as a snap bypass with hardcoded steps** — the MEP move/endpoint tools
   (`packages/nodes/src/{duct-segment,pipe-segment,liquid-line,lineset,duct-fitting}/{move-tool,selection}.tsx`).
   Opening a `moving` scope from a bespoke mover is **not** the migration — `useMovingNode()` reads the scope,
   so `tool-manager` re-mounts the generic `MoveRegistryNodeTool` alongside it (the dual-path FPS/teleport
   bug). Resolve the mode without a global `moving`/`reshaping` scope; see the plan's dual-path note.
2. **`event.altKey` as an alignment bypass** — the roof / polygon / slab pointer-move previews in
   `components/editor/floorplan-panel.tsx` and the ceiling/slab `resolveSlabPlanPointSnap` / `resolveCeilingPlanPointSnap`
   paths still pass `event.altKey` to suppress Figma-alignment. Alignment must instead follow the magnetic snap
   mode (`bypass: !isMagneticSnapActive()`). **Already migrated (do not regress):** wall + fence drafting (3D
   `{wall,fence}/tool.tsx` + the 2D `use-floorplan-background-placement.ts` / `floorplan-panel.tsx` paths), where
   Alt was freed for the chain-mode toggle above.

---

## Migration status (strangler fig)

The scope is the target source of truth, but the legacy `useEditor` flags still
exist as a mirror and are being retired reader-by-reader. Today the scope is
**driven from** the central `useEditor` setters — `setMovingNode`,
`setActiveHandleDrag`, `setCurvingWall`/`setCurvingFence`, `setEditingHole`,
`setMovingWallEndpoint`/`setMovingFenceEndpoint`, `setMode` (for painting) — and
from the box-select tool. Each setter calls `begin`/`end` (and `endIf`, so an
independent flag clear can't stomp an unrelated scope) to keep the scope in sync.

**Contributors:**

- Add a new interaction by calling `begin(...)` / `end()` on `useInteractionScope`, **not** by adding a new `useEditor` flag.
- Read "what the user is doing" through the scope and its helpers (`isActive`, `scopeNodeId`, `selectionEnabled`), not by recombining flags. New readers should consume the scope so the legacy flag can be deleted once it has no readers.
- Add a new attach behaviour by setting `attachTo` on the asset — the hot-set follows with zero per-kind wiring.

---

## Rules

- **One owner, one scope.** Only `useInteractionScope` writes the scope, and only via `begin`/`update`/`end`/`endIf`. Never reconstruct interaction state from a private combination of flags.
- **`end` is atomic and payload-free.** Never leave a `nodeId`/payload behind on idle; commit-vs-revert logic belongs in the interaction body before `end`.
- **`update` cannot change `kind`.** Switching interactions is a `begin`, not a patch.
- **Hot-set and overlay policy are pure derivations of the scope** (and, for the hot-set, the candidate metadata). Don't branch overlay/picking behaviour on legacy flags — branch on the scope.
- **Don't add new `useEditor` interaction flags.** New interactions go through the scope.
- **Snapping is mode-driven.** Read snap state through `isGridSnapActive` / `isMagneticSnapActive` / `isAngleSnapActive` (gate any grid step on the first); never bypass snapping via `event.shiftKey` / `modifiers.shiftKey`, and never hardcode an ungated grid step. Snappable kinds declare `snapProfile`. Shift cycles the mode; Alt is force/free.
