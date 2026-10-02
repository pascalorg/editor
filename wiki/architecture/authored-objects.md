# Authored objects

*Geometry an agent writes as plain three.js, kept as an `item` with a script source.*

Applies to: `packages/geometry-script/**`, `item.source` in `packages/core/src/schema/nodes/item.ts`, `packages/core/src/agent-operations/author-object.ts`, `packages/core/src/lib/geometry-surfaces.ts`.

## The model

An authored object is an `item` whose `source` holds the hash of its module (`script`), its `params`, the hash of the GLB it compiled to (`artifact`) and the `manifest` read from it. The code never rides in the scene: it is a `text/javascript` artifact that only people who may edit the project can read, so publishing geometry never publishes the code. The manifest stays inline because placement, cuts and queries read it synchronously; the compiler keeps it under 24 KiB (outlines thinned, then the smallest surfaces dropped). `asset.src` is `artifact://<sha256>` and `asset.dimensions` are the compiled bounds, so everything items already do (paint, hosting, lights, the move tool, plan footprint, collections, bake, export) applies unchanged. A catalog item is the same node without `source`.

A `window` or `door` takes the same `source` when its fields cannot express the design (a fan grille, tracery, a carved leaf): `add_window`/`add_door` accept `code` and `params`. Everything script-side is shared with items: the renderer shows the artifact through the item's model path (`ScriptedOpeningModel`), the wall cuts its `cutout` mesh, the Parameters panel replaces the parametric frame's fields, an `open` clip is the Open control, and `get_source` reads it. It is created and rebuilt through its own tool (`add_window`/`add_door`, with `nodeId` to rebuild), where the opening's guidance lives; `add_object` is for objects and points an opening's id there. The kind keeps what makes it an opening: mark, schedule row, plan symbol, opening rules, `IfcWindow`/`IfcDoor`. Width and height are the compiled bounds; params named `width` and `height` are its size controls.

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

`@pascal-app/geometry-script` compiles a module to a GLB and manifest in a browser worker, Bun or Node, and returns both hashes. The host decides the isolation: the editor runs it in a worker with network and storage removed; an MCP server receives a `GeometryScriptHost` (compile, store, read) or answers `scripts_unavailable`. The default in-memory artifact store lasts one session; a host that persists scenes configures its own.

## Agent tools

`add_object` (create, or edit by `nodeId`: new code, or params alone to rebuild the stored script), `get_source` (the module and its params, for an edit) and `find_by_type` (nodes and typed parts of one type) are shared contracts in `@pascal-app/core/agent-tools`, one operation each; only the compile step differs per surface. See [agent-surfaces.md](agent-surfaces.md).
