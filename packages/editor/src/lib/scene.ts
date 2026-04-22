'use client'

import type { BaseNode, BuildingNode, LevelNode, ZoneNode } from '@pascal-app/core'
import {
  getItemMoveVisualState,
  resolveLevelId,
  sceneRegistry,
  setItemMoveVisualState,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor, {
  hasCustomPersistedEditorUiState,
  normalizePersistedEditorUiState,
  type PersistedEditorUiState,
} from '../store/use-editor'
import useNavigation from '../store/use-navigation'
import navigationVisualsStore from '../store/use-navigation-visuals'

export type SceneGraph = {
  nodes: Record<string, unknown>
  rootNodeIds: string[]
}

type ApplySceneGraphMode = 'full' | 'task-loop'

type PersistedSelectionPath = {
  buildingId: BuildingNode['id'] | null
  levelId: LevelNode['id'] | null
  zoneId: ZoneNode['id'] | null
  selectedIds: BaseNode['id'][]
}

const EMPTY_PERSISTED_SELECTION: PersistedSelectionPath = {
  buildingId: null,
  levelId: null,
  zoneId: null,
  selectedIds: [],
}

const SELECTION_STORAGE_KEY = 'pascal-editor-selection'

function toBuildingNodeId(value: string | null | undefined): BuildingNode['id'] | null {
  return typeof value === 'string' && value.startsWith('building_')
    ? (value as BuildingNode['id'])
    : null
}

function toLevelNodeId(value: string | null | undefined): LevelNode['id'] | null {
  return typeof value === 'string' && value.startsWith('level_') ? (value as LevelNode['id']) : null
}

function toZoneNodeId(value: string | null | undefined): ZoneNode['id'] | null {
  return typeof value === 'string' && value.startsWith('zone_') ? (value as ZoneNode['id']) : null
}

function getSelectionStorageKey(): string {
  const projectId = useViewer.getState().projectId
  return projectId ? `${SELECTION_STORAGE_KEY}:${projectId}` : SELECTION_STORAGE_KEY
}

function getSelectionStorageReadKeys(): string[] {
  const scopedKey = getSelectionStorageKey()
  return scopedKey === SELECTION_STORAGE_KEY ? [scopedKey] : [scopedKey, SELECTION_STORAGE_KEY]
}

function getDefaultLevelIdForBuilding(
  sceneNodes: Record<string, any>,
  buildingId: BuildingNode['id'] | null,
): LevelNode['id'] | null {
  if (!buildingId) {
    return null
  }

  const buildingNode = sceneNodes[buildingId]
  if (buildingNode?.type !== 'building' || !Array.isArray(buildingNode.children)) {
    return null
  }

  let firstLevelId: LevelNode['id'] | null = null

  for (const childId of buildingNode.children) {
    const levelNode = sceneNodes[childId]
    if (levelNode?.type !== 'level') {
      continue
    }

    firstLevelId ??= levelNode.id

    if (levelNode.level === 0) {
      return levelNode.id
    }
  }

  return firstLevelId
}

function normalizePersistedSelectionPath(
  selection:
    | Partial<{
        buildingId: string | null
        levelId: string | null
        zoneId: string | null
        selectedIds: string[]
      }>
    | null
    | undefined,
): PersistedSelectionPath {
  return {
    buildingId: toBuildingNodeId(selection?.buildingId),
    levelId: toLevelNodeId(selection?.levelId),
    zoneId: toZoneNodeId(selection?.zoneId),
    // Branch-only selection persistence should restore scene context, not reopen
    // node panels from the last session.
    selectedIds: [],
  }
}

function hasPersistedSelectionValue(selection: PersistedSelectionPath): boolean {
  return Boolean(
    selection.buildingId ||
      selection.levelId ||
      selection.zoneId ||
      selection.selectedIds.length > 0,
  )
}

function readPersistedSelection(): PersistedSelectionPath | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    for (const key of getSelectionStorageReadKeys()) {
      const rawSelection = window.localStorage.getItem(key)
      if (!rawSelection) {
        continue
      }

      return normalizePersistedSelectionPath(
        JSON.parse(rawSelection) as Partial<PersistedSelectionPath>,
      )
    }
  } catch {
    return null
  }

  return null
}

