# Authored objects

*Geometry an agent writes as plain three.js, kept as an `item` with a script source.*

Applies to: `packages/geometry-script/**`, `item.source` in `packages/core/src/schema/nodes/item.ts`, `packages/core/src/agent-operations/author-object.ts`, `packages/core/src/lib/geometry-surfaces.ts`.

## The model

An authored object is an `item` whose `source` holds the module (`code`), its `params`, the hash of the GLB it compiled to (`artifact`) and the `manifest` read from it. `asset.src` is `artifact://<sha256>` and `asset.dimensions` are the compiled bounds, so everything items already do (paint, hosting, lights, the move tool, plan footprint, collections, bake, export) applies unchanged. A catalog item is the same node without `source`.

The artifact is the truth: the module runs again only when its code, params or host inputs change, never on view, publish or bake. Where artifacts live is the host's choice through `configureArtifactStore` (in-memory by default).

## The module

```js
import * as THREE from 'three'
export const params = { width: { default: 4.8, min: 3, max: 8, step: 0.1, unit: 'm' } }
export const mount = 'floor' // 'floor' | 'wall' | 'wall-side' | 'ceiling'
export default function build({ params, THREE }) { /* … */ return group }
```

Allowed imports: `three`, `three/addons/…` (BufferGeometryUtils, RoundedBoxGeometry, ConvexGeometry, LoftGeometry, ParametricGeometry) and `three-bvh-csg`. No network, DOM, `eval`, dynamic import or `process`.

## Naming conventions read into the manifest

| In the output | Becomes |
| --- | --- |
| material `slot_<id>` | paint slot (other materials become slots by name) |
| object `part:<id>`, `userData.type` | addressable, typed part with bounds (`find_by_type`) |
| a three.js light, or `light:<id>` | switchable light effect |
| mesh `cutout` | the opening it cuts in its host wall, in its real shape |
| empty `anchor:<id>` | socket |
| mesh `collider` | walkthrough proxy (hidden) |
| clips on `group.animations` | `open` → open/close toggle (`close` or `open` reversed), `loop` → always on, any other name → its own play toggle |

The compiler also derives upward surfaces (where things rest) and undersides (where ceiling items hang, sloped ones as planes); placement and rebuilds use them. Clips are sampled into position, quaternion and scale tracks, the only ones glTF keeps.

## Compiling

`@pascal-app/geometry-script` compiles a module to a GLB and manifest in a browser worker, Bun or Node. The host decides the isolation: the editor runs it in a worker with network and storage removed; an MCP server receives a `GeometryScriptHost` (compile + store) or answers `scripts_unavailable`.

## Agent tools

`author_object` (create or edit) and `find_by_type` (nodes and typed parts of one type) are shared contracts in `@pascal-app/core/agent-tools`, one operation each; only the compile step differs per surface. See [agent-surfaces.md](agent-surfaces.md).
