# R1 — Persistence layer

## TL;DR
- **Scene data:** single-key localStorage, `pascal-editor-scene`, shape `{ nodes, rootNodeIds }`. Written by the autosave hook with 1 s debounce; flushed on `beforeunload`.
- **UI preferences, viewer prefs, audio:** three separate Zustand-persist stores, each with its own localStorage key.
- **Asset binaries (textures):** IndexedDB via `idb-keyval`, keys `asset_data:<uuid>`.
- **Backend persistence:** NONE in this repo. No Supabase calls, no API routes for scenes, no database integration.
- **Scene identity / listing:** NONE. One scene per origin per browser.

## Write pathways

| When | What | Where |
|---|---|---|
| 1 s after any scene mutation | `{ nodes, rootNodeIds }` → `onSave` callback (if provided) else `localStorage['pascal-editor-scene']` | `packages/editor/src/hooks/use-auto-save.ts:104–135` |
| Every UI state mutation | `pascal-editor-ui-preferences` | Zustand persist in `use-editor.tsx:372–607` |
| Every viewer state mutation | `viewer-preferences` | Zustand persist in `use-viewer.ts:81–220` |
| Every audio state mutation | `pascal-audio-settings` | `use-audio.tsx:22–43` |
| On `beforeunload` | Final scene snapshot | `use-auto-save.ts:137–147` |

## Read pathways

1. **Editor mount** (`editor/index.tsx:765–796`):
   - If host supplied `onLoad` → `await onLoad()`
   - Else → `loadSceneFromLocalStorage()`
   - Apply via `useScene.setScene(nodes, rootNodeIds)`
2. **Selection hydration** — `syncEditorSelectionFromCurrentScene()` (`lib/scene.ts:251–332`)
3. **Zustand persist** hydrates UI/viewer/audio stores automatically on first subscriber

## What's NOT persisted
- Undo/redo history (`useScene.temporal` — in-memory only)
- Active tool state (`movingNode`, `editingHole`, `curvingWall`)
- Camera position/rotation
- Collections (stored in nodes array but not in the persist partialize)
- Three.js mesh/material cache

## Multi-scene support
- Single global key `pascal-editor-scene`. No scene id, name, thumbnail, version.
- `projectId` prop scopes UI **selection** (building/level/zone) but NOT scene data.
- No listing, no metadata, no per-project isolation of the scene itself.

## Gap to "MCP writes → user opens saved scene"
Needs:
1. Scene entity layer: id, name, projectId, created_at, thumbnail_url.
2. Backend table (or filesystem for local dev).
3. MCP tools for scene lifecycle (`save_scene`, `list_scenes`, `load_scene`, `delete_scene`).
4. Editor route `/scene/[id]` that reads scene by id on mount.
5. Host-app `onLoad(() => fetchScene(sceneId))`.

Foundation is solid — `SceneGraph` type + `applySceneGraphToEditor` are production-ready; only the entity layer is missing.
