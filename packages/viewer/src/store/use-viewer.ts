'use client'

import type { AnyNode, BaseNode, BuildingNode, LevelNode, ZoneNode } from '@pascal-app/core'
import type { Object3D } from 'three'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EdgeMode } from '../lib/edge-style'
import type { ColorPreset, RenderShading } from '../lib/materials'
import { SCENE_THEME_IDS } from '../lib/scene-themes'

export type RenderContext = 'editor' | 'viewer'

type SelectionPath = {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  zoneId: ZoneNode['id'] | null
  selectedIds: BaseNode['id'][] // For items/assets (multi-select)
}

type Outliner = {
  selectedObjects: Object3D[]
  hoveredObjects: Object3D[]
}

type ViewerState = {
  selection: SelectionPath
  previewSelectedIds: BaseNode['id'][]
  setPreviewSelectedIds: (ids: BaseNode['id'][]) => void
  hoverHighlightMode: string
  setHoverHighlightMode: (mode: string) => void
  hoveredId: AnyNode['id'] | ZoneNode['id'] | null
  setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void

  cameraMode: 'perspective' | 'orthographic'
  setCameraMode: (mode: 'perspective' | 'orthographic') => void

  sceneTheme: string
  setSceneTheme: (id: string) => void

  renderContext: RenderContext
  setRenderContext: (context: RenderContext) => void

  shading: RenderShading
  shadingByContext: Partial<Record<RenderContext, RenderShading>>
  setShading: (shading: RenderShading) => void

  textures: boolean
  setTextures: (textures: boolean) => void

  colorPreset: ColorPreset
  setColorPreset: (preset: ColorPreset) => void

  edges: EdgeMode
  setEdges: (edges: EdgeMode) => void

  shadows: boolean
  setShadows: (shadows: boolean) => void

  unit: 'metric' | 'imperial'
  setUnit: (unit: 'metric' | 'imperial') => void

  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'
  setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void

  wallMode: 'up' | 'cutaway' | 'down' | 'translucent'
  setWallMode: (mode: 'up' | 'cutaway' | 'down' | 'translucent') => void

  showScans: boolean
  setShowScans: (show: boolean) => void

  showGuides: boolean
  setShowGuides: (show: boolean) => void

  showGrid: boolean
  setShowGrid: (show: boolean) => void

  transparentBackground: boolean
  setTransparentBackground: (transparent: boolean) => void

  // Embed-controlled ink-edge opacity override (null = use the per-mode default).
  inkOpacity: number | null
  setInkOpacity: (opacity: number | null) => void

  projectId: string | null
  setProjectId: (id: string | null) => void
  projectPreferences: Record<
    string,
    { showScans?: boolean; showGuides?: boolean; showGrid?: boolean }
  >

  // Smart selection update
  setSelection: (updates: Partial<SelectionPath>) => void
  resetSelection: () => void

  outliner: Outliner // No setter as we will manipulate directly the arrays

  // Export functionality
  exportScene: ((format?: 'glb' | 'stl' | 'obj') => Promise<void>) | null
  setExportScene: (fn: ((format?: 'glb' | 'stl' | 'obj') => Promise<void>) | null) => void

  debugColors: boolean
  setDebugColors: (enabled: boolean) => void

  walkthroughMode: boolean
  setWalkthroughMode: (mode: boolean) => void

  cameraDragging: boolean
  setCameraDragging: (dragging: boolean) => void

  /**
   * True while a host-driven drag is in progress (editor handles —
   * height arrow, width arrow, etc.). Suppresses node pointer event
   * routing so the synthetic click on pointerup doesn't reroute
   * selection to whatever mesh the cursor lands on at release.
   * Conceptually a sibling of `cameraDragging` — both mean "user is
   * dragging; don't treat the next pointerup as a click on the
   * scene." Set by the host (e.g. `NodeArrowHandles` in the editor);
   * the viewer only reads it.
   */
  inputDragging: boolean
  setInputDragging: (dragging: boolean) => void
}

