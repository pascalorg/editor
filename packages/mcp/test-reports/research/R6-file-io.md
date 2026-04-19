# R6 — File I/O pathways

## TL;DR
- Export: 2 JSON pathways + 3 binary (GLB/STL/OBJ) pathways.
- Import: 1 JSON pathway ("Load Build"), **no Zod validation** at boundary.
- No drag-drop, no clipboard-paste JSON import.
- Round-trip export → re-import works; MCP-written JSON loads cleanly IF structure matches.

## Exports

| Trigger | Handler | File | Output |
|---|---|---|---|
| Settings → "Save Build" | `handleSaveBuild` | `settings-panel/index.tsx:205–216` | `layout_YYYY-MM-DD.json` |
| Cmd palette → "Export Scene (JSON)" | `editor.export.json` | `command-palette/editor-commands.tsx:329–346` | `scene_YYYY-MM-DD.json` |
| Settings/palette → "Export GLB/STL/OBJ" | `export-manager.tsx` | `editor/export-manager.tsx:71–78` | binary 3D geometry |

Both JSON paths serialise `{ nodes: useScene.getState().nodes, rootNodeIds: useScene.getState().rootNodeIds }`. No metadata (no name, no created_at, no projectId).

## Import

### "Load Build"
- `settings-panel/index.tsx:218–239`
- Accept: `application/json`
- Handler: `JSON.parse` → check `data.nodes && data.rootNodeIds` → call `useScene.setScene(nodes, rootNodeIds)`
- **No Zod validation.** Confirmed the security-audit flag from Phase 3.

### `setScene` behaviour (`core/store/use-scene.ts:242–271`)
1. `migrateNodes()` — runs a few backward-compat patches. Stair nodes are zod-safeParsed and SILENTLY DROPPED on failure; other types are unvalidated.
2. Orphan pruning — deletes any node whose `parentId` isn't present in the dict.
3. `setState` with cleaned nodes + `dirtyNodes: new Set()`.
4. Marks every node dirty to trigger re-render.

**Critical gap:** Invalid `type` strings silently load. Systems will later fail to find a renderer for them and the node will be invisible but consume state.

## Round-trip fidelity

| Scenario | Loads clean? |
|---|---|
| Export → re-import | ✅ |
| MCP writes well-formed `{ nodes, rootNodeIds }` | ✅ (confirmed: Casa del Sol scene.json loads into the editor) |
| MCP writes bad `node.type` | ⚠️ Silent load, invisible node |
| MCP writes broken parentId chain | ⚠️ Orphans silently deleted |
| MCP writes missing `children: []` on container | ⚠️ Core treats as `undefined` → system ignores |

## Missing / nice-to-have

- Drag-drop JSON onto viewport
- URL-param load: `?load=<publicJsonUrl>`
- Clipboard paste of JSON blob
- `importFromFile` with Zod validation at the boundary
- File-format version field (`formatVersion: "1"`) for forward-compat

## Recommendation

Every "save to cloud" implementation MUST Zod-validate at the boundary with `AnyNode.safeParse` per node + structural checks on `rootNodeIds`. The tool in MCP (`validate_scene`) already does this — run it before any save.
