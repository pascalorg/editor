# @pascal-app/mcp

Model Context Protocol server for the Pascal 3D editor. Drives the
`@pascal-app/core` scene graph from any MCP-compatible AI host.

The server runs headlessly in Node — no browser, no WebGPU, no React — and
exposes the same scene mutations used by the editor UI (create walls, place
items, cut openings, undo, etc.) as MCP tools, resources, and prompts.

## Install

```bash
bun add @pascal-app/mcp       # or: npm i @pascal-app/mcp
```

`@pascal-app/core` is a peer dependency; Bun workspaces resolve it automatically.

## Quick start

Launch the server over stdio in one line:

```bash
bunx pascal-mcp           # or: npx pascal-mcp
```

Load an initial scene from disk:

```bash
pascal-mcp --stdio --scene ./my-scene.json
```

Expose it as HTTP for remote hosts:

```bash
pascal-mcp --http --port 8787
```

## Claude Desktop config

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pascal": {
      "command": "bunx",
      "args": ["pascal-mcp"]
    }
  }
}
```

If `bunx` isn't on your PATH, substitute `npx` or point `command` at the
absolute path of the `pascal-mcp` binary inside your project.

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
      "args": ["pascal-mcp"]
    }
  }
}
```

## Cursor config

In Cursor settings (`settings.json`):

```json
{
  "mcp.servers": {
    "pascal": {
      "command": "bunx",
      "args": ["pascal-mcp"]
    }
  }
}
```

## Programmatic use

Embed the server in your own Node process using the in-memory transport. The
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
| `measure` | Distance between two nodes; area when applicable. | `{ fromId, toId }` | `{ distanceMeters, areaSqMeters?, units: 'meters' }` |
| `apply_patch` | Batched create/update/delete/move, validated and dry-run before commit. | `{ patches: Patch[] }` | `{ applied: number }` |
| `create_level` | Add a new level to a building. | `{ buildingId, elevation, height, label? }` | `{ levelId }` |
| `create_wall` | Add a wall to a level. | `{ levelId, start, end, thickness?, height? }` | `{ wallId }` |
| `place_item` | Place a catalog item on a slab, ceiling, or wall with placement validation. | `{ catalogItemId, targetNodeId, position, rotation? }` | `{ itemId }` or `{ error: 'invalid_placement', reason }` |
| `cut_opening` | Cut a door or window opening into a wall. | `{ wallId, type: 'door' \| 'window', position, width, height }` | `{ openingId }` |
| `set_zone` | Create a zone/room polygon on a level. | `{ levelId, polygon, label, properties? }` | `{ zoneId }` |
| `duplicate_level` | Clone a level and all of its descendants. | `{ levelId }` | `{ newLevelId, newNodeIds[] }` |
| `delete_node` | Delete a node; cascades when `cascade: true`. | `{ id, cascade? }` | `{ deletedIds: [] }` |
| `undo` | Step back through temporal history. | `{ steps? }` | `{ undone: number }` |
| `redo` | Step forward through temporal history. | `{ steps? }` | `{ redone: number }` |
| `export_json` | Serialize the scene graph as JSON. | `{ pretty? }` | `{ json: string }` |
| `export_glb` | Stubbed: GLB export requires the browser renderer. | — | throws `not_implemented` |
| `validate_scene` | Zod-validate every node and parent-child integrity. | — | `{ valid, errors: { nodeId, path, message }[] }` |
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
| `pascal://catalog/items` | `application/json` | Item catalog; returns `{ status: 'catalog_unavailable', items: [] }` in headless mode if no catalog is provided. |
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
