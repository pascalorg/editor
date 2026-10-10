# @pascal-app/mcp

Model Context Protocol server for the Pascal 3D editor. Drives the
`@pascal-app/core` scene graph from any MCP-compatible AI host.

For the hosted Pascal MCP endpoint and copy-ready setup for Claude Code, Codex,
Cursor, and OpenClaw, read [Connect an AI agent](https://editor.pascal.app/docs/developers/mcp).
The hosted endpoint edits projects in a Pascal account; this package is the
open-source, local server for custom hosts and local scene storage.

The server runs headlessly in Node.js 22.13 or newer or Bun, with no browser,
WebGPU, React, or external database service. It exposes the same scene mutations used
by the editor UI (create walls, place items, cut openings, undo, etc.) as MCP tools,
resources, and prompts.

## Recommended local setup

For a local editor and MCP that share projects automatically, install the Pascal CLI:

```bash
npx @pascal-app/cli editor
pascal mcp setup codex
```

`pascal editor` starts the editor and an authenticated MCP service together.
`pascal mcp connect` is a stable stdio connector that discovers the dynamic loopback
port, so MCP client configuration contains neither a changing port nor a secret.

Use this package directly when embedding the MCP server, supplying a custom store, or
running MCP without the Pascal editor.

## Install the package directly

```bash
bun add @pascal-app/mcp
```

`@pascal-app/core` is a peer dependency. The local store uses Bun SQLite under Bun and
Node's built-in SQLite driver under Node.js.

## Quick start

Launch the server over stdio in one line:

```bash
bunx @pascal-app/mcp
# or
npm exec --package=@pascal-app/mcp -- pascal-mcp
```

Load an initial scene from disk:

```bash
bunx @pascal-app/mcp --stdio --scene ./my-scene.json
```

Expose it over loopback HTTP:

```bash
bunx @pascal-app/mcp --http --port 8787
```

Binding a non-loopback host requires a bearer token:

```bash
PASCAL_MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
  bunx @pascal-app/mcp --http --host 0.0.0.0 --port 8787 --cors-origin https://editor.example
```

## Local scene storage

Scenes saved through MCP are stored in a local SQLite database:

```text
~/.pascal/data/pascal.db
```

Set `PASCAL_DATA_DIR` when you want the MCP server and the running editor to
share a different directory, or `PASCAL_DB_PATH` when you need an exact database
file path. The store uses WAL mode and transactional version checks so separate
local processes can save and open the same scene database.

During workspace development, run both sides with the same data directory:

```bash
# Terminal 1: run the editor
PASCAL_DATA_DIR="$HOME/.pascal/data" bun run dev

# Terminal 2 or an MCP host: run the server
PASCAL_DATA_DIR="$HOME/.pascal/data" bun packages/mcp/dist/bin/pascal-mcp.js
```

### Local geometry artifacts

Scripted objects keep their GLB and source in `<database-path>.artifacts/<sha256>` beside the
local SQLite scene database, where saved scenes live (also with `--scene`, which only seeds the
first scene); keep that directory with the database. Files are verified against their hash and
written once, so saved scenes and undo history keep their original geometry. The standalone
editor reads and writes the same database-side store.

Local MCP compilation is opt-in with `PASCAL_SERVER_SCRIPT_COMPILE=1`. It runs in a separate
process without inherited environment variables, with a deadline; this is not a sandbox for
untrusted code. `get_source` can read saved scripts without enabling compilation.

## Live editor updates

When the editor and MCP server share the same `PASCAL_DATA_DIR`, MCP mutations
against a loaded saved scene are persisted to SQLite and recorded in a local
`scene_events` stream. The editor page subscribes to that stream at
`/api/scenes/:id/events` with server-sent events, so an open browser tab can
apply scene graph snapshots as the agent edits the scene.

The flow is intentionally local and lightweight:

1. Open or create a scene in the editor so it is saved in the local database.
2. Load that scene through MCP with `load_scene`.
3. Run MCP mutation tools such as `create_room`, `add_door`, `furnish_room`,
   `add_wall`, `place_items`, or `set_zone`.

Each mutation version-checks the saved scene before writing. If the browser or
another MCP process saved a newer version first, the MCP tool returns
`live_sync_version_conflict`; reload the scene with `load_scene` before
continuing.

## Managed CLI client configuration

The recommended JSON configuration for Claude Desktop, Cursor, and compatible clients
is:

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pascal": {
      "command": "pascal",
      "args": ["mcp", "connect"]
    }
  }
}
```

### Claude Code

Via the CLI:

```bash
pascal mcp setup claude
```

Or add to `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "pascal",
      "args": ["mcp", "connect"]
    }
  }
}
```

For package-development testing without the managed CLI, build first and point Claude
Code at the built binary:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "node",
      "args": ["/absolute/path/to/editor/packages/mcp/dist/bin/pascal-mcp.js"],
      "env": {
        "PASCAL_DATA_DIR": "/Users/you/.pascal/data"
      }
    }
  }
}
```

