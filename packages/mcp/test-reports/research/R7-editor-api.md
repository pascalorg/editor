# R7 — `@pascal-app/editor` public API

## Exports (packages/editor/src/index.tsx)
**Components:** `Editor` (default), `SettingsPanel`, `SitePanel`, `FloatingLevelSelector`, `SceneLoader`, `ViewerToolbarLeft`, `ViewerToolbarRight`, `Slider`, `SliderControl`
**Hooks/Stores:** `useEditor`, `useCommandRegistry`, `useSidebarStore`, `useUploadStore`, `useAudio`, `usePaletteViewRegistry`, `useCommandPalette`
**Utilities:** `applySceneGraphToEditor`, `SceneGraph` (type), `CATALOG_ITEMS`, `PresetsProvider`, `PresetsAdapter` (type)

## `<Editor>` host integration points

| Prop | Signature | Trigger | Host opportunity |
|---|---|---|---|
| `onLoad` | `() => Promise<SceneGraph \| null>` | Mount + `onLoad` identity change | Fetch scene by id from backend |
| `onSave` | `(scene) => Promise<void>` | 1s debounce + `beforeunload` | Persist to backend |
| `onDirty` | `() => void` | First edit after save | Show "unsaved" badge |
| `onSaveStatusChange` | `(status) => void` | `idle/pending/saving/saved/paused/error` | Top-bar status indicator |
| `onThumbnailCapture` | `(blob, cameraData) => void` | ~10s idle after camera/scene stable, 1920×1080 SSGI | Upload to cloud, use in scene list |
| `appMenuButton`, `sidebarTop`, `navbarSlot`, `viewerToolbarLeft`, `viewerToolbarRight`, `sidebarOverlay`, `viewerBanner` | `ReactNode` | Render slots | **Drop in a "Scene picker"** |
| `settingsPanelProps.onVisibilityChange` | `(visible) => void` | User toggles project visibility | Project-level permissions |
| `sitePanelProps.onUploadAsset` | `(projectId, levelId, file, type)` | Scan/guide image upload | S3/Supabase Storage |
| `sitePanelProps.onDeleteAsset` | `(projectId, url)` | User deletes scan/guide | Clean up backend |
| `presetsAdapter` | `PresetsAdapter` | Preset CRUD | Replace localStorage with backend-backed presets |
| `commandPaletteEmptyAction` | fn | No-match search | Route to AI / search |
| `extraSidebarPanels` | `ExtraPanel[]` | Always visible | Add "Saved scenes" panel |

## Sidebar slots suited for a scene switcher
- **Layout v1:** `appMenuButton` (top-left) or `sidebarTop` (above tabs)
- **Layout v2:** `navbarSlot` (full-width top nav)
- **Both:** `extraSidebarPanels` to add a dedicated "Scenes" tab

## Command palette extension
```ts
useCommandRegistry().register([
  { id: 'editor.scene.open', label: 'Open scene…', group: 'Scene', execute: () => setShowSceneList(true) },
  { id: 'editor.scene.new', label: 'New scene', group: 'Scene', shortcut: ['Meta', 'N'], execute: createNewScene },
  { id: 'editor.scene.save-as', label: 'Save as…', group: 'Scene', execute: saveAs },
])
```

## Effort to ship a minimal scene switcher inside this package
- Add `extraSidebarPanels` consumer that takes a `scenes: SceneMeta[]` + `onOpen(id)` + `onDelete(id)` + `onCreate()` — ~150 lines.
- Wire three palette commands — ~50 lines.
- Consume `onThumbnailCapture` in the example host to populate list thumbnails — ~30 lines host-side.
- **Total ≈ 1–2 days** for an in-editor scene browser, OR host-side if we keep the Editor scene-agnostic.

## Verdict
The Editor's architecture is **backend-agnostic by design**. Every persistence decision is a host callback. Implementing the user's vision is 100% about wiring up what already exists — no Editor refactor needed.
