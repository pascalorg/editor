# Events

*Typed event bus — emitting and listening to node and grid events.*

Applies to: `packages/core/src/events/**`, `packages/viewer/**`, `apps/editor/**`.

The event bus (`emitter`) is a global `mitt` instance typed with `EditorEvents`. It decouples renderers (which emit) from selection managers and tools (which listen).

**Source**: `packages/core/src/events/bus.ts`

## Event Key Format

```
<nodeType>:<suffix>
node:<suffix>
```

Example keys: `wall:click`, `block:enter`, `node:click`, `grid:pointerdown`

### Node Types
Every registered `AnyNode` discriminator is available as a typed node-event
prefix, including `block`. `node:*` is the cross-kind channel for
consumers that intentionally handle every node kind without maintaining a
parallel list.

### Suffixes
```ts
'click' | 'move' | 'enter' | 'leave' | 'pointerdown' | 'pointerup' | 'context-menu' | 'double-click'
```

The `grid:*` events fire when the user interacts with empty space (no node hit). They are **not** emitted by a mesh — `useGridEvents(gridY)` (`apps/editor/hooks/use-grid-events.ts`) manually raycasts against a ground plane and calls `emitter.emit('grid:click', …)`. Mount it in any tool or editor component that needs empty-space interactions.

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

Grid events carry `position`, `localPosition`, optional hit metadata, and
`nativeEvent` (but no `node`).

## Selection Intent Events

`selection:canvas-node-click` fires after the editor accepts a 2D or 3D node
click and resolves the node that selection actually targets. Hosts can use it
for contextual navigation without reacting to programmatic `setSelection`
calls. The payload is the resolved `AnyNode`.

`selection:find-node` is the explicit reveal intent emitted by the node action
menu. Hosts and plugins that own catalogs or panels listen to it and reveal the
node's related controls or presets.

## Emitting

Renderers emit via `useNodeEvents` — never call `emitter.emit` directly in a renderer:

```tsx
// packages/viewer/src/hooks/use-node-events.ts
const events = useNodeEvents(node, 'wall')
return <mesh ref={ref} {...events} />
```

`useNodeEvents` converts R3F `ThreeEvent` into a `NodeEvent` and emits both the
kind-specific event (`wall:click`, `block:enter`, etc.) and its generic
`node:*` counterpart. It suppresses events while the camera is dragging.

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

See `apps/editor/components/editor/selection-manager.tsx` for a full multi-type listener example.

## Rules

- **Renderers only emit, never listen.** Listening belongs in selection managers, tools, or systems.
- **Always clean up.** Forgetting `emitter.off` causes duplicate handlers and memory leaks.
- **Use the same function reference** for `on` and `off`. Anonymous functions inside `useEffect` are fine as long as the ref is captured in the same scope.
- **Don't use emitter for state.** It's for one-shot interaction events. Persistent state goes in `useScene`, `useViewer`, or `useEditor`.
- **`stopPropagation`** prevents the event from being handled by overlapping listeners (e.g. a door on a wall). Call it when a handler should be the final consumer.
