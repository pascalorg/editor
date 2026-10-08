# Selection Managers

*Two-layer selection architecture: viewer manager (hierarchy) + editor manager (site or building).*

Applies to: `packages/viewer/src/components/viewer/selection-manager.tsx`, `apps/editor/components/editor/selection-manager.tsx`.

There are two selection managers. They are separate components, not the same component configured differently.

| Component | Location | Knows about |
|---|---|---|
| `SelectionManager` | `packages/viewer/src/components/viewer/selection-manager.tsx` | Viewer state only |
| `SelectionManager` (editor) | `apps/editor/components/editor/selection-manager.tsx` | Phase, mode, tool state |

The viewer's manager is the default. The editor mounts its own manager as a child of `<Viewer>`, overriding the default behaviour via the viewer-isolation pattern.

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

## Viewer Selection Manager

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
  room-first walls, slabs and ceilings; room label pills (`RoomLabels3D`) appear
  while nothing else is selected and let pointer events reach the scene
```

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
- **`useViewer` is the single source of truth for scene-node selection state.** Both managers read and write through `setSelection` / `resetSelection`. Nothing else should mutate `selection` directly.
- **Outliner arrays are mutated in-place** (not replaced) for performance. Don't assign new arrays to `outliner.selectedObjects` or `outliner.hoveredObjects`.
- **Hover is a separate scalar** (`hoveredId: string | null`), not part of `selectedIds`. Update it via `setHoveredId`.

---

## Adding Selectability to a New Node Type

1. Add the type to `SelectableNodeType` in the viewer store / selection manager.
2. Make sure its renderer calls `useNodeEvents(node, type)` and spreads the handlers.
3. Registry kinds with `capabilities.selectable` are picked inside the building automatically; only a viewer hierarchy level needs a case.
4. Ensure `useRegistry` is called in the renderer so the outliner can highlight it.