export function writePersistedSelection(selection: {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: string[]
}) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const sceneNodes = useScene.getState().nodes as Record<string, any>
    const normalizedSelection = normalizePersistedSelectionPath(selection)
    const validatedSelection =
      getValidatedSelectionForScene(sceneNodes, normalizedSelection) ?? normalizedSelection

    window.localStorage.setItem(getSelectionStorageKey(), JSON.stringify(validatedSelection))
  } catch {
    // Swallow storage quota errors
  }
}

function getEditorUiStateForRestoredSelection(
  sceneNodes: Record<string, any>,
  selection: PersistedSelectionPath,
  fallbackUiState: PersistedEditorUiState,
): PersistedEditorUiState {
  if (!selection.levelId) {
    return {
      ...fallbackUiState,
      phase: 'site',
      mode: fallbackUiState.phase === 'site' ? fallbackUiState.mode : 'select',
      tool: null,
      structureLayer: 'elements',
      catalogCategory: null,
    }
  }

  if (selection.zoneId) {
    return {
      ...fallbackUiState,
      phase: 'structure',
      mode: 'select',
      tool: null,
      structureLayer: 'zones',
      catalogCategory: null,
    }
  }

  const selectedNodes = selection.selectedIds
    .map((id) => sceneNodes[id])
    .filter((node): node is Record<string, any> => Boolean(node))

  const shouldRestoreFurnishPhase =
    selectedNodes.length > 0 &&
    selectedNodes.every(
      (node) =>
        node.type === 'item' &&
        node.asset?.category !== 'door' &&
        node.asset?.category !== 'window',
    )

  return {
    ...fallbackUiState,
    phase: shouldRestoreFurnishPhase ? 'furnish' : 'structure',
    mode: 'select',
    tool: null,
    structureLayer: 'elements',
    catalogCategory: null,
  }
}

function getValidatedSelectionForScene(
  sceneNodes: Record<string, any>,
  selection: PersistedSelectionPath,
): PersistedSelectionPath | null {
  const levelNode = selection.levelId ? sceneNodes[selection.levelId] : null
  const hasValidLevel = levelNode?.type === 'level'
  const buildingNodeFromLevel =
    hasValidLevel && levelNode.parentId ? sceneNodes[levelNode.parentId] : null
  const explicitBuildingNode = selection.buildingId ? sceneNodes[selection.buildingId] : null
  const buildingId =
    buildingNodeFromLevel?.type === 'building'
      ? buildingNodeFromLevel.id
      : explicitBuildingNode?.type === 'building'
        ? explicitBuildingNode.id
        : null

  if (!buildingId) {
    return null
  }

  const levelId = hasValidLevel
    ? levelNode.id
    : getDefaultLevelIdForBuilding(sceneNodes, buildingId)

  if (levelId) {
    const zoneNode = selection.zoneId ? sceneNodes[selection.zoneId] : null
    const zoneId =
      zoneNode?.type === 'zone' && resolveLevelId(zoneNode, sceneNodes) === levelId
        ? zoneNode.id
        : null

    const selectedIds = selection.selectedIds.filter((id) => {
      const node = sceneNodes[id]
      return Boolean(node) && resolveLevelId(node, sceneNodes) === levelId
    })

    return {
      buildingId,
      levelId,
      zoneId,
      selectedIds,
    }
  }

  return {
    ...EMPTY_PERSISTED_SELECTION,
    buildingId,
  }
}

function getRestoredSelectionForScene(
  sceneNodes: Record<string, any>,
): PersistedSelectionPath | null {
  const persistedSelection = readPersistedSelection()
  if (!(persistedSelection && hasPersistedSelectionValue(persistedSelection))) {
    return null
  }

  return getValidatedSelectionForScene(sceneNodes, persistedSelection)
}

