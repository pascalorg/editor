export type { EditorProps } from './components/editor'
export { default as Editor } from './components/editor'
export {
  type SnapshotCameraData,
  ThumbnailGenerator,
} from './components/editor/thumbnail-generator'
// Phase 5 Stage D transitional exports — pure drafting / angle helpers
// consumed by kind-owned drag actions in @pascal-app/nodes. Stage F
// cleanup moves these into @pascal-app/nodes (fence/drafting.ts +
// shared/segment-angle.ts) once every Stage D port is in.
export { type FencePlanPoint, snapFenceDraftPoint } from './components/tools/fence/fence-drafting'
export { CursorSphere } from './components/tools/shared/cursor-sphere'
export {
  formatAngleRadians,
  getAngleToSegmentReference,
  getSegmentAngleReferenceAtPoint,
} from './components/tools/shared/segment-angle'
export { isWallLongEnough } from './components/tools/wall/wall-drafting'
export { CameraActions as ViewerToolbarRight } from './components/ui/action-menu/camera-actions'
export { ViewToggles as ViewerToolbarLeft } from './components/ui/action-menu/view-toggles'
export { useCommandPalette } from './components/ui/command-palette'
export { SliderControl } from './components/ui/controls/slider-control'
export { FloatingLevelSelector } from './components/ui/floating-level-selector'
export { CATALOG_ITEMS } from './components/ui/item-catalog/catalog-items'
export { PALETTE_COLORS } from './components/ui/primitives/color-dot'
export { useSidebarStore } from './components/ui/primitives/sidebar'
export { Slider } from './components/ui/primitives/slider'
export { SceneLoader } from './components/ui/scene-loader'
export type { ExtraPanel } from './components/ui/sidebar/icon-rail'
export { ItemsPanel } from './components/ui/sidebar/panels/items-panel'
export {
  type ProjectVisibility,
  SettingsPanel,
  type SettingsPanelProps,
} from './components/ui/sidebar/panels/settings-panel'
export type { SitePanelProps } from './components/ui/sidebar/panels/site-panel'
export type { SidebarTab } from './components/ui/sidebar/tab-bar'
export type { PresetsAdapter, PresetsTab } from './contexts/presets-context'
export { PresetsProvider } from './contexts/presets-context'
export type { SaveStatus } from './hooks/use-auto-save'
// useDragAction is the React-side glue for the registry's DragAction
// primitive. Public so registry-driven kinds (Phase 5+ Stage D ports)
// can express their affordances declaratively in their own folder.
export { type UseDragActionArgs, useDragAction } from './hooks/use-drag-action'
export type { SceneGraph } from './lib/scene'
export { applySceneGraphToEditor } from './lib/scene'
export { triggerSFX } from './lib/sfx-bus'
export { default as useAudio } from './store/use-audio'
export { type CommandAction, useCommandRegistry } from './store/use-command-registry'
export type {
  FloorplanSelectionTool,
  MovingFenceEndpoint,
  SplitOrientation,
  ViewMode,
} from './store/use-editor'
export { default as useEditor } from './store/use-editor'
export {
  type PaletteView,
  type PaletteViewProps,
  usePaletteViewRegistry,
} from './store/use-palette-view-registry'
export { useUploadStore } from './store/use-upload'
