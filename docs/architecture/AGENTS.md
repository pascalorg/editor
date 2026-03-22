# Vesper Editor — Architecture

## Project Structure

Monorepo managed with Turborepo. Packages are shared libraries; apps are deployable applications.

```
apps/
  editor/          # Main Next.js app (editor + public routes)
packages/
  core/            # Scene schema, state, systems, spatial logic
  viewer/          # 3D canvas component (React Three Fiber)
  auth/            # Authentication (better-auth + Supabase)
  db/              # Database layer (Drizzle ORM + Supabase)
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

Next.js 16 app. Composes `@vesper/viewer` and `@vesper/core` into a full editing experience.

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
- **Viewer isolation** — `@vesper/viewer` must never import from `apps/editor`. Editor-specific behaviour (tools, systems, selection) is injected as children or props.
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
| Database | Supabase PostgreSQL + Drizzle ORM |
| Auth | better-auth |
| Tooling | Biome, TypeScript 5.9, Turborepo |
