# MCP Scene Creation Test Notes

This note summarizes the MCP connection, local editor store alignment, and scene creation issues observed during testing.

## Environment

- Repo: `C:\workSpace\pascalorg-editor-main`
- Local editor URL: `http://localhost:3002`
- Local scenes list: `http://localhost:3002/scenes`
- Local scene detail route: `http://localhost:3002/scene/<sceneId>`
- MCP server name in Codex tools: `pascal-dev`

## Important Rule

Use MCP tools only for scene operations.

Do not bypass MCP by calling local editor APIs such as:

```text
POST http://localhost:3002/api/scenes
PUT http://localhost:3002/api/scenes/<id>
```

Those API calls write to the editor's SceneStore directly and are not MCP operations.

## MCP Connection Check

The MCP connection was verified with:

- `list_mcp_resources`
- `mcp__pascal_dev__.list_templates`
- `mcp__pascal_dev__.validate_scene`

Observed MCP resources included:

- `pascal://agent-guide`
- `pascal://scene/current`
- `pascal://scene/current/summary`
- `pascal://catalog/items`

MCP template list returned:

- `empty-studio`
- `two-bedroom`
- `garden-house`

## Store / Database Issue

The main issue was that the MCP server and the local editor were initially using different SQLite database files.

MCP was writing to:

```text
C:\Users\lytec\.pascal\data\pascal.db
```

The local editor was reading:

```text
C:\Users\lytec\AppData\Roaming\Pascal\data\pascal.db
```

Because of this, scenes created through MCP did not appear at:

```text
http://localhost:3002/scenes
```

The repo storage implementation confirms this behavior:

- `packages/mcp/src/storage/index.ts` calls `SqliteSceneStore`
- `packages/mcp/src/storage/sqlite-scene-store.ts` resolves DB path in this order:
  1. `PASCAL_DB_PATH`
  2. `PASCAL_DATA_DIR/pascal.db`
  3. On Windows: `%APPDATA%/Pascal/data/pascal.db`
  4. `$XDG_DATA_HOME/pascal/data/pascal.db`
  5. `$HOME/.pascal/data/pascal.db`

The local editor loads env from the repo root `.env.local` because `apps/editor/package.json` has:

```json
"dev": "dotenv -e ../../.env.local -- next dev --port 3002"
```

To make the local editor read the MCP DB, root `.env.local` was set to:

```text
PASCAL_DB_PATH=C:/Users/lytec/.pascal/data/pascal.db
```

After restarting the editor dev server, MCP-created scenes appeared in `http://localhost:3002/scenes`.

## Route Mismatch

MCP `SceneMeta.editorUrl` currently returns:

```text
/editor/<sceneId>
```

But this local Next app exposes scenes at:

```text
/scene/<sceneId>
/scenes
```

For this local app, open MCP-created scenes with:

```text
http://localhost:3002/scene/<sceneId>
```

not `/editor/<sceneId>`.

## Previous Mistake To Avoid

A scene was once created by manually calling the local editor API instead of MCP:

```text
three-bedroom-two-living-local
```

That was not a proper MCP-created scene. It also initially had invalid runtime door data because manually constructed `door` nodes lacked fields like `segments`, causing viewer runtime errors such as:

```text
TypeError: Cannot read properties of undefined (reading 'some')
```

Do not use that approach for MCP testing.

## MCP Save / Live Sync Quirk

Several MCP write operations returned errors like:

```text
save_failed: undefined is not an object (evaluating 'this.withWriteTransaction')
live_sync_failed: undefined is not an object (evaluating 'this.withWriteTransaction')
```

However, in observed cases the scene operation often still succeeded and was persisted.

Recommended handling:

1. If a MCP write tool returns this error, immediately check:
   - `mcp__pascal_dev__.list_scenes`
   - `mcp__pascal_dev__.get_project_status`
   - `mcp__pascal_dev__.verify_scene`
2. Do not assume failure purely from the returned error.
3. Do not switch to local editor API writes as a workaround.

## Successful MCP-Only Test Scene

A simple scene was created using MCP only:

```text
Scene name: 简单单间测试场景
Scene id: 224119f508d8
Version: 2
Node count: 12
```

Open locally:

```text
http://localhost:3002/scene/224119f508d8
```

Expected contents:

- 1 level
- 4 walls
- 1 zone: `Living / Kitchen`
- 1 door
- 1 window
- 1 slab/floor
- 1 ceiling

MCP verification result after fixes:

```text
valid: true
verify_scene.hasIssues: false
```

## MCP-Only Creation Flow Used

1. Create from template:

```text
mcp__pascal_dev__.create_from_template({
  id: "empty-studio",
  name: "简单单间测试场景",
  save: true
})
```

This returned a `save_failed` error, but `list_scenes` showed that the scene was saved.

2. Verify:

```text
mcp__pascal_dev__.verify_scene()
mcp__pascal_dev__.get_level_summary()
mcp__pascal_dev__.list_scenes({ limit: 10 })
```

3. The template initially had practical issues:

```text
Level 0 has zones but no slabs/floors
Level 0 has zones but no ceilings
door extends outside wall
window extends outside wall
```

4. Fix with MCP `apply_patch`.

Important: MCP patch operation names are:

```text
create
update
delete
```

not JSON Patch names like `add`.

5. After patching, `apply_patch` also returned a `live_sync_failed` error, but the patch actually applied. Re-check with:

```text
mcp__pascal_dev__.verify_scene()
mcp__pascal_dev__.get_project_status({ id: "224119f508d8" })
```

Final status:

```text
version: 2
nodeCount: 12
hasIssues: false
```

## Recommended Test For Another AI Agent

1. Ensure root `.env.local` points editor to MCP DB:

```text
PASCAL_DB_PATH=C:/Users/lytec/.pascal/data/pascal.db
```

2. Restart local editor dev server.

3. Use MCP only:

```text
mcp__pascal_dev__.list_templates()
mcp__pascal_dev__.create_from_template({ id: "empty-studio", name: "MCP simple test", save: true })
mcp__pascal_dev__.list_scenes({ limit: 10 })
mcp__pascal_dev__.verify_scene()
```

4. Open the resulting scene locally:

```text
http://localhost:3002/scene/<sceneId>
```

5. If a MCP write returns `withWriteTransaction` related errors, verify persistence before retrying or changing approach.

