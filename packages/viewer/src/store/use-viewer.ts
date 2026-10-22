'use client'

import type {
  AnyNode,
  BaseNode,
  BuildingNode,
  GroundBox,
  LevelGradeStanding,
  LevelNode,
  SitePresentation,
  UnitNode,
  ZoneNode,
} from '@pascal-app/core'
import type { Object3D } from 'three'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EdgeMode } from '../lib/edge-style'
import type { ColorPreset, RenderShading } from '../lib/materials'
import {
  getSceneTheme,
  projectSceneTheme,
  SCENE_THEME_IDS,
  type SceneTheme,
} from '../lib/scene-themes'

export type RenderContext = 'editor' | 'viewer'
export type MetricNotation = 'meters' | 'millimeters'
export type WallMode = 'up' | 'cutaway' | 'down' | 'translucent'

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

type LookDefaults = { theme: string; edges: EdgeMode; shadows: boolean }
type LocalLook = Partial<LookDefaults> & {
  shadingByContext?: Partial<Record<RenderContext, RenderShading>>
}

type ViewerState = {
  selection: SelectionPath
  focusedUnitId: UnitNode['id'] | null
  setFocusedUnit: (id: UnitNode['id'] | null) => void
  previewSelectedIds: BaseNode['id'][]
  setPreviewSelectedIds: (ids: BaseNode['id'][]) => void
  /** Host-owned selection highlights rendered through the viewer's native
   * selection paths without changing the local user's editable selection. */
  externalSelectedIds: BaseNode['id'][]
  setExternalSelectedIds: (ids: BaseNode['id'][]) => void
  /** Elements a chat context chip points at (Point and ask), drawn in the `point` outline style.
   * Its own slot, so a teammate's highlight in `externalSelectedIds` is never clobbered. */
  pointedIds: BaseNode['id'][]
  /** `null` clears it. */
  setPointedIds: (ids: BaseNode['id'][] | null) => void
  hoverHighlightMode: string
  setHoverHighlightMode: (mode: string) => void
  hoveredId: AnyNode['id'] | ZoneNode['id'] | null
  setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void

  cameraMode: 'perspective' | 'orthographic'
  setCameraMode: (mode: 'perspective' | 'orthographic') => void

  sceneTheme: string
  sceneAppearance: SceneTheme
  lookDefaults: LookDefaults
  projectPresentation?: SitePresentation
  setProjectPresentation: (presentation: SitePresentation | undefined) => void
  resetProjectLook: () => void
  previewSceneTheme: string | null
  contextDefaultShading: RenderShading
  /** The selected project/global theme before a temporary preview. */
  savedSceneTheme: string
  setSceneTheme: (id: string) => void
  /** Show a theme without saving it (e.g. a project's own mood); `null`
   *  returns to the saved one. */
  showSceneTheme: (id: string | null) => void

  renderContext: RenderContext
  setRenderContext: (context: RenderContext, defaultShading?: RenderShading) => void

  /** True during a GLB bake/export pass. Renderers that normally draw via a
   * collective InstancedMesh (`def.system`) and mount only an invisible per-node
   * proxy can watch this to emit real, visible geometry so the exporter — which
   * clones only the `scene-renderer` subtree — captures them. Transient (never
   * persisted). */
  isExporting: boolean
  setExporting: (value: boolean) => void

  /** Item model loads that exhausted their retries — nodeId → asset URL. The
   * scene renders without these items (they settle as skipped); a bake host
   * can persist the map onto the artifact's metadata so a missing item is
   * queryable instead of silently absent. Transient (never persisted). */
  itemLoadFailures: Record<string, string>
  reportItemLoadFailure: (nodeId: string, url: string) => void
  clearItemLoadFailure: (nodeId: string) => void

  /** Suspend the render loop while the canvas is fully covered (e.g. studio gallery). */
  renderPaused: boolean
  setRenderPaused: (value: boolean) => void

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
  metricNotation: MetricNotation
  setMetricNotation: (notation: MetricNotation) => void
  /** True once the user explicitly picked a unit. Until then `unit` is a
   * locale-derived default and is not persisted, so the default can keep
   * tracking the browser locale across sessions. */
  unitExplicit: boolean

  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'
  setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void
  /**
   * The editor's level display: stacked, with every level above the selected
   * one hidden (the selected level and those below stay). Set by the host
   * while editing; never persisted, so the viewer app keeps its own mode.
   */
  hideLevelsAboveSelection: boolean
  /**
   * The levels a construction reveal is playing on (a build, an undo, a move): each shows while its
   * work plays, whatever the level display hides, so the animation is seen. Set by the reveal, never
   * persisted; the author's own hiding of a level still wins.
   */
  levelsRevealing: readonly string[]
  /**
   * The nodes a construction reveal is playing now (moving in, going out, carried, or an edit
   * replaying): the cutaway leaves each of them, and the openings it hosts, in view while it
   * plays, whatever the wall mode. Set by the reveal, never persisted; the person's own wall mode
   * is not written.
   */
  nodesRevealing: readonly string[]
  /**
   * The level shown lies below grade, the storeys above it hidden. Set by the host's level display
   * beside `hideLevelsAboveSelection`; never persisted. Whether the ground over it is veiled also
   * depends on `groundMode`: read both through `groundVeiled`.
   */
  belowGrade: boolean
  /**
   * The shown level's standing against the sculpted terrain, set beside `belowGrade`:
   * only partly below grade, the ground veils just where it stands in the way (the ground
   * window), not wholesale.
   */
  gradeStanding: LevelGradeStanding
  /**
   * The box the ground window opens for: the shown level, or the whole building when it is
   * shown. Set by the host (never on the site phase, where the ground is the work); never
   * persisted. `null` closes the window.
   */
  groundWindowBox: GroundBox | null
  /** Ground stands between the eye and `groundWindowBox` now, set by the site renderer. */
  groundWindowVeiled: boolean
  /** The person's choice for the ground over a level below grade. Not persisted. */
  groundMode: GroundMode
  setGroundMode: (mode: GroundMode) => void
  /**
   * The scene has a level below grade (the below-grade footprint is not empty): set by the site
   * renderer. The ground materials carry the hole's mask, and the eye's fill light is mounted,
   * from the moment this is true, so that changing floors changes uniforms and never materials
   * or the light count; scenes without a level below grade keep plain materials. Never persisted.
   */
  hasLevelBelowGrade: boolean
  /**
   * The host lets the eye dive under the ground (the editor's orbit may, with the ground on Auto).
   * The eye's fill light is mounted, from the moment this is true, so that the first crossing of the
   * ground compiles nothing: a scene with no level below grade is dived under as well. Set by the
   * host's camera; never persisted.
   */
  diveAvailable: boolean
  /**
   * The eye lies under the ground at its own position (a free orbit under the lid). Set by the
   * viewer's underground ambiance from the camera; never persisted.
   */
  eyeUnderGround: boolean
  /**
   * Levels whose foundation a plugin is drawing under the ground right now (a framing plugin pours
   * the real footing and stem from the building's record). The generic foundation derived from the
   * walls is not drawn under these levels, so nothing is drawn twice. Written by that plugin while
   * its meshes are mounted, empty otherwise; never persisted.
   */
  pluginFoundationLevelIds: readonly string[]
  /**
   * The world is turned, or turning, to earth (the underground ambiance's factor is above 0).
   * Its factor itself eases every frame and lives with the shaders, not here; this flips only at
   * the crossing's ends. Set by the viewer's underground ambiance; never persisted.
   */
  ambianceActive: boolean
  /**
   * How the ground reads as a medium: the edge of the hole over a level below grade and the
   * crossing as the eye dives under the ground. Variants the owner and the team choose from;
   * every one is a uniform, so changing it compiles nothing. Never persisted.
   */
  undergroundLook: UndergroundLook
  setUndergroundLook: (look: Partial<UndergroundLook>) => void

  wallMode: WallMode
  setWallMode: (mode: WallMode) => void

  showScans: boolean
  setShowScans: (show: boolean) => void

  showGuides: boolean
  setShowGuides: (show: boolean) => void

  showGrid: boolean
  setShowGrid: (show: boolean) => void

  showMeasurements: boolean
  setShowMeasurements: (show: boolean) => void

  // Presentation flag for parametric zones. When false the zone renderer
  // unmounts its meshes AND its drei <Html> label (an <Html> costs per-frame
  // matrix work + live DOM even at opacity 0, so hiding is not enough). The
  // editor drives this from its structure layer; viewer surfaces keep the
  // default. Not persisted — derived state, not a user preference.
  showZones: boolean
  setShowZones: (show: boolean) => void

  transparentBackground: boolean
  setTransparentBackground: (transparent: boolean) => void

  // Embed-controlled ink-edge opacity override (null = use the per-mode default).
  inkOpacity: number | null
  setInkOpacity: (opacity: number | null) => void

  projectId: string | null
  setProjectId: (id: string | null) => void
  projectPreferences: Record<
    string,
    {
      look?: LocalLook
      showScans?: boolean
      showGuides?: boolean
      showGrid?: boolean
      showMeasurements?: boolean
    }
  >

  // Smart selection update
  setSelection: (updates: Partial<SelectionPath>) => void
  resetSelection: () => void

  outliner: Outliner // No setter as we will manipulate directly the arrays
  /** Bumped by GeometrySystem after each rebuild pass so selection/outline
   * effects can re-apply to the freshly swapped meshes. */
  geometryRevision: number
  bumpGeometryRevision: () => void

  // Export functionality
  exportScene: ((format?: 'glb' | 'usdz' | 'stl' | 'obj') => Promise<void>) | null
  setExportScene: (fn: ((format?: 'glb' | 'usdz' | 'stl' | 'obj') => Promise<void>) | null) => void

  debugColors: boolean
  setDebugColors: (enabled: boolean) => void

  walkthroughMode: boolean
  setWalkthroughMode: (mode: boolean) => void

  /** Pointer lock temporarily released mid-walkthrough (⌘/PrintScreen — OS
   *  screenshot needs a movable cursor); clicking the canvas re-locks. */
  walkthroughSuspended: boolean
  setWalkthroughSuspended: (suspended: boolean) => void

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
    | 'metricNotation'
    | 'unitExplicit'
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
const METRIC_NOTATIONS = ['meters', 'millimeters'] as const
const LEVEL_MODES = ['stacked', 'exploded', 'solo', 'manual'] as const
const WALL_MODES = ['up', 'cutaway', 'down', 'translucent'] as const

// Countries still on imperial/US customary units: United States, Liberia, Myanmar.
const IMPERIAL_REGIONS = ['US', 'LR', 'MM']

// IANA zones for those countries. The timezone tracks the OS clock (actual
// location), unlike navigator.language where en-US is a common default for
// users far outside the US.
const IMPERIAL_TIMEZONES = new Set([
  'America/New_York',
  'America/Detroit',
  'America/Kentucky/Louisville',
  'America/Kentucky/Monticello',
  'America/Indiana/Indianapolis',
  'America/Indiana/Vincennes',
  'America/Indiana/Winamac',
  'America/Indiana/Marengo',
  'America/Indiana/Petersburg',
  'America/Indiana/Vevay',
  'America/Indiana/Tell_City',
  'America/Indiana/Knox',
  'America/Chicago',
  'America/Menominee',
  'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem',
  'America/North_Dakota/Beulah',
  'America/Denver',
  'America/Boise',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Juneau',
  'America/Sitka',
  'America/Metlakatla',
  'America/Yakutat',
  'America/Nome',
  'America/Adak',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'Pacific/Guam',
  'Africa/Monrovia', // Liberia
  'Asia/Yangon', // Myanmar
  'Asia/Rangoon', // Myanmar (legacy alias)
])

function detectDefaultUnit(): ViewerState['unit'] {
  if (typeof navigator === 'undefined') return 'metric'
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (timeZone) return IMPERIAL_TIMEZONES.has(timeZone) ? 'imperial' : 'metric'
    // No timezone available: fall back to an explicit locale region subtag
    // only (never maximize() — it turns a bare "en" into region US).
    const region = new Intl.Locale(navigator.language).region
    return region && IMPERIAL_REGIONS.includes(region) ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

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
    const look =
      record.look && typeof record.look === 'object'
        ? (record.look as Record<string, unknown>)
        : undefined
    next[projectId] = {
      ...(look
        ? {
            look: {
              ...(typeof look.theme === 'string' && SCENE_THEME_IDS.includes(look.theme)
                ? { theme: look.theme }
                : {}),
              ...(typeof look.edges === 'string' && EDGE_MODES.includes(look.edges as EdgeMode)
                ? { edges: look.edges as EdgeMode }
                : {}),
              ...(typeof look.shadows === 'boolean' ? { shadows: look.shadows } : {}),
              shadingByContext: normalizeShadingByContext(look.shadingByContext),
            },
          }
        : {}),
      ...(typeof record.showScans === 'boolean' ? { showScans: record.showScans } : {}),
      ...(typeof record.showGuides === 'boolean' ? { showGuides: record.showGuides } : {}),
      ...(typeof record.showGrid === 'boolean' ? { showGrid: record.showGrid } : {}),
      ...(typeof record.showMeasurements === 'boolean'
        ? { showMeasurements: record.showMeasurements }
        : {}),
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
    unit: pickString<ViewerState['unit']>(state.unit, UNITS, detectDefaultUnit()),
    metricNotation: pickString<MetricNotation>(state.metricNotation, METRIC_NOTATIONS, 'meters'),
    unitExplicit:
      typeof state.unit === 'string' && UNITS.includes(state.unit as ViewerState['unit']),
    levelMode: pickString<ViewerState['levelMode']>(state.levelMode, LEVEL_MODES, 'stacked'),
    wallMode: pickString<ViewerState['wallMode']>(state.wallMode, WALL_MODES, 'up'),
    projectPreferences: normalizeProjectPreferences(state.projectPreferences),
  }
}

/** The owner's pick (16 Oct): the section cut's clean edge over earth walls, and the simple fade. */
export const DEFAULT_UNDERGROUND_LOOK: UndergroundLook = {
  edge: 'section-earth',
  transition: 'fade',
}

function resolveLook(state: ViewerState, patch: Partial<ViewerState>): Partial<ViewerState> {
  const next = { ...state, ...patch }
  const local = next.projectPreferences[next.projectId ?? '']?.look
  const savedTheme = local?.theme ?? next.projectPresentation?.theme ?? next.lookDefaults.theme
  const theme = getSceneTheme(next.previewSceneTheme ?? savedTheme)
  return {
    ...patch,
    savedSceneTheme: savedTheme,
    sceneTheme: theme.id,
    sceneAppearance: projectSceneTheme(
      theme,
      next.previewSceneTheme === null && !local?.theme ? next.projectPresentation : undefined,
    ),
    shading:
      local?.shadingByContext?.[next.renderContext] ??
      next.projectPresentation?.shading ??
      next.shadingByContext[next.renderContext] ??
      next.contextDefaultShading,
    edges: local?.edges ?? next.projectPresentation?.edges ?? next.lookDefaults.edges,
    shadows: local?.shadows ?? next.projectPresentation?.shadows ?? next.lookDefaults.shadows,
  }
}

function chooseLook(state: ViewerState, look: LocalLook): Partial<ViewerState> {
  const key = state.projectId ?? ''
  const previous = state.projectPreferences[key]
  const { shadingByContext, ...defaults } = look
  return resolveLook(state, {
    ...(!state.projectId
      ? {
          lookDefaults: { ...state.lookDefaults, ...defaults },
          shadingByContext: { ...state.shadingByContext, ...shadingByContext },
        }
      : {}),
    projectPreferences: {
      ...state.projectPreferences,
      [key]: { ...previous, look: { ...previous?.look, ...look } },
    },
    ...('theme' in look ? { previewSceneTheme: null } : {}),
  })
}

const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      focusedUnitId: null,
      setFocusedUnit: (focusedUnitId) => set({ focusedUnitId }),
      previewSelectedIds: [],
      setPreviewSelectedIds: (ids) => set({ previewSelectedIds: ids }),
      externalSelectedIds: [],
      setExternalSelectedIds: (ids) =>
        set((state) => {
          if (
            state.externalSelectedIds.length === ids.length &&
            state.externalSelectedIds.every((id, index) => id === ids[index])
          ) {
            return state
          }
          return { externalSelectedIds: ids }
        }),
      pointedIds: [],
      setPointedIds: (ids) =>
        set((state) => {
          const next = ids ?? []
          if (
            state.pointedIds.length === next.length &&
            state.pointedIds.every((id, index) => id === next[index])
          ) {
            return state
          }
          return { pointedIds: next }
        }),
      hoverHighlightMode: 'default',
      setHoverHighlightMode: (mode) =>
        set((state) => (state.hoverHighlightMode === mode ? state : { hoverHighlightMode: mode })),
      hoveredId: null,
      setHoveredId: (id) => set((state) => (state.hoveredId === id ? state : { hoveredId: id })),

      cameraMode: 'perspective',
      setCameraMode: (mode) => set({ cameraMode: mode }),

      sceneTheme: 'studio',
      sceneAppearance: getSceneTheme('studio'),
      lookDefaults: { theme: 'studio', edges: 'soft', shadows: true },
      projectPresentation: undefined,
      setProjectPresentation: (projectPresentation) =>
        set((state) => resolveLook(state, { projectPresentation })),
      resetProjectLook: () =>
        set((state) => {
          const projectPreferences = { ...state.projectPreferences }
          const key = state.projectId ?? ''
          const { look: _look, ...rest } = projectPreferences[key] ?? {}
          projectPreferences[key] = rest
          return resolveLook(state, { projectPreferences, previewSceneTheme: null })
        }),
      previewSceneTheme: null,
      contextDefaultShading: 'rendered',
      savedSceneTheme: 'studio',
      setSceneTheme: (id) => set((state) => chooseLook(state, { theme: id })),
      showSceneTheme: (id) => set((state) => resolveLook(state, { previewSceneTheme: id })),

      renderContext: 'editor',
      setRenderContext: (context, defaultShading = 'rendered') =>
        set((state) =>
          resolveLook(state, { renderContext: context, contextDefaultShading: defaultShading }),
        ),

      isExporting: false,
      setExporting: (value) => set({ isExporting: value }),

      itemLoadFailures: {},
      reportItemLoadFailure: (nodeId, url) =>
        set((state) =>
          state.itemLoadFailures[nodeId] === url
            ? state
            : { itemLoadFailures: { ...state.itemLoadFailures, [nodeId]: url } },
        ),
      clearItemLoadFailure: (nodeId) =>
        set((state) => {
          if (!(nodeId in state.itemLoadFailures)) return state
          const next = { ...state.itemLoadFailures }
          delete next[nodeId]
          return { itemLoadFailures: next }
        }),

      renderPaused: false,
      setRenderPaused: (value) => set({ renderPaused: value }),

      shading: 'rendered',
      shadingByContext: {},
      setShading: (shading) =>
        set((state) =>
          chooseLook(state, {
            shadingByContext: {
              ...state.projectPreferences[state.projectId ?? '']?.look?.shadingByContext,
              [state.renderContext]: shading,
            },
          }),
        ),

      textures: true,
      setTextures: (textures) => set({ textures }),

      colorPreset: 'clay',
      setColorPreset: (preset) => set({ colorPreset: preset }),

      edges: 'soft',
      setEdges: (edges) => set((state) => chooseLook(state, { edges })),

      shadows: true,
      setShadows: (shadows) => set((state) => chooseLook(state, { shadows })),

      unit: detectDefaultUnit(),
      metricNotation: 'meters',
      unitExplicit: false,
      setUnit: (unit) => set({ unit, unitExplicit: true }),
      setMetricNotation: (metricNotation) =>
        set({ unit: 'metric', metricNotation, unitExplicit: true }),

      levelMode: 'stacked',
      setLevelMode: (mode) => set({ levelMode: mode }),
      hideLevelsAboveSelection: false,
      levelsRevealing: [],
      nodesRevealing: [],
      belowGrade: false,
      gradeStanding: 'at-grade',
      groundWindowBox: null,
      groundWindowVeiled: false,
      groundMode: 'auto',
      setGroundMode: (mode) => set({ groundMode: mode }),
      hasLevelBelowGrade: false,
      diveAvailable: false,
      eyeUnderGround: false,
      pluginFoundationLevelIds: [],
      ambianceActive: false,
      undergroundLook: DEFAULT_UNDERGROUND_LOOK,
      setUndergroundLook: (look) =>
        set((state) => ({ undergroundLook: { ...state.undergroundLook, ...look } })),

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

      showMeasurements: true,
      setShowMeasurements: (show) =>
        set((state) => {
          const projectPreferences = { ...(state.projectPreferences || {}) }
          if (state.projectId) {
            projectPreferences[state.projectId] = {
              ...(projectPreferences[state.projectId] || {}),
              showMeasurements: show,
            }
          }
          return { showMeasurements: show, projectPreferences }
        }),

      showZones: true,
      setShowZones: (show) => set({ showZones: show }),

      transparentBackground: false,
      setTransparentBackground: (transparent) => set({ transparentBackground: transparent }),

      inkOpacity: null,
      setInkOpacity: (opacity) => set({ inkOpacity: opacity }),

      projectId: null,
      setProjectId: (id) =>
        set((state) => {
          if (id === state.projectId) return state
          const prefs = (id && state.projectPreferences?.[id]) || {}
          const { '': _unscoped, ...projectPreferences } = state.projectPreferences
          return resolveLook(state, {
            projectId: id,
            projectPreferences,
            projectPresentation: undefined,
            previewSceneTheme: null,
            showScans: prefs.showScans ?? true,
            showGuides: prefs.showGuides ?? true,
            showGrid: prefs.showGrid ?? true,
            showMeasurements: prefs.showMeasurements ?? true,
          })
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
      geometryRevision: 0,
      bumpGeometryRevision: () =>
        set((state) => ({ geometryRevision: state.geometryRevision + 1 })),

      exportScene: null,
      setExportScene: (fn) => set({ exportScene: fn }),

      debugColors: false,
      setDebugColors: (enabled) => set({ debugColors: enabled }),

      walkthroughMode: false,
      setWalkthroughMode: (mode) => set({ walkthroughMode: mode, walkthroughSuspended: false }),

      walkthroughSuspended: false,
      setWalkthroughSuspended: (suspended) => set({ walkthroughSuspended: suspended }),

      cameraDragging: false,
      setCameraDragging: (dragging) => set({ cameraDragging: dragging }),
      inputDragging: false,
      setInputDragging: (dragging) => set({ inputDragging: dragging }),
    }),
    {
      name: 'viewer-preferences',
      merge: (persistedState, currentState) => {
        const persisted = normalizePersistedViewerState(persistedState)
        return {
          ...currentState,
          ...persisted,
          ...resolveLook(currentState, {
            ...persisted,
            lookDefaults: {
              theme: persisted.sceneTheme ?? currentState.lookDefaults.theme,
              edges: persisted.edges ?? currentState.lookDefaults.edges,
              shadows: persisted.shadows ?? currentState.lookDefaults.shadows,
            },
          }),
        }
      },
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        sceneTheme: state.lookDefaults.theme,
        shadingByContext: state.shadingByContext,
        textures: state.textures,
        colorPreset: state.colorPreset,
        edges: state.lookDefaults.edges,
        shadows: state.lookDefaults.shadows,
        ...(state.unitExplicit ? { unit: state.unit } : {}),
        metricNotation: state.metricNotation,
        levelMode: state.levelMode,
        wallMode: state.wallMode,
        projectPreferences: Object.fromEntries(
          Object.entries(state.projectPreferences).filter(([key]) => key !== ''),
        ),
      }),
    },
  ),
)

