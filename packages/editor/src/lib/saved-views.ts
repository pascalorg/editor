'use client'

import {
  type AnyNodeId,
  type BuildingNode,
  type CollectionId,
  emitter,
  type LevelNode,
  runAsSingleSceneHistoryStep,
  type SavedView,
  type SavedViewCollectionState,
  type SavedViewId,
  useScene,
} from '@pascal-app/core'
import { useViewer, type WallMode } from '@pascal-app/viewer'
import { cameraPoseStore } from '../store/camera-pose-store'
import useEditor, { type ViewMode } from '../store/use-editor'

/**
 * The presentation half of a saved view. Core stores this as an opaque bag
 * because view mode, level mode, wall mode and theme are viewer/editor
 * concepts that core is not allowed to know about; this module is the only
 * place that gives the bag a shape.
 */
export type SavedViewPresentation = {
  viewMode?: ViewMode
  levelMode?: 'stacked' | 'exploded' | 'solo' | 'manual'
  wallMode?: WallMode
  sceneTheme?: string
  /** Level and building in focus — what `solo` and the 2D plan key off. */
  levelId?: string | null
  buildingId?: string | null
}

const VIEW_MODES: readonly ViewMode[] = ['3d', '2d', 'split']
const LEVEL_MODES = ['stacked', 'exploded', 'solo', 'manual'] as const
const WALL_MODES = ['up', 'cutaway', 'down', 'translucent'] as const

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)

/** Read a stored bag back into shape, dropping anything unrecognised. */
export function readSavedViewPresentation(view: SavedView): SavedViewPresentation {
  const raw = view.presentation
  if (!raw) return {}

  const presentation: SavedViewPresentation = {}
  if (isOneOf(raw.viewMode, VIEW_MODES)) presentation.viewMode = raw.viewMode
  if (isOneOf(raw.levelMode, LEVEL_MODES)) presentation.levelMode = raw.levelMode
  if (isOneOf(raw.wallMode, WALL_MODES)) presentation.wallMode = raw.wallMode
  if (typeof raw.sceneTheme === 'string') presentation.sceneTheme = raw.sceneTheme
  if (raw.levelId === null || typeof raw.levelId === 'string') presentation.levelId = raw.levelId
  if (raw.buildingId === null || typeof raw.buildingId === 'string') {
    presentation.buildingId = raw.buildingId
  }
  return presentation
}

function currentCollectionStates(): Record<CollectionId, SavedViewCollectionState> {
  const states: Record<CollectionId, SavedViewCollectionState> = {}
  for (const collection of Object.values(useScene.getState().collections)) {
    // `visible`/`locked` are optional on a collection, where absent reads as
    // visible/unlocked. Store the resolved booleans so restoring is a plain
    // assignment rather than a re-derivation of that default.
    states[collection.id] = {
      visible: collection.visible !== false,
      locked: collection.locked === true,
    }
  }
  return states
}

function currentSectionPlaneId(): AnyNodeId | null {
  for (const node of Object.values(useScene.getState().nodes)) {
    if (node.type === 'section-plane' && node.active && node.visible) return node.id
  }
  return null
}

/**
 * Snapshot the current camera, visibility, cut and style into a new saved view.
 *
 * Returns `null` when no camera pose has been published yet — the controls
 * publish on their first frame, so this only happens before the canvas has
 * rendered, and a view with no camera is not restorable.
 */
export function captureSavedView(name: string): SavedViewId | null {
  const camera = cameraPoseStore.getState().pose
  if (!camera) return null

  const viewer = useViewer.getState()
  const presentation: SavedViewPresentation = {
    viewMode: useEditor.getState().viewMode,
    levelMode: viewer.levelMode,
    wallMode: viewer.wallMode,
    sceneTheme: viewer.sceneTheme,
    levelId: viewer.selection.levelId,
    buildingId: viewer.selection.buildingId,
  }

  return useScene.getState().createSavedView({
    name,
    camera: { ...camera },
    sectionPlaneId: currentSectionPlaneId(),
    collectionStates: currentCollectionStates(),
    presentation,
  })
}

/** Re-capture an existing view in place, keeping its name and list position. */
export function updateSavedViewFromCurrentState(id: SavedViewId): boolean {
  const camera = cameraPoseStore.getState().pose
  if (!camera) return false
  const existing = useScene.getState().savedViews[id]
  if (!existing) return false

  const viewer = useViewer.getState()
  useScene.getState().updateSavedView(id, {
    camera: { ...camera },
    sectionPlaneId: currentSectionPlaneId(),
    collectionStates: currentCollectionStates(),
    presentation: {
      viewMode: useEditor.getState().viewMode,
      levelMode: viewer.levelMode,
      wallMode: viewer.wallMode,
      sceneTheme: viewer.sceneTheme,
      levelId: viewer.selection.levelId,
      buildingId: viewer.selection.buildingId,
    } satisfies SavedViewPresentation,
  })
  return true
}

/**
 * Restore a saved view: presentation state, then the scene writes, then the
 * camera.
 *
 * The scene writes (collection visibility, which plane is cutting) go through
 * one `runAsSingleSceneHistoryStep` — activating a view is one action to the
 * user, and without the fence a view that flips three collections and swaps the
 * cut would cost four undos to back out of.
 */
export function applySavedView(id: SavedViewId): boolean {
  const view = useScene.getState().savedViews[id]
  if (!view) return false

  const presentation = readSavedViewPresentation(view)
  const viewer = useViewer.getState()

  if (presentation.viewMode) useEditor.getState().setViewMode(presentation.viewMode)
  if (presentation.levelMode) viewer.setLevelMode(presentation.levelMode)
  if (presentation.wallMode) viewer.setWallMode(presentation.wallMode)
  if (presentation.sceneTheme) viewer.setSceneTheme(presentation.sceneTheme)
  if (presentation.levelId !== undefined || presentation.buildingId !== undefined) {
    // The bag round-trips through JSON, so these come back as plain strings;
    // the selection path wants the branded node ids they were captured from.
    viewer.setSelection({
      ...(presentation.buildingId !== undefined && {
        buildingId: presentation.buildingId as BuildingNode['id'] | null,
      }),
      ...(presentation.levelId !== undefined && {
        levelId: presentation.levelId as LevelNode['id'] | null,
      }),
    })
  }

  runAsSingleSceneHistoryStep(useScene, () => {
    const scene = useScene.getState()

    for (const [collectionId, state] of Object.entries(view.collectionStates ?? {})) {
      const collection = scene.collections[collectionId as CollectionId]
      if (!collection) continue
      const nextVisible = state.visible !== false
      const nextLocked = state.locked === true
      const currentVisible = collection.visible !== false
      const currentLocked = collection.locked === true
      if (currentVisible === nextVisible && currentLocked === nextLocked) continue
      scene.updateCollection(collectionId as CollectionId, {
        visible: nextVisible,
        locked: nextLocked,
      })
    }

    // `sectionPlaneId === undefined` means the view predates section planes, so
    // it says nothing about the cut and the current one is left alone. `null`
    // is the deliberate "no cut".
    if (view.sectionPlaneId !== undefined) {
      const updates: Array<{ id: AnyNodeId; data: { active: boolean } }> = []
      for (const node of Object.values(scene.nodes)) {
        if (node.type !== 'section-plane') continue
        const active = node.id === view.sectionPlaneId
        if (node.active !== active) updates.push({ id: node.id, data: { active } })
      }
      if (updates.length > 0) scene.updateNodes(updates)
    }
  })

  emitter.emit('camera-controls:apply-pose', view.camera)
  return true
}
