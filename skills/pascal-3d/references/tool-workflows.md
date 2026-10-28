# Pascal MCP tool workflows

Source reviewed on 2026-09-08 against repository code whose package version field is `@pascal-app/mcp` 1.0.0-beta.6. This is not a claim that the package was published or natively host-tested. Installed and hosted releases may expose a different schema, so inspect the advertised tools first.

Inspect the server's advertised tools because hosted and local releases may differ. Never call a guessed tool.

## Inspect an existing project

1. `list_scenes`
2. `load_scene`
3. `get_project_status`
4. `list_levels`
5. `get_level_summary`, `get_walls`, `get_zones`, `find_by_type`, or `get_node`
6. `verify_scene`

`get_scene` returns the full graph and is useful when a compact summary omits a field needed for a calculation, such as an item's scale.

## Open a room scan (hosted only)

These three tools exist only on the hosted Pascal server. A local CLI connection does not advertise them, so inspect the advertised tools before assuming this path is available.

1. `list_captures`, optionally narrowed by `projectId`, `status`, or `limit`.
2. `get_capture` with the `captureId`, adding `includeScanMetrics` when the answer needs scan quality numbers.
3. `open_capture_as_project` once the capture reports `processed`, to bind the owning project's persisted draft into the session.
4. Continue with the project workflows above.

All three require edit access on the scan's own project; view access, including a public project owned by someone else, is refused as not found. The first two are read-only. `open_capture_as_project` creates nothing and is idempotent, but it carries the same non-read-only annotation as `get_project_status` because it changes the project the session is bound to.

## Create an editable project

1. `create_project`
2. `create_house_from_brief` for a supported quick start, or semantic construction tools for precise control
3. Add openings and furniture with semantic tools
4. `verify_scene`
5. `save_scene` with `saveMode: "draft"`
6. `get_project_status`

Use `checkpoint` only at a meaningful milestone. A browser-visible draft and a durable checkpoint are distinct states.

### The ground line

A building's levels stand on a ground line: the level at grade (`set_ground_level` names it and seats the building with its floor 8 in over grade, the top of the foundation; until then it is the lowest level whose floor is not under the ground), the levels with a lower floor index below grade. `list_levels` reads `groundLevels` and each level's `gradeStanding`. A new wall on a level below grade is an 8 in CMU foundation wall with 2x4 pressure-treated furring laid flat inside (0.241 m); a wall given a thickness keeps it, and the result of `add_level`, `add_wall` and `create_room` says so. A basement added with `add_level` goes under the lowest floor and every existing floor keeps its place.

## Make a bounded edit

1. Read the target and its surrounding level.
2. Record the pre-edit project version or graph hash when available.
3. Apply one semantic edit. Use `apply_patch` only when necessary; its batch is atomic and forms one undo step.
4. Re-read the target and validate the scene.
5. Save and report the changed IDs.

If a live-sync version conflict occurs, call `load_scene`, inspect the newer graph, and rebase the requested edit. Do not retry an old whole-scene write blindly.

## Build a scripted object (hosted)

`add_object`, and `add_window`, `add_door` or `add_column` with `code` or new params on a scripted node, compile in the user's open Pascal editor tab of the project (a `bpy` module builds in Pascal's Blender service instead, with no tab). When none is open the call answers `editor_tab_required` with `editorUrl` and `mutationApplied: false`; nothing changed. Show the user the link, wait until they confirm the tab is open, and repeat the same call. `editor_tab_busy` means a tab is open but busy or still loading: wait a few seconds and repeat the same call, without asking the user. Whether you may open the link yourself is the person's setting ("Agents may open the editor for me"; Ask first: ask the user to open the link (or bring the tab forward), or ask their permission before opening it yourself; Allow: you may open the link yourself, in a tab in front; Never: ask the user, and do not open or switch windows yourself); the refusal's words say which, so follow them. `editor_tab_timeout` means the tab stopped answering; ask whether it is still open, then retry. `script_failed` is the module's own error: fix the code.

## Convert a design written as three.js

`author_scene` turns a whole design you wrote as one three.js module into native, editable Pascal nodes in one call. The reading is yours; the writing is Pascal's.

