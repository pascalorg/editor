# @pascal-app/mcp

Model Context Protocol server for the Pascal 3D editor. Drives the
`@pascal-app/core` scene graph from any MCP-compatible AI host.

The server runs headlessly in Bun with no browser, WebGPU, React, or external
database service. It exposes the same scene mutations used by the editor UI
(create walls, place items, cut openings, undo, etc.) as MCP tools, resources,
and prompts.

## Install

```bash
bun add @pascal-app/mcp
```

`@pascal-app/core` is a peer dependency; Bun workspaces resolve it automatically.
The MCP CLI is intended to run with Bun. When the storage package is consumed by
the Next.js editor server, it opens the same local database through Node's
built-in SQLite driver.

## Quick start

Launch the server over stdio in one line:

```bash
bunx pascal-mcp
```

Load an initial scene from disk:

```bash
pascal-mcp --stdio --scene ./my-scene.json
```

Expose it as HTTP for remote hosts:

```bash
pascal-mcp --http --port 8787
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
   `create_wall`, `place_item`, or `set_zone`.

Each mutation version-checks the saved scene before writing. If the browser or
another MCP process saved a newer version first, the MCP tool returns
`live_sync_version_conflict`; reload the scene with `load_scene` before
continuing.

## Claude Desktop config

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pascal": {
      "command": "bunx",
      "args": ["pascal-mcp"],
      "env": {
        "PASCAL_DATA_DIR": "/Users/you/.pascal/data"
      }
    }
  }
}
```

If `bunx` is not on your PATH, point `command` at the absolute path to `bun`
and pass the built `dist/bin/pascal-mcp.js` file as the first arg.

## Claude Code config

Via the CLI:

```bash
claude mcp add pascal bunx pascal-mcp
```

Or add to `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "bunx",
      "args": ["pascal-mcp"],
      "env": {
        "PASCAL_DATA_DIR": "/Users/you/.pascal/data"
      }
    }
  }
}
```

For local workspace testing before publish, build first and point Claude Code at
the built binary:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "bun",
      "args": ["/absolute/path/to/editor/packages/mcp/dist/bin/pascal-mcp.js"],
      "env": {
        "PASCAL_DATA_DIR": "/Users/you/.pascal/data"
      }
    }
  }
}
```

## Codex CLI config

Via the CLI:

```bash
codex mcp add pascal --env PASCAL_DATA_DIR="$HOME/.pascal/data" -- bunx pascal-mcp
```

For local workspace testing before publish:

```bash
bun run --cwd packages/mcp build
codex mcp add pascal-dev \
  --env PASCAL_DATA_DIR="$HOME/.pascal/data" \
  -- bun "$PWD/packages/mcp/dist/bin/pascal-mcp.js"
```

This writes an entry like this to `~/.codex/config.toml`:

```toml
[mcp_servers.pascal-dev]
command = "bun"
args = ["/absolute/path/to/editor/packages/mcp/dist/bin/pascal-mcp.js"]

