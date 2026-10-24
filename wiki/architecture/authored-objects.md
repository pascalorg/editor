# Authored objects

*Geometry an agent writes as plain three.js or a Blender `bpy` module, kept as an `item` with a script source.*

Applies to: `packages/geometry-script/**` (including `bpy/runner.py`), `item.source` in `packages/core/src/schema/nodes/item.ts`, `packages/core/src/agent-operations/author-object.ts`, `packages/core/src/lib/geometry-surfaces.ts`.

## The model

An authored object is an `item` whose `source` holds its module's `language` (`three` or `bpy`), the hash of its module (`script`), its `params`, the hash of the GLB it compiled to (`artifact`) and the `manifest` read from it. The code never rides in the scene: it is a `text/javascript` (or `text/x-python`) artifact that only people who may edit the project can read, so publishing geometry never publishes the code. The manifest stays inline because placement, cuts and queries read it synchronously; the compiler keeps it under 24 KiB (outlines thinned, then the smallest surfaces dropped). `asset.src` is `artifact://<sha256>` and `asset.dimensions` are the compiled bounds, so everything items already do (paint, hosting, lights, the move tool, plan footprint, collections, bake, export) applies unchanged. A catalog item is the same node without `source`.

A `window` or `door` takes the same `source` when its fields cannot express the design (a fan grille, tracery, a carved leaf): `add_window`/`add_door` accept `code` and `params`. Everything script-side is shared with items: the renderer shows the artifact through the item's model path (`ScriptedOpeningModel`), the wall cuts its `cutout` mesh, the Parameters panel replaces the parametric frame's fields, an `open` clip is the Open control, and `get_source` reads it. It is created and rebuilt through its own tool (`add_window`/`add_door`, with `nodeId` to rebuild), where the opening's guidance lives; `add_object` is for objects and points an opening's id there. The kind keeps what makes it an opening: mark, schedule row, plan symbol, opening rules, `IfcWindow`/`IfcDoor`. Width and height are the compiled bounds; params named `width` and `height` are its size controls.

A standalone `column` takes the same source through `add_column` (native fields, optional `code`/`params`, or `nodeId` to rebuild). The column keeps its level, support point, children, plan symbol and `IfcColumn` class. Its artifact supplies its size, paint slots and top surfaces; params named `height`, `width` and `depth` drive the native size handles and the Parameters panel. Columns inside a porch remain typed parts of the porch item.

A raw update (chat `update_node`, MCP `apply_patch`) cannot change what a script owns: a node's `source`, or the size a scripted window, door or column built (`scripted_field`). Those change by rebuilding with the kind's tool and `nodeId`, so the stored size never disagrees with the geometry.

The artifact is the truth: the module runs again only when its code, params or host inputs change, never on view, publish or bake. Where artifacts live is the host's choice through `configureArtifactStore` (in-memory by default). The clipboard carries the project it was copied from; a paste into another project first asks the store's `copyFrom` to bring the referenced artifacts (the hosted app copies them server-side, a script only for someone who may edit the source project), and a node whose artifacts cannot come is left out with a notice. A saved build file carries its project too, and *Load build* brings the artifacts the same way. The hosted app also copies them for a fork, and for a whole scene saved into another project (MCP `save_scene`, Scene API `PUT`) from the writer's own workspace projects, refusing scripted objects whose code it cannot bring.

## The module

```js
import * as THREE from 'three'
export const params = { width: { default: 4.8, min: 3, max: 8, step: 0.1, unit: 'm' } }
export const mount = 'floor' // 'floor' | 'wall' | 'wall-side' | 'ceiling'
export default function build({ params, THREE }) { /* … */ return group }
```

Allowed imports: `three`, `three/addons/…` (BufferGeometryUtils, RoundedBoxGeometry, ConvexGeometry, LoftGeometry, ParametricGeometry) and `three-bvh-csg`. No network, DOM, `eval`, dynamic import or `process`.

Model in metres, Y up, in the installed orientation. The compiler translates the visible
bounds without flipping the object:

| Mount | Normalized origin |
| --- | --- |
| `floor`, `wall` | Bottom-centre; visible geometry starts at local Y = 0. |
| `wall-side` | Bottom-centre of the back face; local Y = 0 and back Z = 0, facing +Z. |
| `ceiling` | Top-centre; visible geometry ends at local Y = 0 and hangs down in negative Y. |

For a ceiling parent, `[x, 0, z]` puts that origin on the drawn attachment plane:
`resolveCeilingHeight − CEILING_DRAW_OFFSET` (0.01 m). The following-ceiling clamp already
reserves 0.01 m below the storey/covering bound; the draw offset is separate. Negative placement
Y lowers the object further. Floor and wall placement conventions are unchanged.

## Blender modules