type PersistedViewerState = Partial<
  Pick<
    ViewerState,
    | 'cameraMode'
    | 'sceneTheme'
    | 'shadingByContext'
    | 'textures'
    | 'colorPreset'
    | 'edges'
    | 'shadows'
    | 'unit'
    | 'levelMode'
    | 'wallMode'
    | 'projectPreferences'
  >
>

const CAMERA_MODES = ['perspective', 'orthographic'] as const
const RENDER_SHADINGS = ['solid', 'rendered'] as const
const COLOR_PRESETS = ['clay', 'white', 'mono', 'blueprint'] as const
const EDGE_MODES = ['off', 'soft', 'strong'] as const
const UNITS = ['metric', 'imperial'] as const
const LEVEL_MODES = ['stacked', 'exploded', 'solo', 'manual'] as const
const WALL_MODES = ['up', 'cutaway', 'down', 'translucent'] as const

function pickString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

function normalizeShadingByContext(value: unknown): ViewerState['shadingByContext'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const next: ViewerState['shadingByContext'] = {}
  for (const [context, shading] of Object.entries(value)) {
    if (context !== 'editor' && context !== 'viewer') continue
    next[context] = pickString<RenderShading>(shading, RENDER_SHADINGS, 'rendered')
  }
  return next
}

function normalizeProjectPreferences(value: unknown): ViewerState['projectPreferences'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const next: ViewerState['projectPreferences'] = {}
  for (const [projectId, preferences] of Object.entries(value)) {
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) continue
    const record = preferences as Record<string, unknown>
    next[projectId] = {
      ...(typeof record.showScans === 'boolean' ? { showScans: record.showScans } : {}),
      ...(typeof record.showGuides === 'boolean' ? { showGuides: record.showGuides } : {}),
      ...(typeof record.showGrid === 'boolean' ? { showGrid: record.showGrid } : {}),
    }
  }
  return next
}

function normalizePersistedViewerState(value: unknown): PersistedViewerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const state = value as Record<string, unknown>

  return {
    cameraMode: pickString<ViewerState['cameraMode']>(
      state.cameraMode,
      CAMERA_MODES,
      'perspective',
    ),
    sceneTheme: pickString(state.sceneTheme, SCENE_THEME_IDS, 'studio'),
    shadingByContext: normalizeShadingByContext(state.shadingByContext),
    textures: typeof state.textures === 'boolean' ? state.textures : true,
    colorPreset: pickString<ColorPreset>(state.colorPreset, COLOR_PRESETS, 'clay'),
    edges: pickString<EdgeMode>(state.edges, EDGE_MODES, 'soft'),
    shadows: typeof state.shadows === 'boolean' ? state.shadows : true,
    unit: pickString<ViewerState['unit']>(state.unit, UNITS, 'metric'),
    levelMode: pickString<ViewerState['levelMode']>(state.levelMode, LEVEL_MODES, 'stacked'),
    wallMode: pickString<ViewerState['wallMode']>(state.wallMode, WALL_MODES, 'up'),
    projectPreferences: normalizeProjectPreferences(state.projectPreferences),
  }
}