/**
 * Over a level below grade the ground is `auto`: drawn as a faint veil, so the floor under it is
 * seen and clicked; `solid` keeps it as it is everywhere else.
 */
export type GroundMode = 'auto' | 'solid'

/**
 * The hole's edge seen from above: `noise` the eroded, scalloped border (today's), `quiet` the
 * same with a fine, faint noise (almost straight from the default camera), `section` an
 * architect's section cut (a constant offset of the footprint, straight edges, a flat face with a
 * thin line at grade), `section-earth` the same outline over the earth's walls (topsoil, strata,
 * a low crumble that is zero at the rim).
 */
export type UndergroundEdge = 'noise' | 'quiet' | 'section' | 'section-earth'

/** The dive under the ground: `noise` closes a noise mask over the screen, `fade` fades the whole frame at once. */
export type UndergroundTransition = 'noise' | 'fade'

export type UndergroundLook = { edge: UndergroundEdge; transition: UndergroundTransition }

/**
 * Whether the site's ground is drawn as a veil wholesale: a level below grade is shown, the
 * ground on auto. A level only partly below grade is the exception — there the ground window
 * veils just the ground in the way, and the rest stays solid. The walkthrough walks on its
 * floors: its ground is always solid, whatever level the overview had shown.
 */
export function groundVeiled(state: {
  belowGrade: boolean
  groundMode: GroundMode
  gradeStanding?: LevelGradeStanding
  walkthroughMode?: boolean
}): boolean {
  return (
    state.belowGrade &&
    state.groundMode === 'auto' &&
    state.gradeStanding !== 'partly-below-grade' &&
    state.walkthroughMode !== true
  )
}

