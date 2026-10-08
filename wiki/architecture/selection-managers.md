# Selection Managers

*Selection architecture: the editor's manager, one model for every viewer surface, and the bare viewer default.*

Applies to: `packages/editor/src/components/editor/selection-manager.tsx`, `packages/editor/src/lib/viewer-selection.ts` (+ `components/viewer/viewer-selection-manager.tsx`, `packages/viewer/src/components/viewer/glb-scene.tsx`), `packages/viewer/src/components/viewer/selection-manager.tsx`.

| Component | Location | Used by |
|---|---|---|
| `SelectionManager` (editor) | `packages/editor/src/components/editor/selection-manager.tsx` | The editor canvas: phase, mode, tool state |
| Viewer selection (`lib/viewer-selection.ts`) | `packages/editor` | Every viewer surface: the published viewer (baked GLB and parametric), its `?embed=1`, the editor's Preview |
| `SelectionManager` (viewer default) | `packages/viewer/src/components/viewer/selection-manager.tsx` | Bare `<Viewer>` mounts with no navigation (bake page, IFC preview, lab) |

A host replaces the default with `<Viewer selectionManager="custom">` and mounts its own as a child, via the viewer-isolation pattern.

---

## How Selection Works

**Event flow:**

```
useNodeEvents(node, type) on a renderer mesh
  → emitter.emit('wall:click', NodeEvent)
  → SelectionManager listens via emitter.on(…)
  → calls useViewer.setSelection(…)
  → outliner sync re-runs → Three.js outline updates
```

`useNodeEvents` returns R3F pointer handlers. Spread them onto the mesh:

```tsx
const events = useNodeEvents(node, 'wall')
return <mesh ref={ref} {...events} />
```

Events are suppressed during camera drag (`useViewer.getState().cameraDragging`).

Selection/hover picking is only meaningful while the interaction scope is `idle`
(`selectionEnabled(scope)`). During an active placement/move/etc., the pointer
belongs to that interaction's body and the hot-set narrows which scene objects
are raycast-eligible — see [interaction-scope](interaction-scope.md) for the
hot-set derivation and the overlay scope matrix.

---

## Viewer surfaces

One model and one navigation UI for the published viewer (baked GLB or parametric fallback), its
embed and the editor's Preview. Renderers are only **hit sources**: the parametric one turns a node
event into a `ViewerPick` (`viewerPickFromNodeEvent`, mounted as `ViewerSelectionManager`), the
baked one a raycast over `pascalId` objects (`resolveGlbPick` in `GlbScene`, handed to the host as a
`GlbPickEvent`). Both picks carry the node id and the hit in its level's local XZ, and go through the
same rules, against the scene graph (the store for parametric, the published graph for a bake):

- `levelId` is the current floor, `zoneId` the selected room or zone, `selectedIds` the element.
- Free-form: no building → level → zone progression. A click on a wall, floor or ceiling selects the
  room it bounds (the editor's `resolveRoomHit`); once that room is selected, its own surfaces select
  as themselves. Anything else (item, door, stair, roof) selects directly. Alt/Shift/Ctrl/Meta skip
  the room; Shift/Ctrl/Meta toggle elements on the same floor.
- A click on empty space clears the room and the element and keeps the floor. A click never moves
  the camera; the floor follows what is selected.
- Kinds that only frame (site, building, level, zone, ceiling, scan, guide, spawn) and anything on a
  hidden floor pass the pointer to what lies behind. Zone meshes are not mounted on these surfaces
  (`showZones` off), so they never catch a click.
- Hover shows what a click would select: the room's highlight, or the element's outline.
- A click that selects an openable on the baked path (door, window, `open` clip, mechanism) also
  plays it. Walkthrough never selects.

The navigation (`ViewerSceneHeader`, given a `ViewerSource`) is the breadcrumb — building › floor ›
room › element, where an element shows the room it stands in without selecting it — and the floor
list with, under the current floor, its Units, Rooms and Zones (empty sections left out). A crumb,
a floor or a row selects and frames (`camera-controls:frame`: the node's saved view, else its box at
about 45° along the current heading); the canvas never frames. `ViewerRooms` draws the editor's room
pills (same visibility rule, same declutter) and the editor's room highlight for the selected or
hovered room and a focused unit's rooms. `useViewerFloorDisplay` hides the levels above the current
floor outside the walkthrough.

Preview borrows the shared store: `setPreviewMode(true)` saves the editor's `selection` and
`focusedUnitId` and opens Preview on the editor's floor with nothing else selected;
`setPreviewMode(false)` puts them back. The editor's room context (`useEditor.room`) is not touched.

## Bare viewer default

Hierarchical path: **Building → Level → Zone → Elements**

At each level, only the next tier is selectable. Clicking outside deselects. The path is stored in `useViewer`:

```ts
type SelectionPath = {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: string[]   // walls, items, slabs, etc.
}
```

`setSelection` has a hierarchy guard: setting `levelId` without `buildingId` resets children. Use `resetSelection()` to clear everything.

Multi-select: `Ctrl/Meta + click` toggles an ID in `selectedIds`; `Shift + click` toggles the same way. Regular click replaces it.

---

## Editor Selection Manager

Extends selection with the editor's `phase` from `useEditor`. The viewer's `SelectionManager` is **not** mounted in the editor; this one takes its place (injected as a child of `<Viewer>`).

```
phase: 'site'      → any hit on a house hovers its building; the click selects it and goes inside
phase: 'building'  → everything on the active level: walls, slabs, ceilings, roofs,
                     openings, stairs, elevators, spawn, items, plugin kinds
  room-first walls, slabs and ceilings
```

Room label pills (`RoomLabels3D`, `RoomLabels2D`, one `RoomPill`) show while nothing but the
site, building or level is selected. Only the pill itself takes the pointer, and it goes through
the same zone-area rule as a zone's fill or label in the plan (`hoverZoneArea` / `clickZoneArea`
in `lib/room-zone-routing.ts`): a room room-first, a modifier or a zone that bounds no room as the
zone (its outline, its panel and outline editor). Zones show tinted volumes only while a unit's
membership is painted; otherwise a zone looks like a room. A new zone is written with a palette
colour picked from its id (`newZone` / `zoneColorForSeed` in core), a captured room from its capture's
id, unless its creator chose one;
existing zones keep their stored colour.

