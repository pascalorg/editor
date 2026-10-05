# Authored objects

*Geometry an agent writes as plain three.js, kept as an `item` with a script source.*

Applies to: `packages/geometry-script/**`, `item.source` in `packages/core/src/schema/nodes/item.ts`, `packages/core/src/agent-operations/author-object.ts`, `packages/core/src/lib/geometry-surfaces.ts`.

## The model

An authored object is an `item` whose `source` holds the hash of its module (`script`), its `params`, the hash of the GLB it compiled to (`artifact`) and the `manifest` read from it. The code never rides in the scene: it is a `text/javascript` artifact that only people who may edit the project can read, so publishing geometry never publishes the code. The manifest stays inline because placement, cuts and queries read it synchronously; the compiler keeps it under 24 KiB (outlines thinned, then the smallest surfaces dropped). `asset.src` is `artifact://<sha256>` and `asset.dimensions` are the compiled bounds, so everything items already do (paint, hosting, lights, the move tool, plan footprint, collections, bake, export) applies unchanged. A catalog item is the same node without `source`.

A `window` or `door` takes the same `source` when its fields cannot express the design (a fan grille, tracery, a carved leaf): `add_window`/`add_door` accept `code` and `params`. Everything script-side is shared with items: the renderer shows the artifact through the item's model path (`ScriptedOpeningModel`), the wall cuts its `cutout` mesh, the Parameters panel replaces the parametric frame's fields, an `open` clip is the Open control, and `get_source` reads it. It is created and rebuilt through its own tool (`add_window`/`add_door`, with `nodeId` to rebuild), where the opening's guidance lives; `add_object` is for objects and points an opening's id there. The kind keeps what makes it an opening: mark, schedule row, plan symbol, opening rules, `IfcWindow`/`IfcDoor`. Width and height are the compiled bounds; params named `width` and `height` are its size controls.

A standalone `column` takes the same source through `add_column` (native fields, optional `code`/`params`, or `nodeId` to rebuild). The column keeps its level, support point, children, plan symbol and `IfcColumn` class. Its artifact supplies its size, paint slots and top surfaces; params named `height`, `width` and `depth` drive the native size handles and the Parameters panel. Columns inside a porch remain typed parts of the porch item.

A raw update (chat `update_node`, MCP `apply_patch`) cannot change what a script owns: a node's `source`, or the size a scripted window, door or column built (`scripted_field`). Those change by rebuilding with the kind's tool and `nodeId`, so the stored size never disagrees with the geometry.

The artifact is the truth: the module runs again only when its code, params or host inputs change, never on view, publish or bake. Where artifacts live is the host's choice through `configureArtifactStore` (in-memory by default). The clipboard carries the project it was copied from; a paste into another project first asks the store's `copyFrom` to bring the referenced artifacts (the hosted app copies them server-side, a script only for someone who may edit the source project), and a node whose artifacts cannot come is left out with a notice.

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
| mesh `cutout` / `cut:wall` / `cut:ceiling` / `cut:slab` | a cutter applied only to the object’s bound host |
| empty `anchor:<id>` | socket |
| mesh `collider` | walkthrough proxy (hidden) |
| clips on `group.animations` | `open` → open/close toggle (`close` or `open` reversed), `loop` → always on, any other name → its own play toggle |

The compiler also derives upward surfaces (where things rest) and undersides (where ceiling items hang, sloped ones as planes); placement and rebuilds use them. Clips are sampled into position, quaternion and scale tracks, the only ones glTF keeps.

## Compiling

`@pascal-app/geometry-script` compiles a module to a GLB and manifest in a browser worker, Bun or Node, and returns both hashes. The host decides the isolation: the editor runs it in a worker with network and storage removed; an MCP server receives a `GeometryScriptHost` (compile, store, read) or answers `scripts_unavailable`. The default in-memory artifact store lasts one session. Local MCP and the standalone editor use a disk store beside the SQLite database that holds their saved scenes (`<database-path>.artifacts/<sha256>`). Keep this directory with the database. Writes verify the hash and publish complete bytes atomically without replacing existing artifacts. Local MCP compilation is opt-in (`PASCAL_SERVER_SCRIPT_COMPILE=1`); reading saved source does not require compilation.

## Agent tools

`add_object` (create, or edit by `nodeId`: new code, or params alone to rebuild the stored script), `get_source` (the module and its params, for an edit) and `find_by_type` (nodes and typed parts of one type) are shared contracts in `@pascal-app/core/agent-tools`, one operation each; only the compile step differs per surface. See [agent-surfaces.md](agent-surfaces.md).

## Cutter binding

A bare `cutout` cuts the surface the object is mounted on. A wall or ceiling parent is the host; a floor item uses its preferred support slab while it overlaps, otherwise the same highest overlapping slab as floor placement. Items resting on other items do not cut a slab beneath them. `cut:wall`, `cut:ceiling` and `cut:slab` require that kind of host; they never select a neighbouring surface.

The compiler saves optional cutter footprints and their vertical extent in the normalized artifact frame. Wall cuts keep using the actual GLB mesh. Ceiling and slab cuts use the footprint as a through-hole when the cutter reaches the host, through the existing surface-hole geometry and plan paths. Holes are derived from the owner’s current pose, not saved as a second editable opening: moving, deleting and undoing the object update the cut, and baking and walkthrough use the resulting host mesh. Older manifests without cutter footprints continue to load.
