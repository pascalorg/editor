# MCP Live Scene Change Notes

Date: 2026-05-28

## Summary

This note records the changes and checks made to make Pascal MCP edits appear live on saved scene pages such as:

`http://localhost:3002/scene/<sceneId>`

The verified test scene was:

`http://localhost:3002/scene/d74fb8371df6`

## What Changed

### 1. Codex MCP server path

Codex MCP config was updated outside this repo:

`C:\Users\lytec\.codex\config.toml`

The `pascal-dev` MCP server now points to this copied repo:

`C:\workSpace\our-editor-main\pascalorg-editor\packages\mcp\dist\bin\pascal-mcp.js`

Before this, Codex was still launching MCP from the old path:

`C:\workSpace\editor-main\packages\mcp\dist\bin\pascal-mcp.js`

### 2. Shared database path

Added repo root `.env.local`:

```text
PASCAL_DB_PATH=C:/Users/lytec/.pascal/data/pascal.db
```

This makes the local editor and MCP use the same SQLite database. Without this, MCP can save scenes into one DB while the browser reads another DB.

### 3. Fixed MCP live event method binding

Changed:

`packages/mcp/src/operations/scene-operations.ts`

The old implementation pulled optional methods off the store and called them as detached functions:

```ts
const append = this.requireStore().appendSceneEvent
return append(options)
```

That lost the store `this` binding. For `SqliteSceneStore`, this caused errors like:

```text
undefined is not an object (evaluating 'this.withWriteTransaction')
```

The fix keeps calls bound to the store instance:

```ts
const store = this.requireStore()
return store.appendSceneEvent(options)
```

The same fix was applied to `listSceneEvents`.

After the fix, `bun run build` was run in:

`packages/mcp`

The generated dist file now contains the fixed calls:

`packages/mcp/dist/operations/scene-operations.js`

### 4. Existing AI assistant bubble

The saved scene page currently includes an AI assistant bubble:

- `apps/editor/components/ai-assistant-bubble.tsx`
- `apps/editor/components/scene-loader.tsx`

The iframe URL is currently fixed:

```text
http://localhost:5900/#/thread/019e6cd5-8332-76c1-9338-6e20185faea5
```

Important: this iframe does not currently pass the active scene id to the AI page. If the AI inside the iframe needs to edit the visible scene, it still needs a binding step such as `load_scene({ id: currentSceneId })`.

## How Live Updates Work

The saved scene page `/scene/[id]` uses `SceneLoader`.

`SceneLoader` opens an EventSource connection to:

```text
/api/scenes/<sceneId>/events
```

That route polls `scene_events` every 250 ms and sends scene graph snapshots to the browser. The browser then applies them with:

```ts
applySceneGraphToEditor(payload.graph)
```

MCP mutations must first bind the current scene:

```ts
load_scene({ id: "<sceneId>" })
```

Then MCP write tools such as `apply_patch`, `place_item`, `cut_opening`, and room/wall operations persist the new graph and append a live scene event.

## Verified Behavior

After restarting Codex/MCP with the rebuilt server:

1. `mcp__pascal_dev__.list_templates()` succeeded.
2. MCP process path was verified as:

   `C:\workSpace\our-editor-main\pascalorg-editor\packages\mcp\dist\bin\pascal-mcp.js`

3. Loaded scene:

   `d74fb8371df6`

4. Applied a live patch:

   `Small Meeting Room` was renamed to `Small Meeting Room - LIVE NOW` and recolored green.

5. `apply_patch` returned success without `withWriteTransaction` errors.
6. Browser showed the update live.
7. Later changes also worked live:
   - Opened the open office area by removing two internal wall directions.
   - Added two table/chair workstation groups.

Final scene check:

- Scene id: `d74fb8371df6`
- Version after workstation change: `9`
- `verify_scene`: `hasIssues: false`
- Level content: 24 walls, 6 zones, 9 doors, 4 items, 6 slabs, 6 ceilings

## Important Conditions

- Open the saved scene page:

  `http://localhost:3002/scene/<sceneId>`

- Do not use the home page `/` local editor when testing MCP live updates.
- Editor and MCP must use the same `PASCAL_DB_PATH` or `PASCAL_DATA_DIR`.
- MCP must call `load_scene` for the scene currently open in the browser before mutating.
- If the browser and MCP save at the same time, `live_sync_version_conflict` can happen. Reload with `load_scene` and continue from the latest version.
- Do not bypass MCP by calling local editor APIs for scene writes when testing MCP behavior.

## Notes From The Workstation Change

The built-in catalog did not have a dedicated `desk` asset. The current workstation test used:

- `dining-table` as an office desk
- `dining-chair` as an office chair

If proper office furniture is needed, add or expose desk/chair catalog items before generating polished office layouts.

## Files To Watch

- `packages/mcp/src/operations/scene-operations.ts`
- `packages/mcp/src/tools/live-sync.ts`
- `apps/editor/components/scene-loader.tsx`
- `apps/editor/app/api/scenes/[id]/events/route.ts`
- `apps/editor/components/ai-assistant-bubble.tsx`
- `.env.local`