const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      previewSelectedIds: [],
      setPreviewSelectedIds: (ids) => set({ previewSelectedIds: ids }),
      hoverHighlightMode: 'default',
      setHoverHighlightMode: (mode) =>
        set((state) => (state.hoverHighlightMode === mode ? state : { hoverHighlightMode: mode })),
      hoveredId: null,
      setHoveredId: (id) => set((state) => (state.hoveredId === id ? state : { hoveredId: id })),

      cameraMode: 'perspective',
      setCameraMode: (mode) => set({ cameraMode: mode }),

      sceneTheme: 'studio',
      setSceneTheme: (id) => set({ sceneTheme: id }),

      renderContext: 'editor',
      setRenderContext: (context) => set({ renderContext: context }),

      shading: 'rendered',
      shadingByContext: {},
      setShading: (shading) =>
        set((state) => ({
          shading,
          shadingByContext: { ...state.shadingByContext, [state.renderContext]: shading },
        })),

      textures: true,
      setTextures: (textures) => set({ textures }),

      colorPreset: 'clay',
      setColorPreset: (preset) => set({ colorPreset: preset }),

      edges: 'soft',
      setEdges: (edges) => set({ edges }),

      shadows: true,
      setShadows: (shadows) => set({ shadows }),

      unit: 'metric',
      setUnit: (unit) => set({ unit }),

      levelMode: 'stacked',
      setLevelMode: (mode) => set({ levelMode: mode }),

      wallMode: 'up',
      setWallMode: (mode) => set({ wallMode: mode }),

      showScans: true,
      setShowScans: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) }
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showScans: show,
            }
          }
          return { showScans: show, projectPreferences }
        }),

      showGuides: true,
      setShowGuides: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) }
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showGuides: show,
            }
          }
          return { showGuides: show, projectPreferences }
        }),

      showGrid: true,
      setShowGrid: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) }
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showGrid: show,
            }
          }
          return { showGrid: show, projectPreferences }
        }),

      transparentBackground: false,
      setTransparentBackground: (transparent) => set({ transparentBackground: transparent }),

      inkOpacity: null,
      setInkOpacity: (opacity) => set({ inkOpacity: opacity }),

      projectId: null,
      setProjectId: (id) =>
        set((state) => {
          if (!id) return { projectId: id }
          const prefs = state.projectPreferences?.[id] || {}
          return {
            projectId: id,
            showScans: prefs.showScans ?? true,
            showGuides: prefs.showGuides ?? true,
            showGrid: prefs.showGrid ?? true,
          }
        }),
      projectPreferences: {},

      setSelection: (updates) =>
        set((state) => {
          const newSelection = { ...state.selection, ...updates }

          // Hierarchy Guard: If we change a high-level parent, reset the children unless explicitly provided
          if (updates.buildingId !== undefined) {
            if (updates.levelId === undefined) newSelection.levelId = null
            if (updates.zoneId === undefined) newSelection.zoneId = null
            if (updates.selectedIds === undefined) newSelection.selectedIds = []
          }
          if (updates.levelId !== undefined) {
            if (updates.zoneId === undefined) newSelection.zoneId = null
            if (updates.selectedIds === undefined) newSelection.selectedIds = []
          }
          if (updates.zoneId !== undefined) {
            if (updates.selectedIds === undefined) newSelection.selectedIds = []
          }

          return { selection: newSelection, previewSelectedIds: [] }
        }),

      resetSelection: () =>
        set({
          selection: {
            buildingId: null,
            levelId: null,
            zoneId: null,
            selectedIds: [],
          },
          previewSelectedIds: [],
        }),

      outliner: { selectedObjects: [], hoveredObjects: [] },

      exportScene: null,
      setExportScene: (fn) => set({ exportScene: fn }),

      debugColors: false,
      setDebugColors: (enabled) => set({ debugColors: enabled }),

      walkthroughMode: false,
      setWalkthroughMode: (mode) => set({ walkthroughMode: mode }),

      cameraDragging: false,
      setCameraDragging: (dragging) => set({ cameraDragging: dragging }),
      inputDragging: false,
      setInputDragging: (dragging) => set({ inputDragging: dragging }),
    }),
    {
      name: 'viewer-preferences',
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedViewerState(persistedState),
      }),
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        sceneTheme: state.sceneTheme,
        shadingByContext: state.shadingByContext,
        textures: state.textures,
        colorPreset: state.colorPreset,
        edges: state.edges,
        shadows: state.shadows,
        unit: state.unit,
        levelMode: state.levelMode,
        wallMode: state.wallMode,
        projectPreferences: state.projectPreferences,
      }),
    },
  ),
)

export default useViewer
