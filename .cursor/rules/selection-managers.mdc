---
description: Selection managers — two-layer architecture for viewer and editor selection
globs: packages/viewer/src/components/viewer/selection-manager.tsx,apps/editor/components/editor/selection-manager.tsx
alwaysApply: false
---

# Selection Managers

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

Multi-select: `Ctrl/Meta + click` toggles an ID in `selectedIds`. Regular click replaces it.

---

## Editor Selection Manager

Extends selection with phase awareness from `useEditor`. The viewer's `SelectionManager` is **not** mounted in the editor; this one takes its place (injected as a child of `<Viewer>`).

```
phase: 'site'      → selectable: buildings
phase: 'structure' → selectable: walls, zones, slabs, ceilings, roofs, doors, windows
  structureLayer: 'zones'    → only zones
  structureLayer: 'elements' → all structure types
phase: 'furnish'   → selectable: furniture items only
```

Clicking a node of a different phase auto-switches the phase. Double-click drills into a context level.

---

## Rules

- **Never add selection logic to renderers.** Renderers spread `useNodeEvents` events and stop there. All selection decisions live in the selection manager.
- **Never add editor phase logic to the viewer's SelectionManager.** Phase, mode, and tool awareness belong exclusively in the editor's selection manager.
- **`useViewer` is the single source of truth for selection state.** Both managers read and write through `setSelection` / `resetSelection`. Nothing else should mutate `selection` directly.
- **Outliner arrays are mutated in-place** (not replaced) for performance. Don't assign new arrays to `outliner.selectedObjects` or `outliner.hoveredObjects`.
- **Hover is a separate scalar** (`hoveredId: string | null`), not part of `selectedIds`. Update it via `setHoveredId`.

---

## Adding Selectability to a New Node Type

1. Add the type to `SelectableNodeType` in the viewer store / selection manager.
2. Make sure its renderer calls `useNodeEvents(node, type)` and spreads the handlers.
3. Add a case to whichever selection strategy needs it (viewer hierarchy level or editor phase).
4. Ensure `useRegistry` is called in the renderer so the outliner can highlight it.
