---
description: Node renderer pattern in packages/viewer
globs: packages/viewer/**
alwaysApply: false
---

# Renderers

Renderers live in `packages/viewer/src/components/renderers/`. Each renderer is responsible for one node type's Three.js geometry and materials — nothing else.

## Dispatch Chain

```
<SceneRenderer>          — iterates rootNodeIds from useScene
  └─ <NodeRenderer>      — switches on node.type, renders the matching component
       └─ <WallRenderer> — (or SlabRenderer, DoorRenderer, …)
```

See @packages/viewer/src/components/renderers/scene-renderer.tsx and @packages/viewer/src/components/renderers/node-renderer.tsx.

## Renderer Responsibilities

A renderer **should**:
- Read its node from `useScene` via the node's ID
- Register its mesh(es) with `useRegistry()` so other systems can look them up
- Subscribe to pointer events via `useNodeEvents()`
- Render geometry and apply materials based on node properties

A renderer **must not**:
- Run geometry generation logic (that belongs in a System)
- Import anything from `apps/editor`
- Manage selection state directly (use `useViewer` for read, emit events for write)
- Perform expensive per-frame calculations in the component body

## Example — Minimal Renderer

```tsx
// packages/viewer/src/components/renderers/my-node/index.tsx
import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '../../hooks/use-node-events'
import { useScene } from '@pascal-app/core'

export function MyNodeRenderer({ node }: { node: MyNode }) {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, 'my-node', ref)   // 3 args: id, type, ref — no return value
  const events = useNodeEvents(node, 'my-node')

  return (
    <mesh ref={ref} {...events}>
      <boxGeometry args={[node.width, node.height, node.depth]} />
      <meshStandardMaterial color={node.color} />
    </mesh>
  )
}
```

## Adding a New Node Type

1. Create `packages/viewer/src/components/renderers/<type>/index.tsx`
2. Add a case to `NodeRenderer` in `node-renderer.tsx`
3. Add the corresponding system in `packages/core/src/systems/` if the node needs derived geometry
4. Export from `packages/viewer/src/index.ts` if needed externally

## Performance Notes

- Use `useMemo` for geometry that depends on node properties — avoid recreating on every render.
- For complex cutout or boolean geometry, delegate to a System (e.g. `WallCutout`).
- Register one mesh per node ID; if a renderer spawns multiple meshes, use a group ref or pick the primary one for registry.