export function syncEditorSelectionFromCurrentScene(options?: { restorePersistedUiState?: boolean }) {
  const sceneNodes = useScene.getState().nodes as Record<string, any>
  const sceneRootIds = useScene.getState().rootNodeIds
  const siteNode = sceneRootIds[0] ? sceneNodes[sceneRootIds[0]] : null
  const resolve = (child: any) => (typeof child === 'string' ? sceneNodes[child] : child)
  const firstBuilding = siteNode?.children?.map(resolve).find((n: any) => n?.type === 'building')
  const firstLevel = firstBuilding?.children?.map(resolve).find((n: any) => n?.type === 'level')
  const restorePersistedUiState = options?.restorePersistedUiState ?? true
  const restoredEditorUiState = normalizePersistedEditorUiState(useEditor.getState())
  const shouldRestoreEditorUiState =
    restorePersistedUiState && hasCustomPersistedEditorUiState(restoredEditorUiState)
  const restoredSelection = restorePersistedUiState ? getRestoredSelectionForScene(sceneNodes) : null
  const selectionDrivenEditorUiState = restoredSelection
    ? getEditorUiStateForRestoredSelection(sceneNodes, restoredSelection, restoredEditorUiState)
    : null

  if (firstBuilding && firstLevel) {
    const isEmptyLevel = !firstLevel.children || firstLevel.children.length === 0

    // For empty projects (new/blank), always start in structure/build/wall
    // regardless of persisted state from a previous project
    if (isEmptyLevel) {
      useViewer.getState().setSelection({
        buildingId: firstBuilding.id,
        levelId: firstLevel.id,
        selectedIds: [],
        zoneId: null,
      })
      useEditor.getState().setPhase('structure')
      useEditor.getState().setStructureLayer('elements')
      useEditor.getState().setMode('build')
      useEditor.getState().setTool('wall')
      return
    }

    if (shouldRestoreEditorUiState) {
      if (restoredSelection) {
        useViewer.getState().setSelection(restoredSelection)
        useEditor.setState(
          restoredEditorUiState.phase === 'site'
            ? (selectionDrivenEditorUiState ?? restoredEditorUiState)
            : restoredEditorUiState,
        )
      } else if (restoredEditorUiState.phase === 'site') {
        useViewer.getState().resetSelection()
        useEditor.setState(restoredEditorUiState)
      } else {
        useViewer.getState().setSelection({
          buildingId: firstBuilding.id,
          levelId: firstLevel.id,
          selectedIds: [],
          zoneId: null,
        })
        useEditor.setState(restoredEditorUiState)
      }
      return
    }

    if (restoredSelection) {
      useViewer.getState().setSelection(restoredSelection)
      if (selectionDrivenEditorUiState) {
        useEditor.setState(selectionDrivenEditorUiState)
      }
      return
    }

    useViewer.getState().setSelection({
      buildingId: firstBuilding.id,
      levelId: firstLevel.id,
      selectedIds: [],
      zoneId: null,
    })
    useEditor.getState().setPhase('structure')
    useEditor.getState().setStructureLayer('elements')
  } else {
    useEditor.getState().setPhase('site')
    useViewer.getState().setSelection({
      buildingId: null,
      levelId: null,
      selectedIds: [],
      zoneId: null,
    })
  }
}