[mcp_servers.pascal-dev.env]
PASCAL_DATA_DIR = "/Users/you/.pascal/data"
```

## Cursor config

In Cursor settings (`settings.json`):

```json
{
  "mcp.servers": {
    "pascal": {
      "command": "bunx",
      "args": ["pascal-mcp"],
      "env": {
        "PASCAL_DATA_DIR": "/Users/you/.pascal/data"
      }
    }
  }
}
```

## Programmatic use

Embed the server in your own Bun process using the in-memory transport. The
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

## Tools

All tools validate their inputs and outputs with Zod. Mutation tools are
captured by Zundo's temporal middleware as a single undoable step.

| Name | Purpose | Key input | Output |
| --- | --- | --- | --- |
| `get_scene` | Return the full scene graph. | — | `{ nodes, rootNodeIds, collections }` |
| `get_node` | Fetch a node by id. | `{ id }` | the node, or `InvalidParams` if not found |
| `describe_node` | Node summary with ancestry, children count and properties. | `{ id }` | `{ id, type, parentId, ancestry[], childrenCount, properties, description }` |
| `find_nodes` | Filter nodes by type / parent / zone / level. | `{ type?, parentId?, zoneId?, levelId? }` | `{ nodes: AnyNode[] }` |
| `list_levels` | List levels with ids, floor indices, parent ids and child counts. | — | `{ activeSceneId, levels[] }` |
| `get_level_summary` | Compact summary of one level with counts, wall/opening lists, zones, slabs, ceilings and items. | `{ levelId? }` | `{ levelId, counts, walls, zones, items, slabs, ceilings }` |
| `get_walls` | Walls on a level with length and child doors/windows. | `{ levelId? }` | `{ levelId, walls[] }` |
| `get_zones` | Room/zone polygons with approximate areas and bounds. | `{ levelId? }` | `{ levelId, zones[] }` |
| `measure` | Distance between two nodes; area when applicable. | `{ fromId, toId }` | `{ distanceMeters, areaSqMeters?, units: 'meters' }` |
| `search_assets` | Search the built-in MCP item catalog. | `{ query, category? }` | `{ results, total }` |
| `create_story_shell` | Create one level-owned story shell from a footprint: perimeter walls plus optional slab and ceiling. Use once per story. | `{ levelId, footprint, wallHeight?, wallThickness?, createSlab?, createCeiling? }` | `{ wallIds, slabId, ceilingId, createdIds }` |
| `create_stair_between_levels` | Create a straight stair and one rectangular manual opening in the destination slab/source ceiling, with auto-opening disabled. | `{ fromLevelId, toLevelId, position, width?, runLength?, totalRise? }` | `{ stairId, stairSegmentId, openingPolygon }` |
| `create_roof` | Create a roof container and one roof segment. By default creates a dedicated roof level above the reference occupied level for solo/exploded views. | `{ levelId, width, depth, roofType?, roofHeight?, roofLevelId?, useDedicatedRoofLevel? }` | `{ roofLevelId, createdRoofLevelId, roofId, roofSegmentId }` |
| `create_room` | Create a zone, slab, ceiling, and walls from a polygon. | `{ levelId, name, polygon, color?, wallHeight?, wallThickness? }` | `{ zoneId, slabId, ceilingId, wallIds, areaSqMeters }` |
| `add_door` | Add a door to a wall using parametric placement. | `{ wallId, t, width?, height?, hingesSide?, swingDirection? }` | `{ doorId, localX }` |
| `add_window` | Add a window to a wall using parametric placement and sill height. | `{ wallId, t, width?, height?, sillHeight? }` | `{ windowId, localX, sillHeight }` |
| `furnish_room` | Place realistic furniture for a room type inside a polygon. | `{ levelId, roomType, polygon, doorWallIndex? }` | `{ placed, itemIds, skipped }` |
| `apply_patch` | Batched create/update/delete/move, validated and dry-run before commit. | `{ patches: Patch[] }` | `{ applied: number }` |
| `create_level` | Add a new level to a building. | `{ buildingId, elevation, height, label? }` | `{ levelId }` |
| `create_wall` | Add a wall to a level. | `{ levelId, start, end, thickness?, height? }` | `{ wallId }` |
| `place_item` | Place a catalog item on a level/slab/zone, ceiling, wall, or site. Slab/zone targets resolve to the parent level so floor items render and validate. | `{ catalogItemId, targetNodeId, position, rotation? }` | `{ itemId, status }` |
| `cut_opening` | Cut a door or window opening into a wall. `position` is 0..1 along the wall and is stored as wall-local meters. | `{ wallId, type: 'door' \| 'window', position, width, height }` | `{ openingId }` |
| `set_zone` | Create a zone/room polygon on a level. | `{ levelId, polygon, label, properties? }` | `{ zoneId }` |
| `duplicate_level` | Clone a level and all of its descendants. | `{ levelId }` | `{ newLevelId, newNodeIds[] }` |
| `delete_node` | Delete a node; cascades when `cascade: true`. | `{ id, cascade? }` | `{ deletedIds: [] }` |
| `undo` | Step back through temporal history. | `{ steps? }` | `{ undone: number }` |
| `redo` | Step forward through temporal history. | `{ steps? }` | `{ redone: number }` |
| `export_json` | Serialize the scene graph as JSON. | `{ pretty? }` | `{ json: string }` |
| `export_glb` | Stubbed: GLB export requires the browser renderer. | — | throws `not_implemented` |
| `validate_scene` | Zod-validate every node and parent-child integrity. | — | `{ valid, errors: { nodeId, path, message }[] }` |
| `verify_scene` | High-level layout check with validation status, per-level counts, empty levels and practical issues. | — | `{ valid, levels[], issues, hasIssues }` |
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

## Prompts

| Name | Args | Purpose |
| --- | --- | --- |
| `from_brief` | `{ brief: string, constraints?: string }` | Guided workflow for turning a prose brief (e.g. "2-bed apartment in 80 m²") into an incremental sequence of `apply_patch` calls starting from an empty site. |
| `iterate_on_feedback` | `{ feedback: string }` | Minimal-diff instructions: examine the current scene, then propose the smallest patch set that satisfies the feedback. |
| `renovation_from_photos` | `{ currentPhotos: string[], referencePhotos: string[], goals: string }` | Chains the vision tools with the scene mutation tools to produce a renovation plan grounded in photos. |

## Limitations

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
