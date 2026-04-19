# R2 — `projectId` semantics + Editor public API

## TL;DR

- **`projectId` is a namespace**, not a scene identifier.
- The Editor is **scene-agnostic** — it loads/saves via `onLoad` / `onSave` callbacks.
- The editor defaults to `loadSceneFromLocalStorage()` / `saveSceneToLocalStorage()` when callbacks aren't supplied.
- One project can contain many scenes (1:N). That mapping is a **host-app concern**, not an Editor concern.

## `<Editor>` public props

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `projectId` | `string \| null` | none | Namespace key for UI-state localStorage, passed to host callbacks |
| `layoutVersion` | `'v1' \| 'v2'` | `'v1'` | Sidebar layout flavour |
| `onLoad` | `() => Promise<SceneGraph \| null>` | `loadSceneFromLocalStorage()` | Fetch initial scene on mount, and when `onLoad` identity changes (scene switch) |
| `onSave` | `(scene: SceneGraph) => Promise<void>` | `saveSceneToLocalStorage()` | Debounced (1000 ms) autosave after every scene change |
| `onDirty` | `() => void` | — | First change after last save |
| `onSaveStatusChange` | `(status: SaveStatus) => void` | — | `'idle' \| 'pending' \| 'saving' \| 'saved' \| 'paused' \| 'error'` |
| `onThumbnailCapture` | `(blob: Blob, cameraData) => void` | — | Auto-fires after 10 s idle OR manual "Generate thumbnail" |
| `previewScene` | `SceneGraph` | — | Read-only version-preview mode |
| `isVersionPreviewMode` | `boolean` | `false` | Locks scene graph |
| `isLoading` | `boolean` | `false` | Spinner overlay |
| `sidebarTabs` | `SidebarTab[]` | `[]` | v2 sidebar tabs w/ custom components |
| `appMenuButton`, `sidebarTop`, `navbarSlot`, `viewerToolbarLeft`, `viewerToolbarRight`, `sidebarOverlay`, `viewerBanner` | `ReactNode` | — | UI slots |
| `settingsPanelProps` | `{ projectId?, projectVisibility?, onVisibilityChange? }` | — | Settings-panel config |
| `sitePanelProps` | `{ projectId?, onUploadAsset?, onDeleteAsset? }` | — | Asset callbacks |
| `presetsAdapter` | `PresetsAdapter` | localStorage | Presets backend |
| `extraSidebarPanels` | `ExtraPanel[]` | `[]` | Additional v1 sidebar panels |
| `commandPaletteEmptyAction` | `CommandPaletteEmptyAction` | — | Fallback on no-match search |

## Data flow

```
host page → <Editor projectId="…"> → useEffect sync (index.tsx:757)
         ↓
   useViewer.setProjectId()  (packages/viewer/src/store/use-viewer.ts:147–157)
         ↓
   localStorage keys prefixed with `pascal-editor-selection:${projectId}`  (lib/scene.ts:32)
         ↓
   Host callbacks: onUploadAsset(projectId, levelId, file, type), onDeleteAsset(projectId, url)
```

## Scene vs project

- Scene = `{ nodes, rootNodeIds, collections? }` — the graph
- Project = namespace (which buildings/levels/zones this user can select; which assets belong)
- 1 project → N scenes (via different `onLoad` identities → scene switch)

## Host-app integration — the minimal server-backed example

```tsx
const [sceneId, setSceneId] = useState<string | null>(null)

<Editor
  projectId={projectId}
  onLoad={sceneId
    ? () => fetch(`/api/projects/${projectId}/scenes/${sceneId}`).then(r => r.json())
    : () => null}       // null → blank
  onSave={async (scene) => {
    if (!sceneId) {
      const r = await fetch(`/api/projects/${projectId}/scenes`, { method: 'POST', body: JSON.stringify(scene) })
      setSceneId((await r.json()).id)
    } else {
      await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, { method: 'PUT', body: JSON.stringify(scene) })
    }
  }}
/>
```

## Verdict

**The Editor already gives us everything we need on the client side.** The "scene save → open" workflow just needs:
1. A backend table / API keyed by `(projectId, sceneId)`.
2. A scene-picker UI in the host app (route `/scene/[id]` or a dropdown).
3. MCP writes to the same backend.

**No Editor changes required** for the baseline flow. The missing UI (scene list, naming) can be added to the Settings panel (per R3) when we want it inside the Editor package.