/** Whether any ground is veiled now, wholesale or through the eye's window. */
export function anyGroundVeiled(state: {
  belowGrade: boolean
  groundMode: GroundMode
  gradeStanding?: LevelGradeStanding
  groundWindowVeiled: boolean
  walkthroughMode?: boolean
}): boolean {
  return (
    groundVeiled(state) ||
    (state.groundMode === 'auto' && state.groundWindowVeiled && state.walkthroughMode !== true)
  )
}

/**
 * Whether the site draws its own ground. `showGround: false` says other geometry supplies the
 * ground (an authored landscape), which stands on a level above a basement; while a level below
 * grade is shown, the level display hides the storeys above it (`belowGrade`) and the landscape
 * with them. The site's ground stands in then, with its veil, hole and pit, so the basement is
 * seen through an opening and not through nothing. With a level at or above grade shown, the
 * landscape is shown and `showGround` is the author's.
 */
export function siteGroundShown(
  site: { showGround?: boolean },
  state: { belowGrade: boolean },
): boolean {
  return site.showGround !== false || state.belowGrade
}

/** Apply an authoritative country code (e.g. IP-derived by the host app) as
 * the unit default. Stronger signal than the timezone heuristic used at store
 * creation, but still a default: it never overrides an explicit user choice
 * and is not persisted (the unit only sticks once the user touches the
 * toggle). */
export function applyCountryUnitDefault(country: string | null | undefined) {
  if (!country) return
  const state = useViewer.getState()
  if (state.unitExplicit) return
  const unit = IMPERIAL_REGIONS.includes(country.toUpperCase()) ? 'imperial' : 'metric'
  if (state.unit !== unit) useViewer.setState({ unit })
}

export default useViewer