### Codex CLI

Via the CLI:

```bash
pascal mcp setup codex
```

For local workspace testing before publish:

```bash
bun run --cwd packages/mcp build
codex mcp add pascal-dev \
  --env PASCAL_DATA_DIR="$HOME/.pascal/data" \
  -- node "$PWD/packages/mcp/dist/bin/pascal-mcp.js"
```

This writes an entry like this to `~/.codex/config.toml`:

```toml
[mcp_servers.pascal-dev]
command = "node"
args = ["/absolute/path/to/editor/packages/mcp/dist/bin/pascal-mcp.js"]

[mcp_servers.pascal-dev.env]
PASCAL_DATA_DIR = "/Users/you/.pascal/data"
```

### Cursor config

In Cursor settings (`settings.json`):

```json
{
  "mcp.servers": {
    "pascal": {
      "command": "pascal",
      "args": ["mcp", "connect"]
    }
  }
}
```

## Programmatic use

Embed the server in your own Node.js or Bun process using the in-memory transport. The
example below runs a full client/server pair inside a single script — useful
for agent frameworks and tests.

```ts
import { createPascalMcpServer, SceneBridge } from '@pascal-app/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const bridge = new SceneBridge()
bridge.loadDefault()
const server = createPascalMcpServer({ bridge })

const [srvT, cliT] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'my-agent', version: '0.1.0' })
await Promise.all([server.connect(srvT), client.connect(cliT)])

const tools = await client.listTools()
console.log('available tools:', tools.tools.map((t) => t.name))

const scene = await client.callTool({ name: 'get_scene', arguments: {} })
console.log(scene)
```

See [`examples/embed-in-agent.ts`](./examples/embed-in-agent.ts) for a
compilable version.

## Coordinate conventions

Pascal is a **right-handed** scene where **X and Z form the ground plane and Y
is up**. Lengths are in **metres**; rotations are **radians**, stored as Euler
`[x, y, z]` tuples.

**Plan → world.** Every 2-D point you pass is a level/building-local
ground-plane coordinate
`[x, z]` — this includes `wall.start` / `wall.end` and the `polygon` / `holes`
arrays of `slab`, `zone`, and `ceiling`. With the default identity building
transform, it appears in world space as:

```
[x, z]  →  (x, y, z)      // the 2nd component is world Z (depth), not "up"
```

There is no sign flip in the stored convention: tooling consumes the second
component as world Z directly. The vertical `y` starts from the owning level's
stacked height as computed by the level system from accumulated level heights,
plus the element's own height; slabs additionally carry an absolute
`elevation`.