Inside the building no click changes the phase. Site is entered from the Scene panel's site header
or `1`, and left by a click on the house or on empty ground, the building row or `2`. Arming a building tool keeps the phase. Double-click on a roof or stair selects the segment
under the cursor.
Persisted `structure` / `furnish` values from before the merge read back as `building`.

Building selection first resolves a wall face or floor/ceiling hit to a detected room.
The editor keeps its transient `{ levelId, roomId }` in `useEditor.room`; `roomKey`
in `lib/room-selection.ts` derives identity from the sorted unique boundary ID/face pairs in `spans`, excluding
coordinates and interval extents so moving a boundary preserves selection. This adapter
is the migration point for future persistent zone IDs.
`useSelectedRoom()` exposes the clear footprint, boundary spans and matching surfaces.
Each mounted level shares one incremental topology index and scene subscription.

Live session groups take precedence over room interception in both views.
Room commands orchestrate viewer selection; editor room actions are plain setters.
Clicking the room clears `selectedIds`. Its own elements then select individually;
a hit in another room changes the room context. Escape clears the element first,
then the room. Empty clicks clear both. Alt bypasses room and session-group picking;
Shift/Ctrl/Meta and marquee select elements. Selecting a furnishing (a
non-opening catalog item or a `furnish`-category kind) ends the room context. Free elements
retain direct selection. Room highlights and the read-only inspector follow
`resolveOverlayPolicy` and hide during active interaction scopes. Zone-label selection
still uses `useViewer.selection.zoneId`.

In Select mode, 3D and 2D canvas selection share the same modifier vocabulary:

- `Ctrl/Meta + click` toggles the clicked object in `selectedIds`.
- `Shift + click` also toggles the clicked canvas object so users can multi-select from
  either viewport. The scene graph keeps file-browser semantics: `Shift + click` selects
  the visible range between the last selected row and the clicked row.
- `Ctrl/Meta + left-drag` on a selected movable object starts direct move from the canvas.
- `Ctrl/Meta + right-drag` on a selected rotatable object starts direct rotation from the
  canvas. Rotation snaps to the default angle increment unless Shift is held during the
  drag.

The floating helper in `packages/editor/src/components/ui/helpers/helper-manager.tsx`
mirrors these rules from current selection state and held modifiers. Keep that helper and
the shortcut dialog in sync when changing selection gestures.

### Session groups (editor-only)

`Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G` create and dissolve **session selection groups** in
`use-session-groups` (not the scene graph). Plain click expands to live members via
`expandIdsForNode`, threaded into all three click paths:
`resolveSelectedIdsForNodeClick` (3D), the registry layer's `applyEntrySelection` (2D
entries), and `resolveFloorplanBackgroundSelection` (2D background hit-test). Alt+click
opts out. See [selection-groups](selection-groups.md).

---

## Rules

- **Never add selection logic to renderers.** Renderers spread `useNodeEvents` events and stop there. All selection decisions live in the selection manager.
- **Never add editor phase logic to the viewer's SelectionManager.** Phase, mode, and tool awareness belong exclusively in the editor's selection manager.
- **`useViewer.selection` is the selection of whichever surface is on screen.** The editor and its Preview take turns on it: Preview saves the editor's selection on entry and restores it on exit. Every manager writes through `setSelection` / `resetSelection` (the viewer surfaces through `lib/viewer-selection.ts`); nothing mutates `selection` directly.
- **Viewer surfaces decide in `lib/viewer-selection.ts`, never in a renderer.** A new hit source turns its hit into a `ViewerPick` and calls `applyViewerClick` / `applyViewerHover`.
- **Outliner arrays are mutated in-place** (not replaced) for performance. Don't assign new arrays to `outliner.selectedObjects` or `outliner.hoveredObjects`.
- **Hover is a separate scalar** (`hoveredId: string | null`), not part of `selectedIds`. Update it via `setHoveredId`.

---

## Adding Selectability to a New Node Type

1. Add the type to `SelectableNodeType` in the viewer store / selection manager.
2. Make sure its renderer calls `useNodeEvents(node, type)` and spreads the handlers.
3. Registry kinds with `capabilities.selectable` are picked inside the building automatically; only a viewer hierarchy level needs a case.
4. Ensure `useRegistry` is called in the renderer so the outliner can highlight it.
