# Pascal Editor — Architecture

## Project Structure

Monorepo managed with Turborepo. Packages are shared libraries; apps are deployable applications.

```
apps/
  editor/          # Main Next.js app (editor + public routes)
packages/
  core/            # Scene schema, state, systems, spatial logic
  viewer/          # 3D canvas component (React Three Fiber)
  ui/              # Shared React UI components
```

---

## packages/core

Central library — no UI, no rendering. Everything else depends on it.

- **schema/** — TypeScript types for all node types (`Wall`, `Slab`, `Door`, `Item`, etc.)
- **store/** — Zustand scene store (`useScene`) with undo/redo via Zundo
- **systems/** — Per-element business logic: geometry generation, constraints (`WallSystem`, `SlabSystem`, `DoorSystem`, …)
- **events/** — Typed event bus for node changes
- **hooks/** — `useRegistry` (node ID → THREE.Object3D), `useSpatialGrid` (2D spatial index)
- **lib/** — Space detection, asset storage, polygon utilities

Node storage is a flat dictionary (`nodes: Record<id, AnyNode>`). Systems are pure logic that runs in the render loop; they read nodes and write back derived geometry.

---

## packages/viewer

3D canvas component — presentation only, no editor concerns.

- **components/viewer/** — Root `<Viewer>` canvas, camera, lights, post-processing, selection manager
- **components/renderers/** — One renderer per node type (`WallRenderer`, `SlabRenderer`, …), dispatched by `NodeRenderer` → `SceneRenderer`
- **systems/** — Viewer-specific systems: `LevelSystem` (stacked/exploded/solo), `WallCutout`, `ZoneSystem`, `InteractiveSystem`
- **store/** — `useViewer`: selection path, camera mode, level mode, wall mode, theme, display toggles

The viewer accepts external props and callbacks (`onSelect`, `onExport`, children) to expose control points. It must not import anything from `apps/editor`.

---

## apps/editor

Next.js 16 app. Composes `@pascal-app/viewer` and `@pascal-app/core` into a full editing experience.

- **app/editor/[projectId]/** — Main editor route
- **app/viewer/[id]/** — Read-only preview route
- **store/use-editor.tsx** — `useEditor`: phase (`site | structure | furnish`), mode (`select | edit | delete | build`), active tool
- **components/tools/** — One component per tool, coordinated by `ToolManager`
- **components/systems/** — Editor-side systems that integrate with viewer (e.g. space detection for cutaway)
- **components/editor/** — Camera controls, export, menus, panels

---

## Data Flow

```
User input (pointer/keyboard)
  → Tool component (apps/editor/components/tools/)
  → useScene mutations
  → Core systems recompute geometry
  → Renderers re-render THREE meshes
  → useViewer updates selection/hover
```

---

## Key Conventions

- **Flat nodes** — All scene nodes live in a single flat record; hierarchy is expressed via `parentId`.
- **System/renderer split** — Systems own logic; renderers own geometry and material. Never mix.
- **Viewer isolation** — `@pascal-app/viewer` must never import from `apps/editor`. Editor-specific behaviour (tools, systems, selection) is injected as children or props.
- **Registry pattern** — `useRegistry()` maps node IDs to live THREE objects without tree traversal.
- **Spatial grid** — 2D grid for fast wall/zone neighbourhood queries; avoid brute-force iteration.
- **Node creation** — Always use `NodeType.parse({…})` then `createNode(node, parentId)`. Never construct raw node objects.

---

## Tech Stack

| Layer | Technology |
|---|---|
| 3D | Three.js (WebGPU), React Three Fiber |
| Framework | Next.js 16, React 19 |
| State | Zustand + Zundo |
| UI | Radix UI, Tailwind CSS 4 |
| Tooling | Biome, TypeScript 5.9, Turborepo |

---

## Material System

The editor supports a flexible material system for all node types.

### Schema Definition

Materials are defined in `packages/core/src/schema/material.ts`:

```typescript
// Preset materials
type MaterialPreset = 'white' | 'brick' | 'concrete' | 'wood' | 'glass' | 'metal' | 'plaster' | 'tile' | 'marble' | 'custom'

// Material properties
type MaterialProperties = {
  color: string        // Hex color
  roughness: number    // 0-1
  metalness: number    // 0-1
  opacity: number      // 0-1
  transparent: boolean
  side: 'front' | 'back' | 'double'
}

// Full material schema
type MaterialSchema = {
  preset?: MaterialPreset
  properties?: MaterialProperties
  texture?: { url: string, repeat?: [number, number] }
}
```

### Supported Nodes

All major node types support the `material` field:

| Node Type | Schema File | Panel Component |
|-----------|-------------|-----------------|
| Wall | `nodes/wall.ts` | `WallPanel` |
| Slab | `nodes/slab.ts` | `SlabPanel` |
| Door | `nodes/door.ts` | `DoorPanel` |
| Window | `nodes/window.ts` | `WindowPanel` |
| Ceiling | `nodes/ceiling.ts` | `CeilingPanel` |
| Roof | `nodes/roof.ts` | `RoofPanel` |
| RoofSegment | `nodes/roof-segment.ts` | `RoofSegmentPanel` |

### Usage

**In Editor UI:**
1. Select a node (wall, slab, door, etc.)
2. Find the "Material" section in the right panel
3. Click a preset color or select "Custom" to adjust properties

**Programmatically:**

```typescript
import { WallNode } from '@pascal-app/core'

// Using preset
const wall = WallNode.parse({
  start: [0, 0],
  end: [5, 0],
  material: { preset: 'brick' }
})

// Custom material
const slab = SlabNode.parse({
  polygon: [[0,0], [5,0], [5,5], [0,5]],
  material: {
    preset: 'custom',
    properties: {
      color: '#8b4513',
      roughness: 0.7,
      metalness: 0.1,
      opacity: 1,
      transparent: false,
      side: 'front'
    }
  }
})
```

### Renderer Integration

Renderers use `createMaterial()` from `packages/viewer/src/lib/materials.ts`:

```typescript
import { createMaterial, DEFAULT_WALL_MATERIAL } from '@pascal-app/viewer'

const material = useMemo(() => {
  return node.material ? createMaterial(node.material) : DEFAULT_WALL_MATERIAL
}, [node.material])

return <mesh material={material} />
```