**Heads-up when you compute coordinates outside the editor.** Pascal's
viewports apply their own rotations on top of the world axes: the 2-D plan
panel rotates its content by the user's view rotation (north-aligned = 0°,
`FLOORPLAN_VIEW_ROTATION_DEG` baseline, north = world −Z), and
the 3-D "top-down" snap preserves the camera's current azimuth, so when invoked
from the iso default position, world and screen axes are offset by ~45° until
you orbit to an axis-aligned view. So a layout authored as if
*"Y = north, viewed top-down"* — common in land surveys, north-up site plans,
and 2-D plotting libraries — will arrive **rotated** relative to its source
when viewed in Pascal (and possibly further reflected, depending on which
viewport and camera state you're in). The editor's own 2-D and 3-D tools are
internally consistent with their stored coordinates, so this only affects
geometry authored programmatically. To verify orientation before trusting
externally-computed coordinates, place a scaled guide image at known anchor
points and check alignment; apply whatever rotation (or reflection) your
authoring side needs to match.

A worked demonstration of all of this — axis-aligned baseline, the rotated
30° example below, and a paired "page-intent vs world-result" L for the
external-coordinate gotcha — lives in
[`examples/coordinate-conventions-demo.md`](./examples/coordinate-conventions-demo.md)
and [`examples/coordinate-conventions-demo.json`](./examples/coordinate-conventions-demo.json).
Load the JSON with
`bunx @pascal-app/mcp --stdio --scene examples/coordinate-conventions-demo.json`.

**Example — a 6 × 4 m slab rotated 30° about its first corner** (coordinates
rounded to 3 dp; sides ≈ 6 m / 4 m; not axis-aligned, so the mapping is
actually exercised):

```json
{
  "op": "create",
  "parentId": "<levelId>",
  "node": {
    "type": "slab",
    "elevation": 0.0,
    "polygon": [[0, 0], [5.196, 3.0], [3.196, 6.464], [-2.0, 3.464]]
  }
}
```

This lands flat on the ground (Y = 0), about 6 m along a heading 30° off the +X
axis and 4 m along its perpendicular — i.e. occupying world (x, z) directly.

One separate gotcha: wall-attached coordinates are wall-local, not plan
coordinates. Stored door/window `position[0]` is metres along the wall, and
wall-attached rotations are wall-local too.

## Tools

All tools validate their inputs and outputs with Zod. Mutation tools are
captured by Zundo's temporal middleware as a single undoable step.

Arguments a tool's input schema rejects come back as a tool error whose JSON
text is `{ error, code: "invalid_input" }`, as every other refusal names its
code: the arguments are the wrong shape or type, so read `error`, fix them and
call again. It is the schema's refusal, before the tool ran; the codes a tool
raises itself (`apply_patch`'s `invalid_update` and `invalid_parent`, a room's
`cannot_enclose`) come back as `{ error, code, ...details }`, and `apply_patch`
adds `patchIndex` and `id`. A level an agent writes without a `height` (a
`create` in `apply_patch`, or an update that clears it) is given the height the
editor's own load would derive from what the level holds: the top of its
tallest wall or ceiling, and for an empty level the default storey height, 2.5 m.
`apply_patch` says so in `notes`, one line per level filled. `add_level` takes
an optional `height` and uses the same default.

| Name | Purpose | Key input | Output |
| --- | --- | --- | --- |
| `get_scene` | Return the full scene graph. | — | `{ nodes, rootNodeIds, collections }` |
| `get_node` | Fetch a node by id, whole. | `{ id }` | `{ node }`, or refusal `node_not_found` |
| `describe_node` | Node summary with ancestry, children count and properties. | `{ id }` | `{ id, type, parentId, ancestry[], childrenCount, properties, description }` |
| `find_nodes` | Filter nodes by type (any node kind) / parent / zone / level, or by import source id (`provenance.refs[].id` or legacy `metadata.sourceIds`, exact or prefix). | `{ type?, parentId?, zoneId?, levelId?, sourceId?, sourceIdPrefix? }` | `{ nodes: AnyNode[] }` |
| `list_levels` | List every building's levels in floor order with their role (storey, roof-only, support). | — | `{ activeSceneId, activeLevelId, levelCount, occupiedStoryCount, supportLevelCount, roofLevelIds, levels[] }` |
| `get_level_summary` | Compact summary of one level: role, counts, walls with openings, zones with areas, slabs, ceilings, items, stairs, roofs, and everything else by type. Omit `levelId` for the lowest storey. | `{ levelId?, level? }` | `{ levelId, role, counts, walls, zones, slabs, ceilings, items, stairs, roofs, other }` |
| `get_walls` | Walls on a level with length, stored and resolved height, and child doors/windows. | `{ levelId?, level? }` | `{ levelId, walls[] }` |
| `get_zones` | Room/zone polygons with holes, areas (holes taken out), bounds and floor choices. | `{ levelId?, level? }` | `{ levelId, zones[] }` |
| `measure` | Distance between two nodes' world-space reference points (hosted doors, windows and items resolved through their host; every node kind); area when applicable. | `{ fromId, toId }` | `{ distanceMeters, fromPoint?, toPoint?, areaSqMeters?, units: 'meters' }` |
| `view_scene` | Look at the building from a viewpoint the agent picks (a side, a street-height eye, a photo's camera, square-on, from above) and get the picture back, with the photo's crop beside it when a region is given. The server has no renderer: the host's `sceneViews` renders it (the hosted app, through the user's open editor tab). Read-only. | `{ target?, from?, elevation?, eyeHeight?, position?, fov?, projection?, camera?, photo? }` | image content plus `{ status, camera, size, tab, capturedAt }`; refusals `view_unavailable`, `no_project`, `photo_crop_unavailable`; on the hosted server `editor_tab_required`, `editor_tab_hidden`, `editor_tab_busy` (a tab open but busy or still loading, no link: wait a few seconds and call again, do not ask the user), `editor_tab_timeout` (a tab claimed the view and then stopped answering); what the refusal says about opening the editor follows the person's "Agents may open the editor for me" setting (ask first, allow, never) |
| `search_assets` | Search the host's item library (the built-in list on a standalone server), several queries in one call; a query matches name, id, category or tags. A query that finds nothing gets a hint to build the item with `add_object`. | `{ queries: [{ query, category? }] }` | `{ groups: [{ query, total, results[] }], total, hint? }`; refusal `no_catalog` |
| `create_story_shell` | Create one level-owned story shell from a footprint: the perimeter walls. The floor plate and ceiling are derived from the enclosed rooms; `createSlab` / `createCeiling` / `slabElevation` are recorded as room intent. Use once per story. | `{ levelId, footprint, wallHeight?, wallThickness?, createSlab?, createCeiling? }` | `{ wallIds, zoneIds, slabId, ceilingId, createdIds }` |
| `create_stair` | Create a straight stair as the editor's stair tool does: from a level to the next one above (made when there is none), owning the floor openings it cuts. `(x, z)` is the back-centre of the bottom step, `rotation` in degrees (0 climbs toward +Z). | `{ x, z, levelId?, toLevelId?, rotation?, width?, length?, height?, steps? }` | `{ stairId, segmentId, upperLevelId, createdUpperLevel, stepCount, slabHoleCut, openingIds? }`; refusals `roof_level`, `not_above`, `level_not_found`, `slab_not_found` / `ceiling_not_found`, `slab_not_on_level` / `ceiling_not_on_level` |
| `measure_stair` | Read actual risers, going at the walking line, slope, uniformity, arrival, headroom against floors/ceilings/stair bodies, and design-target diagnostics. | `{ stairId, available?: { width, length } }` | `{ measurements, layouts }` |
| `fit_stair` | Fit uniform risers or replace the chain with a straight/L/U preset with width-sized landings or quarter-turn winders in one undoable edit. | `{ stairId, fitRun?, targets?, layout?, turn?, width?, landingDepth?, turningStrategy?, innerGap?, walkingLineOffset?, division? }` | `{ stairId, measurements }` |
| `create_roof` | Create a roof container and one roof segment. By default creates a dedicated roof level above the reference occupied level for solo/exploded views. | `{ levelId, width, depth, roofType?, roofHeight?, roofLevelId?, useDedicatedRoofLevel? }` | `{ roofLevelId, createdRoofLevelId, roofId, roofSegmentId }` |
| `create_room` | Create a room from a polygon: one wall per edge (an edge a wall already runs along reuses it) and the room zone; its doors and windows can be declared in the same call by edge (`wallIndex`) and `t`, each placed with `add_door`'s and `add_window`'s rules or listed in `skippedOpenings`. The floor plate and ceiling are derived, never authored. `outdoor: true` makes a terrace: separators (the editor's Separator: a room boundary with no wall) where no wall runs, no walls of its own, no ceiling. Where every edge of the polygon already runs along a wall (nothing to build) and the polygon fits the room those walls make, the call names that room instead of stacking a second zone on it, and `zoneId` is that room's. If that room has a name of its own (not a number the editor gave it: any name but the editor's "Room N", whoever gave it) the call is refused (`room_named_by_person`, worded with the room's name): pass `rename: true` **only when the person asked for the rename; otherwise ask them**. A room is never renamed unasked, and the same name over it says there is nothing to create. A terrace (`outdoor: true`) drawn over a fully walled courtyard names it outdoor. The refusal is agent-only: the editor's own room tool behaves as before (a person sees and names rooms directly). | `{ name, polygon, levelId?, color?, wallHeight?, wallThickness?, outdoor?, rename?, doors?, windows? }` | `{ zoneId, slabId, ceilingId, wallIds, reusedWalls, areaSqMeters, doorIds, windowIds, skippedOpenings? }`; refusals `cannot_enclose`, `outdoor_room_overlap`, `room_named_by_person` |
| `add_door` | Add a door to a straight wall at `t` (0..1 along it) with the editor's placement rules, or a passage with no leaf (`openingKind: "opening"`); it slides to stay on the wall and reports `clamped`. `doorType`, `style` and the outline (`openingShape`) match a reference, `code` builds what they cannot, and `nodeId` rebuilds a scripted door. | `{ wallId, t?, width?, height?, openingKind?, hingesSide?, swingDirection?, doorType?, style?, openingShape?, code?, nodeId?, force? }` | `{ doorId, wallId, localX, t, clamped, achieved }`; refusals `wall_not_found`, `not_a_wall`, `curved_wall`, `wall_too_short`, `opening_overlap` (unless `force`) |
| `add_window` | Add a window as `add_door` places a door, centred vertically on the wall unless `sillHeight` (its bottom edge above the floor) is given; `windowType`, `columns` / `rows`, `style` (a Fixed window's panes; refused on another type, `style_needs_fixed_window`) and the outline match a reference. | `{ wallId, t?, width?, height?, sillHeight?, windowType?, columns?, rows?, style?, openingShape?, code?, nodeId?, force? }` | `{ windowId, wallId, localX, t, clamped, sillHeight, achieved }`; the same refusals as `add_door` |
| `furnish_room` | Furnish a room for its type from the host's item catalog: the main piece against the wall facing the door, the rest along a side wall. Nothing lands in a door's clear zone or on another item: a piece that does not fit is nudged, else skipped, and `skipped` says why. | `{ zoneId?, polygon?, levelId?, roomType, doorWallIndex? }` | `{ placed, itemIds, skipped, doorWallIndex, doorsDetected }`; refusals `room_required`, `roof_level`, `level_not_found`, `no_catalog` |
| `add_corner_window` | A window wrapping the corner where two walls meet: one window per wall, both running to the corner and joined, the glass fused or at a thin post, at any angle from 10° to 170° (a square corner, a bay's 135°, an acute one). `corner` is the point the walls end at, `[x, z]` in the level's plan as `get_walls` gives their ends; `width` is how far the glass runs along each wall from the corner (default 1.2 m) and `widths` overrides it per wall id; `post` is `'none'` (the glass fused, the default) or `'post'`; `height` defaults to 1.5 m and the window is centred on the wall unless `sillHeight` (its bottom edge above the floor) is given; `wallIds` (two) is needed only when more than two walls end at the corner; `windowType` and `style` are `add_window`'s (a style needs a Fixed window). By hand: select a window that ends at a corner and use the window panel's Corner section (Wrap the corner, This side and Other side, None or Post, Unwrap). | `{ corner: [x, z], levelId?, wallIds?, width?, widths?, height?, sillHeight?, post?, windowType?, style? }` | `{ windowIds, wallIds, angle, post, achieved }`; refusals `no_corner` (no two walls end there), `corner_ambiguous` (more than two do: pass `wallIds`), `corner_angle` (under 10° or over 170°: use `add_window`), `width_exceeds_wall`, `style_needs_fixed_window` |
| `merge_windows` | Make two windows that exist one window, as the editor's Merge windows button does; nothing is recreated. On two walls that meet at a corner, each window within 0.30 m of it, they become one corner window (the `add_corner_window` result): each is slid to the corner keeping its width, the glass fused, and both take the first window's height, sill and type, so name first the window whose look you want; the corner is refused over 170° or under 10°. On one wall, two windows with at most 0.30 m between them and nothing between become one window spanning both outer edges, from the lower sill to the higher head, with the first window's type and style. Use it for two windows already built that open a corner or one wide opening (`verify_scene`'s `corner_unjoined` names a pair for the first); `add_corner_window` builds a new pair. By hand: select two windows and use Merge windows in the multi-selection panel, or place or drag a window near a corner where one waits and click or release (Alt places it plain). | `{ windowIds: [a, b] }` | `{ kind: 'corner' \| 'same_wall', windowIds, removedIds }`; refusals `window_not_found`, `not_a_window`, `same_window`, `window_not_on_wall`, `window_already_joined` (unwrap it first), `windows_already_joined`, `windows_not_adjacent`, `opening_between`, `walls_not_meeting`, `corner_angle`, `window_not_at_corner`, `height_exceeds_wall`, `opening_overlap` |
| `apply_patch` | Batched create/update/delete/move, validated and dry-run before commit. Batch-first is the default: send all create/update/delete ops for a build step in one atomic call (stable order, later ops may reference earlier created ids); do not loop one-op calls. A create with an id already in the scene is refused (`node_exists`); delete it earlier in the same patch to replace it. Updates cannot change `id` or `type` (`identity_change`), `object` or `children` (`immutable_field`), move a node under a missing or childless parent (`invalid_parent`), or add schema issues (`invalid_update`); default gutters and downspouts a delete regenerates are addressable only in a later call (`regenerated_default`). Refusals are tool errors with JSON text `{ code, patchIndex, id, message }`. | `{ patches: Patch[] }` | `{ applied: number, notes?: string[] }` |
| `add_level` | Add an empty level to a building, as the editor does: above the highest, or below the lowest for a basement. Omit `buildingId` for the scene's only building. | `{ buildingId?, position?, name?, height? }` | `{ levelId, buildingId, floorIndex, height }`; refusals `building_required`, `building_not_found`, `no_building` |
| `add_wall` | Add a wall to a level, straight or, with `curveOffset`, an arc. Omit `levelId` for the lowest storey. | `{ start, end, levelId?, thickness?, height?, curveOffset? }` | `{ wallId, levelId, length }`; refusals `roof_level`, `wall_too_short`, `level_not_found` |
| `place_items` | Place catalog items in one call, each placed or refused on its own, at level `(x, z)`: on the level's floor, or on the host each names (`targetNodeId`): a wall (`y`, the height of its bottom, required), a ceiling, or an item standing on the floor. A floor item in a door's clearance is refused `blocks_door` (naming the door and a spot that clears every door), one its room cannot hold in any turn `too_large_for_room`. | `{ items: [{ assetId, x, z, y?, targetNodeId?, rotation? }], levelId? }` | `{ levelId, items: [{ ok, itemId?, hostId?, restingOn?, code? }] }`; per-item refusals `asset_not_found`, `outside_rooms`, `blocks_door`, `too_large_for_room`, `height_required`, `item_too_tall`, `unsupported_host`, `host_not_found`, `host_not_on_level` |
| `place_design` | Create one design (procedural item recipe, object or JSON string) that passes `validate_design`. Its mounting picks the host: level/slab/zone or a design surface (`surfaceId`), a straight wall face, or a ceiling. Create-only, one undo step, inline designs up to 24 KiB, with coded refusals. | `{ design, hostId, position, rotation?, side?, surfaceId?, parameters?, slots?, name?, id? }` | `{ designId, parentId, surfaceId }` |
| `set_zone` | Create a zone/room polygon on a level. | `{ levelId, polygon, label, properties? }` | `{ zoneId }` |
| `duplicate_level` | Copy a level as the editor does (units whose rooms are all on it included; plan references, scans and spawns left behind), above or below, shifting the floors past it. | `{ levelId, position?, name?, preset? }` | `{ newLevelId, name, floorIndex, shiftedLevelIds, copied, skipped, newNodeIds[] }` |
| `delete_node` | Delete a node with everything under it, as the editor's Delete does. | `{ id }` | `{ deletedIds: [] }` |
| `clear_scene` | Empty the project on purpose, back to the default site, building and level. The only way to empty a project: a write that would leave it empty is refused (`scene_wipe_blocked`) by a store that guards against accidental wipes, and the session keeps the project as stored. | `{ reason }` | `{ cleared: { removed }, version, graphHash }` |
| `undo` | Step back through temporal history. | `{ steps? }` | `{ undone: number }` |
| `redo` | Step forward through temporal history. | `{ steps? }` | `{ redone: number }` |
| `export_json` | Serialize the scene graph as JSON. | `{ pretty? }` | `{ json: string }` |
| `export_glb` | Stubbed: GLB export requires the browser renderer. | — | throws `not_implemented` |
| `validate_scene` | Zod-validate every node and parent-child integrity. | — | `{ valid, errors: { nodeId, path, message }[] }` |
| `validate_design` | Read-only: validate a design (procedural item recipe, object or JSON string) and measure it. The authority over `pascal://schema/design`. | `{ design, parameters? }` | `{ valid, diagnostics[], design, sweep, measurements }` |
| `verify_scene` | High-level check with validation status, per-level counts and roles, empty levels, and typed practical issues (storeys with no stair, openings off their wall, stairs off their slab, blocked doors…). | — | `{ valid, levels[], issues: { type, message }[], hasIssues }` |
| `check_collisions` | Find overlapping items and out-of-bounds placements. | `{ levelId? }` | `{ collisions: { aId, bId, kind }[] }` |
| `analyze_floorplan_image` | Vision tool: extract walls, rooms, and approximate dimensions from a floorplan image. | `{ image, scaleHint? }` | `{ walls, rooms, approximateDimensions, confidence }` |
| `analyze_room_photo` | Vision tool: extract approximate dimensions and fixtures from a room photo. | `{ image }` | `{ approximateDimensions, identifiedFixtures, identifiedWindows }` |

The vision tools require the MCP host to support the sampling capability
(`createMessage`). Hosts that don't will see a structured
`sampling_unavailable` error.

## Resources

| URI | MIME | Purpose |
| --- | --- | --- |
| `pascal://scene/current` | `application/json` | Full `{ nodes, rootNodeIds, collections }` snapshot. |
| `pascal://scene/current/summary` | `text/markdown` | Human-readable summary with node counts, bounding box, and level areas. |
| `pascal://agent/guide` | `text/markdown` | MCP-first construction workflow, scene invariants, and tool preferences for agents. |
| `pascal://catalog/items` | `application/json` | Dependency-free built-in catalog subset for common residential furniture and fixtures. |
| `pascal://constraints/{levelId}` | `application/json` | Slab footprints and wall polygons for the given level — useful as planner context. |
| `pascal://schema/design` | `application/json` | Design contract: JSON Schema generated from core's `RecipeSchema`, limits, rules only `validate_design` checks, and an example. |

## Prompts

| Name | Args | Purpose |
| --- | --- | --- |
| `from_brief` | `{ brief: string, constraints?: string }` | Guided workflow for turning a prose brief (e.g. "2-bed apartment in 80 m²") into an incremental sequence of `apply_patch` calls starting from an empty site. |
| `iterate_on_feedback` | `{ feedback: string }` | Minimal-diff instructions: examine the current scene, then propose the smallest patch set that satisfies the feedback. |
| `renovation_from_photos` | `{ currentPhotos: string[], referencePhotos: string[], goals: string }` | Chains the vision tools with the scene mutation tools to produce a renovation plan grounded in photos. |

## Limitations

- `view_scene` accepts optional `interior: { levelId }` for one explicit floor's
  capture-only cutaway. Other floors and its roof/ceiling are excluded, with
  furniture and wall finishes inside; the live view stays unchanged. Pending,
  failed or stale scene assets refuse the picture. It uses the same host renderer
  and image output, not a new headless renderer or mandatory review workflow.
- `export_glb` returns `not_implemented`. GLB export depends on the Three.js
  renderer and isn't reachable headlessly without a large additional effort.
- Vision tools require MCP host sampling support. Claude Desktop supports
  this; some MCP clients don't.
- The built-in MCP catalog is intentionally small. Host applications can expose
  their own richer catalog through additional tools/resources without requiring
  the MCP package to depend on the editor UI bundle.
- Systems (wall mitering, slab triangulation, CSG cutouts, roof / stair
  generation) run inside React hooks in the editor. Headless mode doesn't
  regenerate derived geometry — but all node data remains fully manipulable.
  Consumers that need rendered geometry run `@pascal-app/viewer` in a browser
  host.
- Core's `loadAssetUrl` / `saveAsset` are browser-only; items that reference
  `asset://<id>` URLs aren't resolvable in Node. Supply absolute URLs or
  `data:` URLs for item assets if you need them usable outside the browser.
- `dirtyNodes` accumulates in headless mode because no renderer consumes it.
  Call `bridge.flushDirty()` if observability matters to your consumer.

## Development

```bash
bun install
bun run --cwd packages/mcp build
bun test
```

Smoke-test the stdio binary end-to-end:

```bash
bun run --cwd packages/mcp smoke
```

## License

MIT