A worked example, from module to `add_object` call, is in [Blender geometry scripts](../blender-geometry-scripts.md).

```python
import bpy, bmesh
PARAMS = {"width": {"default": 1.8, "min": 1.2, "max": 2.6, "step": 0.05, "unit": "m"}}
MOUNT = "floor"
def build(params): ...  # adds objects to the empty scene it is given
```

`bpy/runner.py` runs the module in a fresh empty scene, resolves `PARAMS` the way `resolveParams` does, and exports everything in the scene as a GLB (modifiers applied, Y up, no images). `compileBlenderBuild` (`@pascal-app/geometry-script/blender`) loads that GLB and hands it to the same `finishBuild` a three.js build goes through, so the manifest, limits and conventions are one implementation; it re-resolves the params and refuses a run that used other values. It runs no model code, so any host may call it. The conventions in Blender terms: Z up and the front faces −Y (Blender's Front view, which the glTF export turns into +Z); convention names are object names, `userData` is custom properties, `slot_<id>` is a material name; a clip is one action, assigned to every object it moves; a light's brightness is its `intensity` custom property (default 2), since Blender's watts do not map onto Pascal's lights. A material whose shader still has the default base colour takes its viewport `diffuse_color`.

Blender cannot run in a browser, so a bpy module is built by its host: the editor calls the `BlenderScriptBuilder` the host configured (`configureBlenderScriptBuilder`) and refuses bpy without one; a params-only rebuild goes the same way. `runBlenderLocally` (`@pascal-app/geometry-script/blender-local`) runs a local Blender binary with no sandbox, for a developer's own machine.

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

`@pascal-app/geometry-script` compiles a module to a GLB and manifest in a browser worker, Bun or Node, and returns both hashes. The host decides the isolation: the editor runs it in a worker with network and storage removed; an MCP server receives a `GeometryScriptHost` (compile, store, read) or answers `scripts_unavailable`. The default in-memory artifact store lasts one session. Local MCP and the standalone editor use a disk store beside the SQLite database that holds their saved scenes (`<database-path>.artifacts/<sha256>`). Keep this directory with the database. Writes verify the hash and publish complete bytes atomically without replacing existing artifacts. Local MCP compilation is opt-in (`PASCAL_SERVER_SCRIPT_COMPILE=1`; bpy modules run in the Blender binary `PASCAL_BLENDER` names); reading saved source does not require compilation.

### Saved ceiling objects

Previously compiled ceiling objects keep their saved GLB, manifest and placement on load,
view, publish and bake. A bottom-centred artifact therefore still extends upward unless its
saved pose already compensates for that origin. The compiler fix does not silently move
existing objects or rewrite their artifacts.

No schema/load migration is needed to keep scenes readable. Correcting an old upward-built
object requires an explicit rebuild with `add_object` and its `nodeId` (or its Parameters
panel). Rebuilding uses the new top-centred convention while keeping identity, placement
and paint. An old negative-Y placement that compensated for bottom-centring is also kept;
after rebuilding it still lowers the new top, so its attachment offset may need an explicit
edit. There is no automatic bulk correction or migration in this change.

## Agent tools

`add_object` (create, or edit by `nodeId`: new code, or params alone to rebuild the stored script; `language` picks `three` or `bpy` and defaults to the object's own), `get_source` (the module, its language and its params, for an edit) and `find_by_type` (nodes and typed parts of one type) are shared contracts in `@pascal-app/core/agent-tools`, one operation each; only the compile step differs per surface. See [agent-surfaces.md](agent-surfaces.md).

A new object carries a `reason`, what it stands in for, kept in `metadata.reason`; `verify_scene` lists every authored object with it (`authoredObjects`), so each names something Pascal has no type for. On a level, a floor object that is a plain box (12 triangles) with a wall's size (≤ 0.45 m thin, ≥ 1 m long, ≥ 2 m high), or a floor plate (≤ 0.35 m thick, ≥ 2 m both ways, on the floor) that has no floor under it, is refused (`use_walls`, `use_slab`). A plate has a floor under it when at least half of its footprint, measured as it will stand, lies over the slabs its level owns (a room's floor plate, a drawn slab, a deck; their holes left out): a rug on a living room's floor is furniture, the same plate on bare ground is a floor, and the scene decides, not the object's name or category. A detailed object with a wall's size (a bookcase's shelves, a screen's holes) is built with a `hint` naming `add_wall`, as is a name whose head word is something Pascal builds, with that tool. These apply to creation only: an edit, which is also the inspector's rebuild path, is never refused for its shape.

For static scripted items directly hosted by a ceiling, `verify_scene` also reports
`item_above_ceiling` (metres above the drawn attachment) and
`item_covering_slab_overlap` (vertical overlap and plan area of transformed bounds against
a solid slab band). Both name the object and host; the latter also names the slab. Bounds
include asset and item offsets, rotations and scales, plus stacked level elevations, and
are reported in the owning building frame. Plan overlap subtracts stored slab holes and
derived authored cutter holes, including partial overlaps rather than just testing a centre.

These are read-only observations, not repair instructions or proof of exact mesh collision.
Catalog or animated objects and unsupported attachment frames are not assessed, nor are
roof intersections, recessed slab shells, foundations or terrain-fill volumes. Upward
geometry in roof-backed rooms still produces the above-attachment observation.

For wall-mounted items, `verify_scene` reports `item_wall_body_overlap`,
`item_through_wall`, and `item_faces_wall`, with IDs, transformed bounds, depths,
and corrected +Z-front orientation. Wall-side Z = 0 lands on the selected wall
face; `side` chooses that face but does not override the saved rotation. A back
mount normally has a π yaw. Correct hidden back-to-wall contact is not z-fighting.
New `add_object` back-side wall mounts default to that π yaw when rotation is
omitted. Explicit rotations and saved rotations on rebuild are preserved; existing
scenes are not rewritten and no blanket stand-off is added.

The item systems register a mesh-backed check for settled, static editor models:
catalog bounds and large, wall-parallel, same-facing coplanar triangles on the host or another
item on the same wall (`item_wall_coplanar_face`,
`item_wall_object_coplanar_face`). It measures overlapping face area and separation
within 1 mm, not a screenshot or a guarantee of visible flicker. Headless callers
without editor meshes still get scripted bounds and mount-orientation observations;
catalog dimensions alone do not establish a raw model origin or a face.

Finite wall bounds and opening rectangles exclude cutout space. Shaped openings
use their enclosing rectangles conservatively; hosts with unresolved scripted wall
cuts withhold wall-body/contact evidence. Curved walls, nested hosts, deformed,
animated, unfinished, dirty and oversized meshes are not assessed. No placement,
artifact or scene data is changed by these checks.

## Room floor scripts

A room's floor finish can be a script: `zone.floor.script` holds the same source record as an item's `source` (language, script and artifact hashes, params, manifest) plus `inputs`, the key of the floor it was built for. The host reads the room's floor with `floorScriptInputs(nodes, zoneId)` (core): `polygon` and `holes`, the room's outline inside the wall faces clipped to its floor plate, and `elevation`, the plate's top, all in level coordinates and metres. It compiles the module with geometry-script's `inputs` (the module reads them as `params.polygon`, `params.holes`, `params.elevation`; they are never stored as params, and the build is kept in the level's frame instead of being re-origined for its mount) and stores the artifacts; `setRoomFloorScript` writes the result, or takes it off with `remove`. Only three.js modules: a Blender build is not given the floor.

Pascal cuts the build to the floor or face and its openings; the module lays out, it does not have to clip: after the module runs, before the merge and export, each mesh is kept inside `polygon` and outside every hole, as a prism over the build's full height. A mesh wholly inside, touching no hole, is kept as built (the common plank, no CSG); one wholly outside or in a hole is dropped; one across the boundary is intersected with the region's prism (`three-bvh-csg`, a closed mesh gaining the cut faces, an open one trimmed), keeping its material and part. The manifest's triangles and bounds are those of the cut build, and the same module and floor give the same bytes. The module still gets `holes` for a layout that wants them (a pattern centred on a column). The cut is the compiler's (`geometry-script/src/cut.ts`), so every host that compiles with `inputs` gets it.

The cut removes what hangs outside the floor; it cannot add what the module never built (odd rows started 40 cm in leave a strip bare along the wall). So after the cut the compiler measures what the build covers (`geometry-script/src/coverage.ts`) and writes it in the manifest: `coverage`, the share of the polygon less its holes the build covers seen from above (0..1, two decimals; joints count as bare), and `uncovered`, up to four rectangles `{ min: [x, z], max: [x, z] }` in level coordinates bounding the largest bare patches, largest first. The floor is read along strips cut at every corner's height, exact for boards and tiles laid square; a 2 cm cell more than half bare is bare, a patch is at least two cells across (no joint is one), and patches within 0.3 m of each other are one. A 20 m² plank floor measures in about 5 ms. `author_scene` warns `finish_gaps` (id `room/<level>/<index>`) when `coverage` is under 0.98 and a patch exists, naming each by the floor's edge it runs along and its extent: "covers 93% of its floor: uncovered along the west edge (0.4 × 4.6 m, x 0 to 0.4, z 0.2 to 4.8)". A tiled floor is never warned for its joints alone.

The zone renderer draws the artifact 1 mm over the plate, with no pointer events of its own, so a click reaches the floor beneath. The script owns the floor's colours: the plate gives a scripted room its own top cell, and `floorPlatePaintRefusal` (the editor's Paint) and `set_zone_intent` (`floor.finish`, `floor.regions`) refuse paint there with a sentence until it is removed. When the structure reconcile re-derives the room (a wall moved, an edge pushed, the floor raised), the key no longer matches (`staleFinishScripts`) and `refreshFinishScripts(nodes, host)` runs the stored module and params again for the new floor; `finishScriptWrites` writes each rebuild only while the floor is still the one it was rebuilt for. The editor tab does this after each settled change (`initFinishScriptRefresh`), writing the rebuild outside history like the reconcile's derived writes. The room panel shows "Scripted finish" with its code and Remove.

## Wall face scripts

The twin of a floor script for one face of one wall: tiles with real joints, panelling to a dado, boards. `wall.finishScripts.a` / `.b` hold the same source record plus `inputs`, the key of the face it was built for, and `toHeight`, metres above the face's base where it stops (absent: the whole face). `wallFaceScriptInputs(nodes, wallId, face, toHeight?)` (core) reads the face in its own frame, in metres: x along the wall from its start, y up from the face's base (its lowest floor), z out of the face. The module gets `params.outline`, the face's rectangle `{ x0, y0, x1, y1 }` between its mitred ends and up to the wall's top or `toHeight`; `params.holes`, the doors and windows cutting it as rectangles clipped to the outline (a door from the floor under it, a window from its sill); `params.base`, the face's floor as `[x, y]` points from end to end (one level run, or a jump where a raised room meets it); and `params.thickness`. Pascal cuts the build to the floor or face and its openings; the module lays out, it does not have to clip: as for a floor, the build is kept inside `outline` and outside every hole rectangle, as a prism along z over the build's depth, so tiles may run past the face's ends and over a window, and `holes` remain for a layout centred on one. Curved and curtain walls have no face to build on. `setWallFaceScript` writes a compile on the face (`face`, `compiled`, `inputs`, `toHeight`) or takes it off with `remove`; three.js modules only.

The manifest carries the same `coverage` and `uncovered` as a floor's, measured on the outline less its holes seen from the room, with patches as `{ min: [x, y], max: [x, y] }` in the face's frame. `author_scene` warns `finish_gaps` (id `<wallId>/a` or `/b`) under the same rule, naming each patch along the wall from its start and up from the base: "covers 85% of the face: uncovered 0 to 0.4 m along the wall from its start, 0 to 2.7 m up (0.4 × 2.7 m)". Tile joints lower `coverage` (4 mm joints on 25 cm tiles: 0.97) but make no patch and no warning.

The wall renderer draws the artifact under the wall mesh, like the trims: `wallFaceScriptPlacement` puts the build's origin at the face's base, 1 mm proud of the face (`getWallLocalFaceZ`), and mirrors face b's build through the wall (scale z −1, which three.js renders with the winding flipped) so x still runs from the wall's start and z points out of face b. It has no pointer events, so clicks reach the wall. The skirting keeps running along the base; where the build comes down into the skirting's band (its bounds' bottom under the skirting's top on that face) the skirting stops over the build's span, as at a door, so the script wins visually; a splashback above it leaves it whole. A script to the top owns the face's colours: `wallFaceScriptPaintRefusal` refuses the face, its paint regions and the room's finish on it in the editor's Paint and the wall's paint commit, and `paint` refuses the face, until the script is removed; a script stopping at `toHeight` leaves the face paintable, since the paint shows above it. The other face is untouched. Stale face scripts (the wall lengthened, an opening added or moved, a floor raised) rebuild through the same `staleFinishScripts` / `refreshFinishScripts` as floors. Turning a wall around swaps its face scripts; a split copies them onto both pieces, which then rebuild for their own faces. `get_source` reads a face script with the wall's id and `face` (optional when one face has one). The wall panel shows "Scripted finish" per face with its code and Remove.

## Cutter binding

A bare `cutout` cuts the surface the object is mounted on. A wall or ceiling parent is the host; a floor item uses its preferred support slab while it overlaps, otherwise the same highest overlapping slab as floor placement. Items resting on other items do not cut a slab beneath them. `cut:wall`, `cut:ceiling` and `cut:slab` require that kind of host; they never select a neighbouring surface.

The compiler saves optional cutter footprints and their vertical extent in the normalized artifact frame. Wall cuts keep using the actual GLB mesh. Ceiling and slab cuts use the footprint as a through-hole when the cutter reaches the host, through the existing surface-hole geometry and plan paths. Holes are derived from the owner’s current pose, not saved as a second editable opening: moving, deleting and undoing the object update the cut, and baking and walkthrough use the resulting host mesh. Older manifests without cutter footprints continue to load.
