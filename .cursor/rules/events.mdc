---
description: Typed event bus — emitting and listening to node and grid events
globs: packages/core/src/events/**,packages/viewer/**,apps/editor/**
alwaysApply: false
---

# Events

The event bus (`emitter`) is a global `mitt` instance typed with `EditorEvents`. It decouples renderers (which emit) from selection managers and tools (which listen).

**Source**: @packages/core/src/events/bus.ts

## Event Key Format

```
<nodeType>:<suffix>
```

Example keys: `wall:click`, `item:enter`, `door:double-click`, `grid:pointerdown`

### Node Types
`wall` `item` `site` `building` `level` `zone` `slab` `ceiling` `roof` `window` `door`

### Suffixes
```ts
'click' | 'move' | 'enter' | 'leave' | 'pointerdown' | 'pointerup' | 'context-menu' | 'double-click'
```

The `grid:*` events fire when the user interacts with empty space (no node hit). They are **not** emitted by a mesh — `useGridEvents(gridY)` (@apps/editor/hooks/use-grid-events.ts) manually raycasts against a ground plane and calls `emitter.emit('grid:click', …)`. Mount it in any tool or editor component that needs empty-space interactions.

## NodeEvent Shape

```ts
interface NodeEvent<T extends AnyNode = AnyNode> {
  node: T                                  // typed node that triggered the event
  position: [number, number, number]       // world-space hit position
  localPosition: [number, number, number]  // object-local hit position
  normal?: [number, number, number]        // face normal, if available
  stopPropagation: () => void
  nativeEvent: ThreeEvent<PointerEvent>
}
```

Grid events only carry `position` and `nativeEvent` (no `node`).

## Emitting

Renderers emit via `useNodeEvents` — never call `emitter.emit` directly in a renderer:

```tsx
// packages/viewer/src/hooks/use-node-events.ts
const events = useNodeEvents(node, 'wall')
return <mesh ref={ref} {...events} />
```

`useNodeEvents` converts R3F `ThreeEvent` into a `NodeEvent` and emits `wall:click`, `wall:enter`, etc. It suppresses events while the camera is dragging.

## Listening

Listen in a `useEffect`. Always clean up with `emitter.off` using the **same function reference**:

```ts
// Single event
useEffect(() => {
  const handler = (e: WallEvent) => { /* … */ }
  emitter.on('wall:click', handler)
  return () => emitter.off('wall:click', handler)
}, [])

// Multiple node types, same handler
useEffect(() => {
  const types = ['wall', 'slab', 'door'] as const
  const handler = (e: NodeEvent) => { /* … */ }
  types.forEach(t => emitter.on(`${t}:click`, handler as any))
  return () => types.forEach(t => emitter.off(`${t}:click`, handler as any))
}, [])
```

See @apps/editor/components/editor/selection-manager.tsx for a full multi-type listener example.

## Rules

- **Renderers only emit, never listen.** Listening belongs in selection managers, tools, or systems.
- **Always clean up.** Forgetting `emitter.off` causes duplicate handlers and memory leaks.
- **Use the same function reference** for `on` and `off`. Anonymous functions inside `useEffect` are fine as long as the ref is captured in the same scope.
- **Don't use emitter for state.** It's for one-shot interaction events. Persistent state goes in `useScene`, `useViewer`, or `useEditor`.
- **`stopPropagation`** prevents the event from being handled by overlapping listeners (e.g. a door on a wall). Call it when a handler should be the final consumer.