function resetEditorInteractionState(mode: ApplySceneGraphMode) {
  useViewer.getState().setHoveredId(null)
  useViewer.getState().resetSelection()
  useViewer.setState({
    hoverHighlightMode: 'default',
    nodeEventsSuppressed: false,
    previewSelectedIds: [],
  })
  navigationVisualsStore.setState({
    itemDeleteActivations: {},
    itemMovePreview: null,
    itemMoveVisualStates: {},
    navigationPostWarmupCompletedToken: 0,
    navigationPostWarmupRequestToken: 0,
    navigationPostWarmupScope: null,
    nodeVisibilityOverrides: {},
    repairShieldActivations: {},
    showActionShields: false,
    toolConeIsolatedOverlay: null,
    toolConeOverlayCamera: null,
    toolConeOverlayEnabled: false,
    toolConeOverlayWarmupReady: false,
  })
  // Clear outliner arrays synchronously so stale Object3D refs from the old
  // scene don't leak into the post-processing pipeline's outline passes.
  const outliner = useViewer.getState().outliner
  outliner.selectedObjects.length = 0
  outliner.hoveredObjects.length = 0
  useNavigation.setState((state) =>
    mode === 'task-loop'
      ? {
          actorAvailable: false,
          actorWorldPosition: null,
          itemMoveControllers: {},
          itemMoveLocked: false,
          navigationClickSuppressedUntil: 0,
          walkableOverlayVisible: false,
        }
      : {
          actorAvailable: false,
          actorWorldPosition: null,
          itemDeleteRequest: null,
          itemMoveControllers: {},
          itemMoveLocked: false,
          itemMoveRequest: null,
          itemRepairRequest: null,
          navigationClickSuppressedUntil: 0,
          taskQueue: [],
          walkableOverlayVisible: false,
        },
  )
  useEditor.setState((state) =>
    mode === 'task-loop'
      ? {
          ...state,
          tool: null,
          selectedItem: null,
          movingNode: null,
          selectedReferenceId: null,
          spaces: {},
          editingHole: null,
          isPreviewMode: false,
        }
      : {
          ...state,
          phase: 'site',
          mode: 'select',
          tool: null,
          structureLayer: 'elements',
          catalogCategory: null,
          selectedItem: null,
          movingNode: null,
          selectedReferenceId: null,
          spaces: {},
          editingHole: null,
          isPreviewMode: false,
        },
  )
}

function hasUsableSceneGraph(sceneGraph?: SceneGraph | null): sceneGraph is SceneGraph {
  return (
    !!sceneGraph &&
    Object.keys(sceneGraph.nodes ?? {}).length > 0 &&
    (sceneGraph.rootNodeIds?.length ?? 0) > 0
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripTransientTaskVisuals(sceneGraph?: SceneGraph | null): SceneGraph | null | undefined {
  if (!sceneGraph) {
    return sceneGraph
  }

  let changed = false
  const sanitizedNodes: Record<string, unknown> = {}

  for (const [id, node] of Object.entries(sceneGraph.nodes ?? {})) {
    if (!isRecord(node) || getItemMoveVisualState(node.metadata) === null) {
      sanitizedNodes[id] = node
      continue
    }

    sanitizedNodes[id] = {
      ...node,
      metadata: setItemMoveVisualState(node.metadata, null),
    }
    changed = true
  }

  if (!changed) {
    return sceneGraph
  }

  return {
    ...sceneGraph,
    nodes: sanitizedNodes,
  }
}

export function applySceneGraphToEditor(
  sceneGraph?: SceneGraph | null,
  options?: { mode?: ApplySceneGraphMode },
) {
  const mode = options?.mode ?? 'full'
  resetEditorInteractionState(mode)
  const sanitizedSceneGraph = stripTransientTaskVisuals(sceneGraph)

  if (hasUsableSceneGraph(sanitizedSceneGraph)) {
    const { nodes, rootNodeIds } = sanitizedSceneGraph
    useScene.getState().setScene(nodes as any, rootNodeIds as any)
  } else {
    useScene.getState().clearScene()
  }

  syncEditorSelectionFromCurrentScene({
    restorePersistedUiState: mode !== 'task-loop',
  })
}

const LOCAL_STORAGE_KEY = 'pascal-editor-scene'

export function saveSceneToLocalStorage(scene: SceneGraph): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stripTransientTaskVisuals(scene)))
  } catch {
    // Swallow storage quota errors
  }
}

export function loadSceneFromLocalStorage(): SceneGraph | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw
      ? ((stripTransientTaskVisuals(JSON.parse(raw) as SceneGraph) as SceneGraph | null) ?? null)
      : null
  } catch {
    return null
  }
}
