---
description: Scene registry pattern — mapping node IDs to live THREE.Object3D instances
globs: packages/core/src/hooks/scene-registry/**,packages/viewer/**
alwaysApply: false
---

# Scene Registry

The scene registry is a global, mutable map that links node IDs to their live `THREE.Object3D` instances. It avoids tree traversal and lets systems and selection managers do O(1) lookups.

**Source**: @packages/core/src/hooks/scene-registry/scene-registry.ts

## Structure

```ts
export const sceneRegistry = {
  nodes: new Map<string, THREE.Object3D>(),   // id → Object3D
  byType: {
    wall: new Set<string>(),
    slab: new Set<string>(),
    item: new Set<string>(),
    // … one Set per node type
  },
}
```

`nodes` is the primary lookup. `byType` lets systems iterate all objects of one type without scanning the whole map.

## Registering in a Renderer

Every renderer must call `useRegistry` with a `ref` to its root mesh or group. Registration is synchronous (`useLayoutEffect`) so it's available before the first paint.

```tsx
import { useRegistry } from '@pascal-app/core'

export function WallRenderer({ node }: { node: WallNode }) {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, 'wall', ref)   // ← required in every renderer

  return <mesh ref={ref} … />
}
```

The hook handles both registration on mount and cleanup on unmount automatically.

## Looking Up Objects

Anywhere outside the renderer — in systems, selection managers, export logic:

```ts
// Single lookup
const obj = sceneRegistry.nodes.get(nodeId)
if (obj) { /* use obj */ }

// Iterate all walls
for (const id of sceneRegistry.byType.wall) {
  const obj = sceneRegistry.nodes.get(id)
}
```

## Rules

- **One registration per node ID.** If a renderer spawns multiple meshes, register the outermost group (the one that represents the node).
- **Never hold a stale reference.** Always read from `sceneRegistry.nodes.get(id)` at the time you need it — don't cache the result across frames.
- **Don't mutate the registry manually.** Only `useRegistry` should add/remove entries. Systems and selection managers are read-only consumers.
- **Core systems must not use the registry.** They work with plain node data. Only viewer systems and selection managers may do Three.js object lookups.

## Outliner Sync

The `outliner` in `useViewer` holds live `Object3D[]` arrays used by the post-processing outline pass. Selection managers sync them imperatively for performance (array mutation rather than new allocations):

```ts
outliner.selectedObjects.length = 0
for (const id of selection.selectedIds) {
  const obj = sceneRegistry.nodes.get(id)
  if (obj) outliner.selectedObjects.push(obj)
}
```

See @packages/viewer/src/components/viewer/selection-manager.tsx for the full sync pattern.