1. Read your module: its source for intent (helper names, declared opening types), the executed graph for truth (world transforms, deleted objects gone). Most designs make walls with a helper such as `wall(x1, z1, x2, z2, height, thickness, openings)`: those arguments are the payload's walls.
2. Build the payload: per level, `walls` (centerline `start`/`end`, `height`, `thickness`, `through` to bend it into an arc from start through that plan point to end (the arc's middle: put it outside the building for a bay that bulges out; at most half the span from the straight line): one curved wall for a bay, an apse or a drum, never a run of short straight ones, its openings' `along` measured along the arc, rooms derived from the arc, nothing hung on it, no face module; `curtain` for a glass wall between mullions, straight or curved (`spacing`, default 1.5 m, `frameColor`), whose faces take no paint or skirting, `color` for both faces, `colorInside` / `colorOutside` for the faces that look into a room of the level and the face that does not (Pascal finds which once the rooms are derived and says so in `defaults`; give an outside wall's two finishes this way), or `colorLeft` / `colorRight` for one face, the left being on your left looking from start to end, over the other two; a hex is written as an exact material, one per colour; `skirting` with `height` (default 0.1 m), `depth` (default 0.012 m) and `color` for the baseboard, native on the wall along the faces its rooms stand on), their `openings` (`kind` door, window or passage, a doorway with no leaf, `along` from the wall's start, `width`, `height`, `sill`, `shape` rectangle, rounded or arch with `archHeight`, `type` for how it opens: hinged, double, french, sliding, pocket… for a door, fixed, casement, awning, double-hung… for a window; `style` for its look: glass, six-panel, modern… for a leaf, grid, transom, double-hung… for a fixed window's panes; `leaves`, `hinge`; or `code`, a module with mount `wall`, for a shape those cannot express), `rooms` (`name`, `seed`, `unit`, in a building of several dwellings or tenancies, the name of the dwelling, suite or lot the room belongs to (Apartment 2B, Suite 301, Shop 1; a room naming none is common area: a corridor, a lobby, the stairs; a single-family house has no units), `floor` as `library:<id>` from `search_materials` or `#rrggbb`; `floorCode` for planks, tiles or boards, a module that receives `params.polygon` and `params.holes`, plan x/z in level coordinates and metres, and lays out the finish with y = 0 at the floor's surface (lay it from there up; Pascal stands the build on the floor plate and what stands on that floor, a rug or a sofa at y = 0, on the build's top), which Pascal cuts to that floor and its holes: Pascal rebuilds it when the room changes, `floor` stays the fallback, `get_source` with the room's id reads it back; `wallCode`, with `wallToHeight`, for the finish of every wall face the room looks into), each wall's `faceLeft` / `faceRight` (`code`, `toHeight` from the face's base, default the whole face) for tiles, panelling or boards on that face, or `faceOutside` for cladding, brick or battens on the face no room looks into (Pascal finds it, as for `colorOutside`), a module that receives `params.outline`, `params.holes`, `params.base` and `params.thickness` in wall-local metres (x along the wall from its start, y up from the face's base, z out of the face) and lays out the finish, which Pascal cuts to the outline and its openings, over the room's `wallCode`, `colorLeft` / `colorRight` staying the paint under it, `slabs` (terraces, platforms, balconies: Pascal builds floor plates, wall caps and ceilings itself, so fold a module's caps, underlays and floor planks into the wall, the floor finish and the room, and say so in `notes`; `surfaceCode` for a terrace's decking or paving, a module that receives the slab's `params.polygon` and `params.holes` and lays the finish from y = 0, the slab's top, as a room's `floorCode` does; each `railing` run (`start`, `end`, `height`, `color`) a fence standing on the slab), `voids` (a `polygon` in the level's floor that the room below rises through: a double-height living room under a gallery, an atrium; Pascal cuts that floor and the ceiling under it, stops the cut at the faces of the level's walls, and runs a `railing` (`height`, default 1.1 m, `color`; null for none) along its open edges, broken at walls and where a stair arrives; a ceiling item or a light under it hangs from the ceiling above; never on the first level), `columns` (`shape` square or round, a round one's `width` its diameter, `rotation`, `color` as an exact material, or `code`, a module with mount `floor` as `add_column` takes it, whose build sets the size and keeps its own colours), `stairs` (`start`, the middle of the bottom step's front edge, `rotation` 0 climbing toward +z, 90 toward +x, `width` (default 1 m), `layout` straight, l or u, `turn` left or right, `length`, `railing` none, left, right or both, `railingStyle`, `color` for the flight, `treads` over it, `railingColor`: each rises to the next level in `levels`, as `create_stair` builds it, and opens the floor above over its flights; a stair is never an item), `items` (`id`, `name`, `category`, `code` as its own module, `position` at its bottom centre, `rotation`, `host` for a lamp on a nightstand or a mirror on a wall; a module with mount `ceiling`, a pendant or a ceiling light, hangs from the ceiling of the room containing its plan position, its top on that ceiling, y not read; a rug, a mat or a runner on a room's floor is an item), `lights` (`position`, `fixture`); and, on the payload, `units` (`name`, `kind` apartment, hotel-room, commercial or common, `color`) to type or colour the units the rooms name: Pascal makes one unit per distinct name under the building, holding the rooms that name it, on whatever levels they are (a duplex); a unit named only by rooms is an apartment. A light without `fixture` gets a minimal ceiling point hosted on its room’s ceiling; outside every room it falls back to the nearest item on the level, reported in `defaults`. Item and scripted-opening slots keep their authored colour, roughness and metalness as exact materials; a material named `glass` or made transparent stays Pascal’s glass, and an emissive one keeps its own glow. Opening `color` paints the door’s panel and frame or the window’s frame; `frameColor` overrides the frame (default: `color`). Scripted openings keep their declared `type`; only `style` is ignored. Wall-hosted items keep their bottom centre’s outward distance from the nearest face; a point inside the wall moves to the face and is reported in `defaults`. Give each level its `elevation`, its floor's surface: a storey is as tall as the climb to the next level's floor (the top one as its tallest wall); walls keep their height and Pascal draws the floor between storeys from the tallest wall within 0.5 m under it up to that floor (2.7 m walls under a floor at 2.9 m: 2.7 m rooms and a 0.2 m floor); a wall reaching into that floor stops under it. End a partition on the centerline of the wall it meets. One item per piece: a bed, each nightstand, each chair.
3. Call `author_scene` with `payload`, `module` and `adapter` (your program), or with `module` and `adapter` alone: Pascal runs the adapter (`export default async function adapt({ THREE, addons, source, run, toModule })`, `run()` building your module and answering `{ scene }`, `toModule(object, options)` writing a part of it as an item's or an opening's module) and writes the payload it returns. A payload too large for one call (a whole house with its modules) goes by reference: upload it as a JSON project file (`upload_project_file`, phase `prepare`, PUT the bytes, `complete`) and pass its `fileId` as `payloadFile`. An adapter that throws answers `adapter_failed` with its error, a payload its schema refuses `payload_invalid` with every issue's path, and nothing is written. Furniture you would rather describe than model: `add_object` with `piece` (`description`, `size`, `mount`, `id`) answers at once, `pending`, while Pascal's own model writes the module; an item with `piece: "<id>"` instead of `code` places it, and one still being made is listed in `pending` and written when it lands, with no call from you. Read the report: `defects` by your own ids with a code (`compile_failed`, `room_not_enclosed`, `host_missing`, `slab_over_wall`, `use_slab`, `skirting_refused` for a wall with no room on either face, `floor_script_failed` for a floor module that did not build, `face_script_failed` (`<wallId>/<face>`) for a face module that did not build, `no_face` for a face no room looks into, `no_ceiling` for a ceiling item outside every room, `no_level_above` for a stair on the top level, `curved_host` for an item hung on a curved wall, `no_level_below` for a void on the first level, `no_floor` for a void over no floor of its level, `unit_split_room` for seeds of one enclosure naming different units, the room then in none…), `stairs` (stairs written), `units` (units made, `unit/<name>` in `ids`), `floorScripts` (rooms whose floor module was built), `faceScripts` (wall faces whose module was built), `warnings` (written, but doubtful: `thin_slab`, `many_slabs`, `many_regions`, `face_shared` for a face two rooms' `wallCode` claim, `use_stairs` for a stair given as an item, `no_floor_opening` for a stair no floor above covers, `flat_on_arc` for a door or window too wide for its curved wall, with the widest that fits, `over_void` for an item standing over a void, `wall_in_void` for a wall standing inside one), `defaults` (what Pascal filled in or dropped: a window with no `type` written fixed, a handle set opposite its hinge, a style dropped on an operable window, a ceiling point for a light without a fixture, the ceiling a ceiling item hangs from, which faces `colorInside` took, each stair and its opening), `snapped` wall ends, `verify` issues, `itemsCompiled`, `pending`, `checks` (each `passed`, or with what failed: `openings` that a person operates but do not move, `glass` that is no glass, `floors` not covered, `pieces` not standing, `outside` debris or buried slabs, `faces`, `stairs` arriving outside a room or into a wall, `levels` holding no rooms or walls, since the ground, terraces and foundations belong to the ground level, `rooms_in_units` where units are named: every room on a level with units is in one or is common area by its name), `complete`, the editor link.
4. Fix the program, not the payload by hand, and call again with `replace: true`: the module and adapter you leave out are the stored ones, and `edits` (`{ in: 'module' | 'adapter', find, replace }`, each `find` occurring exactly once) change part of them without sending them again. Look at the scene with `view_scene` between rounds. Stop when `complete` is true and the scene looks like the design. Report what you could not convert in `notes`.

## Wrap a window around a corner

Where a photo's glass meets at a corner with no wall between the panes, build one corner window rather than two windows near the corner (which leave it solid).

1. `get_walls` on the level: the corner is the point the two walls end at, `[x, z]`.
2. `add_corner_window({ corner, levelId, width?, post? })`: one window on each wall of that level, both running to the corner and joined; `post: "post"` puts a thin post at the corner, the default fuses a fixed window's glass (other window types meet at a post). Name the level: stacked storeys share their corners' points. Pass `wallIds` only when more than two walls of the level end there.
3. Read `windowIds`, `wallIds` and `angle` in the answer. `corner_angle` means the walls meet under 10° or over 170°: along a straight run one `add_window` is the window. `verify_scene` notes two unjoined windows that run to one corner (`corner_unjoined`).
4. Two windows already built that open a corner (one on each wall, each within 0.30 m of it) or sit side by side on one wall (at most 0.30 m between, nothing between): `merge_windows({ windowIds: [a, b] })` makes them one window instead of building a new pair. Name first the window whose height, sill and type you want kept. It refuses, with a code and a sentence, anything it cannot join (`windows_not_adjacent`, `opening_between`, `window_not_at_corner`, `corner_angle`, `window_already_joined`).

## Name a room the walls already enclose

When walls are drawn first, `create_room` over them names the room they make instead of adding a second zone: `zoneId` is the existing room's. If that room has a name of its own (not a number the editor gave it), the call is refused with `room_named_by_person`, worded with its name: pass `rename: true` only when the person asked for the rename; otherwise ask them. Never rename a room unasked. The editor's own room tool behaves as before; the refusal is for agents.

For new walls, omit `wallHeight` to follow the storey. A supplied height equal to
the stored storey height also ends at the covering slab's underside rather than
adding the supporting floor thickness. Other explicit heights stay body-relative
and can deliberately span storeys. `verify_scene` reports
`wall_covering_slab_contact` with both node IDs, level-local wall/slab heights,
penetration, and walking-surface coplanarity; underside seating is not a contact.
Review a tall wall against the slab's openings rather than thickening the slab.

## When a call is refused `invalid_input`

The arguments are the wrong shape or type for the tool's schema, and nothing ran. Read the refusal's `error`, fix the arguments and call again. Codes a tool raises itself (`invalid_update`, `cannot_enclose`, `room_named_by_person`) are not `invalid_input`: they name what the scene refused.

## Look at the result

`view_scene` returns a picture of the building from the viewpoint you pick, to compare with a reference before fixing. It is read-only and creates nothing. `interior: { levelId }` looks inside one floor, the other floors, its roof and its ceilings left out and everything on it, walls, openings and furniture alike, cut at 0.65 of the storey's height; the live view is not changed. On the hosted server the user's open editor tab renders it: `editor_tab_required` comes with `editorUrl` (show it, wait until the tab is open, repeat the call) `editor_tab_hidden` means the tab is in the background (ask the user to bring it forward, repeat), and `editor_tab_busy` means it is open but busy or still loading, and carries no link (wait a few seconds and repeat; if it is still busy after about a minute, tell the person; do not ask them to open anything). A server with no renderer answers `view_unavailable`. A picture is not a measure.

If an authored landscape sits below Pascal’s generated ground, use `apply_patch` to set the site’s `showGround` to `false`. This hides the site ground, including sculpted terrain, and the horizon while preserving authored children, elevations, and parcel lines; omit the field or set it to `true` to restore them. By hand: Scene → select the site → expand its Site panel → Terrain → Show ground. While the level display shows a level below grade it hides the storeys above, the landscape with them, and the site's ground stands in over the basement (opening and all); at and above grade `showGround` is yours again.

## Start over

`clear_scene` empties the project on purpose, back to a site, a building and one level, when the person asked to start over; put their words in `reason`. It is the only way to empty a project: a write that would leave it empty is refused with `scene_wipe_blocked`, nothing changes in the project or the session, and the next write builds on the project as stored.

## Read-only spatial answer

Do not mutate just to make a report unless the user authorizes a temporary or saved layout change. Use scene queries, `measure`, `check_collisions`, and `verify_scene`. Name the exact check and units. A plan-footprint check is not a detailed 3D, structural, regulatory, or delivery-path analysis.

## Outputs and limitations

- `export_json` returns the editable scene graph.
- `export_glb` in the open-source headless server currently reports `status: "not_implemented"`; protocol success is not artifact success.
- `photo_to_scene` needs host sampling. Without it, expect `sampling_unavailable`.
- `place_items` uses catalog dimensions and refuses an ID the library lacks (`asset_not_found`) rather than placing a placeholder. It places items on a level's floor, or on the host each names (`targetNodeId`): a wall (`y` is the height of the item's bottom; it hangs on the side of the wall the point is on), a ceiling, or an item standing on the floor (on an object built with `add_object`, the real surface under the point; the result names it in `restingOn`). Positions are level coordinates. A floor item standing in a door's clearance is refused with `blocks_door`, naming the door and a spot that clears every door, and one its room cannot hold in any turn with `too_large_for_room`, with both sizes: move or turn it, or pick a smaller one with `search_assets`. Items overlapping each other (a chair under its table) are not refused.
- `check_collisions` checks rotation-aware scaled item footprints using plan AABBs. Pass `minimumClearance` explicitly: zero reports overlap; a positive measurement also reports pairs closer than that gap. Inspect `status`, `checkedItems`, `skippedItems`, and `unsupportedChecks` before drawing a conclusion.
- `verify_scene` adds practical issues, including item separation and rectangular door-access keep-outs. It does not model a door-leaf swing arc or a delivery route.
- No tool starts a room scan or clones a scan into a new project. Scans are created only by the Pascal iOS app, and `open_capture_as_project` opens the scan's existing owning project.

When a requested deliverable is unsupported, return `partial` or `failed` with the tool status and the next supported action. Do not substitute an invented file, URL, or capability.

## Greenhouse and barrel roofs

Use `create_roof` with `roofSystem: "glazed"` for a gable, straight shed or barrel greenhouse roof. For a barrel roof, `depth` is the span and `barrelRise` is the arch rise, no more than half the span. `barrelSegments` controls faceting. `glazing` sets frame dimensions, glass appearance, grid layouts, glazed ends and individual glass, solid or empty panels. Standard barrel construction uses a solid covering.

Paint glazed segments with `glazing-frame`, `glazing-glass` or `glazing-solid`. Without a role, paint changes the frame and solid panels while preserving the glass finish. Painting a roof container with glazed segments applies the finish to its segments. Standard roofs use `top`, `edge` and `wall`.
