# Pascal Editor V2 — Architecture

> [!WARNING]
> Repository Drift Notice (2026-03-25)
>
> This architecture note still references `packages/auth` and `packages/db`, but
> those directories are not present in the current `main` checkout.
>
> Verified facts in the current clone:
> - `packages/` contains `core`, `editor`, `eslint-config`, `typescript-config`, `ui`, `viewer`
> - `packages/auth` is absent
> - `packages/db` is absent
> - `supabase/` is absent
>
> Treat the auth / db references below as historical or planned architecture,
> not as a description of the current working tree.

## Project Structure

Monorepo managed with Turborepo. Packages are shared libraries; apps are deployable applications.

```
apps/
  editor/          # Thin Next.js shell app for local and deployed usage
packages/
  core/            # Scene schema, state, systems, spatial logic
  editor/          # Reusable editor package consumed by apps/editor
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

## packages/editor

Reusable editor package. This is where the editing experience actually lives.

- **components/editor/** — main editor composition
- **components/tools/** — build and edit tools coordinated by `ToolManager`
- **components/ui/** — sidebars, panels, action menu, scene import/export hooks
- **hooks/** — autosave and editor lifecycle helpers
- **lib/scene.ts** — `SceneGraph` shape plus `applySceneGraphToEditor()`

The package consumes `@pascal-app/core` and `@pascal-app/viewer` and is then mounted by the Next.js shell app.

---

## apps/editor

Thin Next.js 16 wrapper around `@pascal-app/editor`.

- **app/page.tsx** — mounts the editor package into a full-screen route
- **env.mjs** — runtime environment validation
- **next.config.ts** — Next.js configuration and transpile settings

Treat this app as the host shell, not the primary location of editing logic.

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

## Historical Note

Older documentation and commits referenced Supabase, Drizzle, and better-auth packages.
Those packages are not part of the current working tree. If you need that stack,
consult git history rather than assuming those directories still exist.
