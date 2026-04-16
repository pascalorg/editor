'use client'

import type { AnyNode, BaseNode, BuildingNode, LevelNode, ZoneNode } from '@pascal-app/core'
import type { Object3D } from 'three'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  hoverHighlightMode: 'default' | 'delete'
  setHoverHighlightMode: (mode: 'default' | 'delete') => void
  hoveredId: AnyNode['id'] | ZoneNode['id'] | null
  setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void

  cameraMode: 'perspective' | 'orthographic'
  setCameraMode: (mode: 'perspective' | 'orthographic') => void

  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void

  unit: 'metric' | 'imperial'
  setUnit: (unit: 'metric' | 'imperial') => void

  levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'
  setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void

  wallMode: 'up' | 'cutaway' | 'down'
  setWallMode: (mode: 'up' | 'cutaway' | 'down') => void

  showScans: boolean
  setShowScans: (show: boolean) => void

  showGuides: boolean
  setShowGuides: (show: boolean) => void

  showGrid: boolean
  setShowGrid: (show: boolean) => void

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

  /**
   * FOV in degrees used by the perspective camera while `walkthroughMode`
   * is active. Defaults to 85° (standard FPS-ish). 50° orbit FOV feels
   * telephoto when you're standing inside the scene, so walkthrough gets
   * its own setting. Persisted so users' preferred FOV sticks across
   * sessions.
   */
  walkthroughFov: number
  setWalkthroughFov: (fov: number) => void

  cameraDragging: boolean
  setCameraDragging: (dragging: boolean) => void

  /**
   * Per-door open/close animation state. A door enters this map the first
   * time the user presses F while looking at it and stays there for the rest
   * of the session (the rotation tick reads `startedAt` + `from` + `target`
   * to compute the current open ratio without per-frame store writes — so
   * subscribers don't re-render during the animation).
   *
   * Persisted across phase/mode switches via the viewer store but NOT across
   * full reloads (excluded from `partialize`), so opening a bunch of doors
   * while reviewing a scene doesn't leak into the next session.
   */
  doorAnim: Record<string, { from: number; target: 0 | 1; startedAt: number }>
  toggleDoor: (id: string) => void
  /**
   * Drops animation entries for door ids that are no longer present in the
   * scene. Called periodically by the DoorInteractiveSystem so entries for
   * deleted nodes don't accumulate across long editing sessions.
   */
  pruneDoorAnim: (aliveIds: Set<string>) => void

  /**
   * ID of the door currently under the walkthrough crosshair (within reach).
   * Populated by DoorInteractiveSystem via a camera-forward raycast; consumed
   * by the F-key handler and the "Press F" hint overlay. `null` when the
   * crosshair isn't on a door or walkthrough mode is off.
   */
  crosshairHoveredDoorId: string | null
  setCrosshairHoveredDoorId: (id: string | null) => void
}

/**
 * Cubic ease-in-out. Decent default for door swings — starts and ends slow,
 * snaps through the middle. Used for the visible ratio only; the stored
 * animation state is linear time-based so the easing curve can change
 * without invalidating existing data.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * Shared helper for deriving the eased open ratio at time `now`. Exported
 * separately so `toggleDoor` can snapshot a mid-animation ratio, and the
 * per-frame door rotation system can compute the rendered angle without
 * touching store state.
 */
export function computeCurrentRatio(
  anim: { from: number; target: 0 | 1; startedAt: number },
  now: number,
  durationMs: number,
): number {
  const t = Math.max(0, Math.min(1, (now - anim.startedAt) / durationMs))
  return anim.from + (anim.target - anim.from) * easeInOutCubic(t)
}

export const DOOR_OPEN_DURATION_MS = 450
export const DOOR_MAX_ANGLE = Math.PI / 2

const useViewer = create<ViewerState>()(
  persist(
    (set) => ({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
      previewSelectedIds: [],
      setPreviewSelectedIds: (ids) => set({ previewSelectedIds: ids }),
      hoverHighlightMode: 'default',
      setHoverHighlightMode: (mode) => set({ hoverHighlightMode: mode }),
      hoveredId: null,
      setHoveredId: (id) => set({ hoveredId: id }),

      cameraMode: 'perspective',
      setCameraMode: (mode) => set({ cameraMode: mode }),

      theme: 'light',
      setTheme: (theme) => set({ theme }),

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

      walkthroughFov: 85,
      setWalkthroughFov: (fov) =>
        // Clamp to a sane range. Below ~50 it feels sniper-scope; above
        // ~110 the near-wall distortion is intolerable.
        set({ walkthroughFov: Math.max(50, Math.min(110, fov)) }),

      cameraDragging: false,
      setCameraDragging: (dragging) => set({ cameraDragging: dragging }),

      doorAnim: {},
      toggleDoor: (id) =>
        set((state) => {
          const existing = state.doorAnim[id]
          const now = performance.now()
          // Compute the door's current open ratio (using whatever animation
          // it was in mid-way through) so a mid-animation toggle reverses
          // smoothly from where it is rather than snapping.
          const current = existing ? computeCurrentRatio(existing, now, DOOR_OPEN_DURATION_MS) : 0
          const target: 0 | 1 = current > 0.5 ? 0 : 1
          return {
            doorAnim: {
              ...state.doorAnim,
              [id]: { from: current, target, startedAt: now },
            },
          }
        }),
      pruneDoorAnim: (aliveIds) =>
        set((state) => {
          let changed = false
          const next: typeof state.doorAnim = {}
          for (const [id, anim] of Object.entries(state.doorAnim)) {
            if (aliveIds.has(id)) {
              next[id] = anim
            } else {
              changed = true
            }
          }
          return changed ? { doorAnim: next } : state
        }),

      crosshairHoveredDoorId: null,
      setCrosshairHoveredDoorId: (id) => set({ crosshairHoveredDoorId: id }),
    }),
    {
      name: 'viewer-preferences',
      partialize: (state) => ({
        cameraMode: state.cameraMode,
        theme: state.theme,
        unit: state.unit,
        levelMode: state.levelMode,
        wallMode: state.wallMode,
        projectPreferences: state.projectPreferences,
        walkthroughFov: state.walkthroughFov,
      }),
    },
  ),
)

export default useViewer
