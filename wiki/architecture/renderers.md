# Renderers

*Node renderer pattern in `packages/viewer`.*

Applies to: `packages/viewer/**`.

Renderers live in `packages/viewer/src/components/renderers/`. Each renderer is responsible for one node type's Three.js geometry and materials — nothing else.

> **For registry-driven kinds, the default is no custom renderer.** Set `def.geometry` instead and the framework mounts a generic renderer + geometry system for you. See [node-definitions.md](node-definitions.md). The pattern below applies to kinds that *do* need a custom renderer (GLB, `<Html>`, drei, instancing, shader materials).

## Dispatch Chain

```
<SceneRenderer>          — iterates rootNodeIds from useScene
  └─ <NodeRenderer>      — switches on node.type, renders the matching component
       └─ <WallRenderer> — (or SlabRenderer, DoorRenderer, …)
```

See `packages/viewer/src/components/renderers/scene-renderer.tsx` and `packages/viewer/src/components/renderers/node-renderer.tsx`.

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

## `node.visible` Is the Renderer's Job

A custom renderer **must** apply `visible={node.visible !== false}` to its root group (or outer renderable). Registry-driven kinds get this for free — `ParametricNodeRenderer` already sets it — but a kind that ships its own `renderer.tsx` and forgets it stays drawn in the 3D viewport while it is already gone everywhere else: selection candidates, first-person collision, the 2D plan and every export honour the flag. The result is a node that is on screen but unclickable.

If a system writes `.visible` on the kind's registry object every frame (solo mode does this for levels, the zone systems do it to keep `<Html>` labels alive), that write has to fold the node flag in as well, or it silently undoes the prop on the next frame.

The **Site is the one exception**: its flag governs only its own presentation — ground fill, sculpted terrain, boundary line — and stops there. Buildings and items standing on a hidden Site keep their own flag and still render, and the horizon disc is a world backdrop rather than part of the parcel, so it renders regardless.

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

For new kinds, prefer the registry-driven model in [node-definitions.md](node-definitions.md). The legacy steps below apply only when a kind needs a custom React renderer (GLB loaders, `<Html>` portals, etc.) **and** lives in `packages/viewer` rather than `packages/nodes/<kind>`:

1. Create `packages/viewer/src/components/renderers/<type>/index.tsx`
2. Add a case to `NodeRenderer` in `node-renderer.tsx`
3. Add the corresponding system in `packages/core/src/systems/` if the node needs derived geometry
4. Export from `packages/viewer/src/index.ts` if needed externally

## Performance Notes

- Use `useMemo` for geometry that depends on node properties — avoid recreating on every render.
- For complex cutout or boolean geometry, delegate to a System (e.g. `WallCutout`).
- Register one mesh per node ID; if a renderer spawns multiple meshes, use a group ref or pick the primary one for registry.
