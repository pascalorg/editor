export type { EditorProps } from './components/editor'
export { default as Editor } from './components/editor'
export { useCommandPalette } from './components/ui/command-palette'
export { CATALOG_ITEMS } from './components/ui/item-catalog/catalog-items'
export { Slider } from './components/ui/primitives/slider'
export { SceneLoader } from './components/ui/scene-loader'
export type {
  ProjectVisibility,
  SettingsPanelProps,
} from './components/ui/sidebar/panels/settings-panel'
export type { SitePanelProps } from './components/ui/sidebar/panels/site-panel'
export type { PresetsAdapter, PresetsTab } from './contexts/presets-context'
export { PresetsProvider } from './contexts/presets-context'
export type { SaveStatus } from './hooks/use-auto-save'
export type { SceneGraph } from './lib/scene'
export { applySceneGraphToEditor } from './lib/scene'
export { default as useAudio } from './store/use-audio'
export { type CommandAction, useCommandRegistry } from './store/use-command-registry'
export { default as useEditor } from './store/use-editor'
export {
  type PaletteView,
  type PaletteViewProps,
  usePaletteViewRegistry,
} from './store/use-palette-view-registry'
export { useUploadStore } from './store/use-upload'
