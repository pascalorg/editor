# Renderers

*How the viewer decides what React mounts for a node.*

Applies to: `packages/viewer/src/components/renderers/`, every `def.renderer` in `packages/nodes/src/<kind>/` and in plugins.

## Dispatch

```
<SceneRenderer>                — maps useScene rootNodeIds to <NodeRenderer>
  └─ <NodeRenderer nodeId>     — def = nodeRegistry.get(node.type)
       ├─ def.renderer set     → the kind's lazy component, under <Suspense>
       ├─ else def.geometry    → <ParametricNodeRenderer>, filled by <GeometrySystem>
       └─ else                 → nothing
```

`NodeRenderer` (`node-renderer.tsx`) renders nothing when the kind is not registered or its plugin is not installed in the project (`isNodeKindEnabled`). It subscribes to registry changes for its own kind only, so a plugin that registers after the first mount re-renders that kind's nodes and no others.

`def.renderer` is a `RendererSource`: today `{ kind: 'parametric', module: () => import('./renderer') }`, made lazy once per source and cached. The `glb` / `instanced-glb` variants are declared but not dispatched yet.

`ParametricNodeRenderer` is the generic renderer for `def.geometry` kinds: an empty `<group>` registered in `sceneRegistry`, with `useNodeEvents`, live drag transforms and overrides, `visible`, a dirty mark on mount, and its hosted children rendered through `<NodeRenderer>`. `<GeometrySystem>` swaps the builder's output into it. See [node-definitions.md](node-definitions.md) for choosing between `geometry`, `renderer` and `system`.

## Adding a renderer

Set `def.renderer` on the kind's definition. That is the only way: never a `case` in `NodeRenderer` and never a per-kind folder under `viewer/src/components/renderers/` (DECISIONS.md E-002). Prefer `def.geometry` unless the kind needs JSX-only features (GLB via `useGLTF`, `<Html>`, drei, instancing, TSL materials).

A custom renderer:

- registers its root with `useRegistry(node.id, kind, ref)` and spreads `useNodeEvents(node, kind)` on it (both public exports of `@pascal-app/core` / `@pascal-app/viewer`);
- renders hosted children with `<NodeRenderer nodeId={childId} />`, or declares `rendersChildren: false`;
- memoises geometry that depends on node fields and leaves dirty-driven rebuilds and cross-node work to a `def.system`;
- imports nothing from `@pascal-app/editor` (DECISIONS.md E-001).

## `node.visible` is the renderer's job

A custom renderer **must** apply `visible={node.visible !== false}` to its root group (or outer renderable). `ParametricNodeRenderer` already does; a kind that ships its own `renderer.tsx` and forgets it stays drawn in the 3D viewport while it is already gone everywhere else: selection candidates, first-person collision, the 2D plan and every export honour the flag. The result is a node that is on screen but unclickable.

If a system writes `.visible` on the kind's registry object every frame (solo mode does this for levels, the zone systems do it to keep `<Html>` labels alive), that write has to fold the node flag in as well, or it silently undoes the prop on the next frame.

The **Site is the one exception**: its flag governs only its own presentation — ground fill, sculpted terrain, boundary line — and stops there. Buildings and items standing on a hidden Site keep their own flag and still render, and the horizon disc is a world backdrop rather than part of the parcel, so it renders regardless.
