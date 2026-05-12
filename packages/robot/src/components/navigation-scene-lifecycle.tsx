'use client'

import {
  sceneRegistry,
  type AnyNode,
  type AnyNodeId,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor/runtime'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { setItemMoveVisualState } from '../lib/item-move-visuals'
import { setNavigationSceneRestorePending } from '../lib/navigation-auto-save'
import {
  buildPascalTruckNodeForScene,
  hasPascalTruckManualPlacement,
  isPascalTruckNode,
  PASCAL_TRUCK_ITEM_NODE_ID,
  stripPascalTruckFromSceneGraph,
} from '../lib/pascal-truck'
import type { SceneGraph } from '../lib/scene'
import { stripTransientMetadata } from '../lib/transient'
import useNavigation, { type NavigationRobotMode } from '../store/use-navigation'
import navigationVisualsStore from '../store/use-navigation-visuals'

type TaskModeRestoreMode = 'full' | 'task-loop'

type TaskModeSceneLifecycleController = {
  restoreTaskLoopSceneSnapshot: (taskLoopToken: number) => boolean
}

let taskModeSceneLifecycleController: TaskModeSceneLifecycleController | null = null

export function restoreNavigationTaskLoopSceneSnapshot(taskLoopToken: number) {
  return taskModeSceneLifecycleController?.restoreTaskLoopSceneSnapshot(taskLoopToken) ?? false
}

function cloneSceneGraph(sceneGraph: SceneGraph): SceneGraph {
  if (typeof structuredClone === 'function') {
    return structuredClone(sceneGraph)
  }

  return JSON.parse(JSON.stringify(sceneGraph)) as SceneGraph
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasTransientNavigationMetadata(node: AnyNode | unknown) {
  if (!isRecord(node) || !isRecord(node.metadata)) {
    return false
  }

  return node.metadata.isTransient === true
}

function sanitizeTaskModeSceneGraph(sceneGraph?: SceneGraph | null): SceneGraph | null | undefined {
  if (!sceneGraph) {
    return sceneGraph
  }

  const withoutTruck = stripPascalTruckFromSceneGraph(sceneGraph).sceneGraph ?? sceneGraph
  const sanitized = cloneSceneGraph(withoutTruck)
  const previewNodeIds = navigationVisualsStore.getState().taskPreviewNodeIds
  const removedNodeIds = new Set<string>()

  for (const [nodeId, node] of Object.entries(sanitized.nodes)) {
    if (
      previewNodeIds[nodeId] ||
      hasTransientNavigationMetadata(node) ||
      (isPascalTruckNode(node) && !hasPascalTruckManualPlacement(node))
    ) {
      removedNodeIds.add(nodeId)
      delete sanitized.nodes[nodeId]
      continue
    }

    if (isRecord(node) && 'metadata' in node) {
      sanitized.nodes[nodeId] = {
        ...node,
        metadata: setItemMoveVisualState(stripTransientMetadata(node.metadata), null),
      }
    }
  }

  if (removedNodeIds.size > 0) {
    sanitized.rootNodeIds = sanitized.rootNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId))

    for (const [nodeId, node] of Object.entries(sanitized.nodes)) {
      if (!isRecord(node) || !Array.isArray(node.children)) {
        continue
      }

      const nextChildren = node.children.filter(
        (childId) => typeof childId !== 'string' || !removedNodeIds.has(childId),
      )
      if (nextChildren.length !== node.children.length) {
        sanitized.nodes[nodeId] = {
          ...node,
          children: nextChildren,
        }
      }
    }
  }

  return sanitized
}

function hasTaskModeSceneContent(
  sceneGraph: SceneGraph | null | undefined,
): sceneGraph is SceneGraph {
  return Boolean(
    sceneGraph &&
      Array.isArray(sceneGraph.rootNodeIds) &&
      sceneGraph.rootNodeIds.length > 0 &&
      Object.keys(sceneGraph.nodes ?? {}).length > 0,
  )
}

function cloneSceneNode<T>(node: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(node)
  }

  return JSON.parse(JSON.stringify(node)) as T
}

function getManualPascalTruckNodeFromCurrentScene(): AnyNode | null {
  const node = useScene.getState().nodes[PASCAL_TRUCK_ITEM_NODE_ID as AnyNodeId]
  if (!(isPascalTruckNode(node) && hasPascalTruckManualPlacement(node))) {
    return null
  }

  return cloneSceneNode(node as AnyNode)
}

function mergePascalTruckNodeIntoSceneGraph(
  sceneGraph: SceneGraph,
  truckNode: AnyNode,
): SceneGraph {
  const nextSceneGraph = cloneSceneGraph(sceneGraph)
  const truckId = PASCAL_TRUCK_ITEM_NODE_ID
  const truckParentId =
    isRecord(truckNode) && typeof truckNode.parentId === 'string' ? truckNode.parentId : null

  for (const [nodeId, node] of Object.entries(nextSceneGraph.nodes)) {
    if (!isRecord(node) || !Array.isArray(node.children)) {
      continue
    }

    const withoutTruck = node.children.filter((childId) => childId !== truckId)
    const nextChildren =
      nodeId === truckParentId ? Array.from(new Set([...withoutTruck, truckId])) : withoutTruck
    if (nextChildren.length !== node.children.length || nodeId === truckParentId) {
      nextSceneGraph.nodes[nodeId] = {
        ...node,
        children: nextChildren,
      }
    }
  }

  nextSceneGraph.nodes[truckId] = truckNode
  nextSceneGraph.rootNodeIds =
    truckParentId === null
      ? Array.from(new Set([...nextSceneGraph.rootNodeIds, truckId]))
      : nextSceneGraph.rootNodeIds.filter((nodeId) => nodeId !== truckId)

  return nextSceneGraph
}

function resetViewerAndEditorState(mode: TaskModeRestoreMode) {
  const viewerState = useViewer.getState()
  viewerState.setHoveredId(null)
  viewerState.resetSelection()
  viewerState.setPreviewSelectedIds([])
  viewerState.setHoverHighlightMode('default')

  viewerState.outliner.selectedObjects.length = 0
  viewerState.outliner.hoveredObjects.length = 0
  if (mode !== 'task-loop') {
    sceneRegistry.clear()
  }
  useLiveTransforms.getState().clearAll()
  const navigationVisuals = navigationVisualsStore.getState()
  navigationVisuals.resetRuntimeVisuals({ preserveToolConeOverlay: mode === 'task-loop' })
  if (mode === 'task-loop') {
    navigationVisuals.setToolConeOverlayCamera(null)
    navigationVisuals.setToolConeOverlayWarmupReady(false)
    navigationVisuals.setToolConeOverlayEnabled(true)
  }

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
          activeTaskId: null,
          activeTaskIndex: 0,
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

function revealPascalTruckRuntimeObject() {
  navigationVisualsStore.getState().setNodeVisibilityOverride(PASCAL_TRUCK_ITEM_NODE_ID, null)
  const truckObject = sceneRegistry.nodes.get(PASCAL_TRUCK_ITEM_NODE_ID)
  if (!truckObject) {
    return
  }

  truckObject.visible = true
  truckObject.updateMatrixWorld(true)
}

function syncTaskModeSceneGraphToRegistry(
  sceneGraph?: SceneGraph | null,
  options?: { preservePascalTruck?: boolean },
) {
  const snapshotNodes = hasTaskModeSceneContent(sceneGraph) ? sceneGraph.nodes : {}

  for (const [nodeId, object] of sceneRegistry.nodes) {
    const node = snapshotNodes[nodeId]
    if (!node) {
      if (options?.preservePascalTruck === true && nodeId === PASCAL_TRUCK_ITEM_NODE_ID) {
        object.visible = true
        object.updateMatrixWorld(true)
        continue
      }

      object.visible = false
      object.updateMatrixWorld(true)
      continue
    }

    if (!isRecord(node) || node.type !== 'item') {
      continue
    }

    if (Array.isArray(node.position)) {
      object.position.set(
        Number(node.position[0] ?? 0),
        Number(node.position[1] ?? 0),
        Number(node.position[2] ?? 0),
      )
    }
    if (Array.isArray(node.rotation)) {
      object.rotation.set(
        Number(node.rotation[0] ?? 0),
        Number(node.rotation[1] ?? 0),
        Number(node.rotation[2] ?? 0),
      )
    }
    object.visible = node.visible !== false
    object.updateMatrixWorld(true)
  }
}

function applyTaskModeSceneGraph(
  sceneGraph?: SceneGraph | null,
  mode: TaskModeRestoreMode = 'full',
) {
  const syncOptions = { preservePascalTruck: mode === 'task-loop' }

  if (hasTaskModeSceneContent(sceneGraph)) {
    flushSync(() => {
      useScene.getState().setScene(
        sceneGraph.nodes as Record<AnyNodeId, AnyNode>,
        sceneGraph.rootNodeIds as AnyNodeId[],
      )
    })
    syncTaskModeSceneGraphToRegistry(sceneGraph, syncOptions)
    return
  }

  flushSync(() => {
    useScene.getState().clearScene()
  })
  syncTaskModeSceneGraphToRegistry(null, syncOptions)
}

function getPendingTaskRuntimeItemIds() {
  const navigationState = useNavigation.getState()
  const itemIds = new Set<string>()

  for (const task of navigationState.taskQueue) {
    itemIds.add(task.request.itemId)
  }
  if (navigationState.itemMoveRequest) {
    itemIds.add(navigationState.itemMoveRequest.itemId)
  }
  if (navigationState.itemDeleteRequest) {
    itemIds.add(navigationState.itemDeleteRequest.itemId)
  }
  if (navigationState.itemRepairRequest) {
    itemIds.add(navigationState.itemRepairRequest.itemId)
  }

  return itemIds
}

function getMissingTaskRuntimeItemIds() {
  const sceneNodes = useScene.getState().nodes as Record<string, AnyNode>
  const missing: string[] = []

  for (const itemId of getPendingTaskRuntimeItemIds()) {
    const sceneNode = sceneNodes[itemId]
    if (sceneNode?.type === 'item' && !sceneRegistry.nodes.get(itemId)) {
      missing.push(itemId)
    }
  }

  return missing
}

function getCurrentSceneGraph(): SceneGraph {
  const sceneState = useScene.getState()
  return {
    nodes: sceneState.nodes as Record<string, unknown>,
    rootNodeIds: [...sceneState.rootNodeIds] as string[],
  }
}

function removePascalTruckNodesFromCurrentScene() {
  const sceneState = useScene.getState()
  const truckIds = Object.entries(sceneState.nodes)
    .filter(([, node]) => isPascalTruckNode(node) && !hasPascalTruckManualPlacement(node))
    .map(([nodeId]) => nodeId as AnyNodeId)

  if (truckIds.length > 0) {
    sceneState.deleteNodes(truckIds)
  }
}

function ensurePascalTruckNodeInCurrentScene() {
  const sceneGraph = getCurrentSceneGraph()
  const stripped = stripPascalTruckFromSceneGraph(sceneGraph)
  const baseGraph = stripped.sceneGraph ?? sceneGraph
  removePascalTruckNodesFromCurrentScene()

  const { node, parentId } = buildPascalTruckNodeForScene(baseGraph, stripped.truckNode)
  useScene.getState().createNode(node as AnyNode, parentId ? (parentId as AnyNodeId) : undefined)
  revealPascalTruckRuntimeObject()
}

export function NavigationSceneLifecycle() {
  const { robotMode, taskLoopToken } = useNavigation(
    useShallow((state) => ({
      robotMode: state.robotMode,
      taskLoopToken: state.taskLoopToken,
    })),
  )
  const previousRobotModeRef = useRef<NavigationRobotMode | null>(null)
  const previousTaskLoopTokenRef = useRef(taskLoopToken)
  const restorePendingRef = useRef(false)
  const restoreFinalizeFrameRef = useRef<number | null>(null)
  const taskModeSceneSnapshotRef = useRef<SceneGraph | null>(null)
  const restoredTaskLoopTokenRef = useRef<number | null>(null)

  useEffect(() => () => setNavigationSceneRestorePending(false), [])

  useEffect(() => {
    if (robotMode !== 'task') {
      return
    }

    const syncManualTruckPlacementToSnapshot = () => {
      const manualTruckNode = getManualPascalTruckNodeFromCurrentScene()
      if (!(manualTruckNode && hasTaskModeSceneContent(taskModeSceneSnapshotRef.current))) {
        return
      }

      taskModeSceneSnapshotRef.current = mergePascalTruckNodeIntoSceneGraph(
        taskModeSceneSnapshotRef.current,
        manualTruckNode,
      )
    }

    syncManualTruckPlacementToSnapshot()
    return useScene.subscribe(syncManualTruckPlacementToSnapshot)
  }, [robotMode])

  const captureCurrentSceneGraph = useCallback((): SceneGraph => {
    const sceneState = useScene.getState()
    const sceneGraph = sanitizeTaskModeSceneGraph({
      nodes: sceneState.nodes as Record<string, unknown>,
      rootNodeIds: [...sceneState.rootNodeIds] as string[],
    })

    return sceneGraph ?? { nodes: {}, rootNodeIds: [] }
  }, [])

  const restoreTaskModeSceneSnapshot = useCallback(
    (options?: { clearSnapshot?: boolean; mode?: TaskModeRestoreMode; settledToken?: number }) => {
      if (restoreFinalizeFrameRef.current !== null) {
        cancelAnimationFrame(restoreFinalizeFrameRef.current)
        restoreFinalizeFrameRef.current = null
      }

      const finalizeRestore = () => {
        restoreFinalizeFrameRef.current = null
        restorePendingRef.current = false
        setNavigationSceneRestorePending(false)
        if (options?.clearSnapshot) {
          taskModeSceneSnapshotRef.current = null
        }
        if (typeof options?.settledToken === 'number') {
          const settledToken = options.settledToken
          flushSync(() => {
            useNavigation.getState().setTaskLoopSettledToken(settledToken)
          })
        }
      }

      const finalizeWhenTaskRuntimeReady = () => {
        if (
          typeof options?.settledToken === 'number' &&
          useNavigation.getState().taskLoopToken !== options.settledToken
        ) {
          restorePendingRef.current = false
          setNavigationSceneRestorePending(false)
          restoreFinalizeFrameRef.current = null
          return
        }

        if (getMissingTaskRuntimeItemIds().length === 0) {
          finalizeRestore()
          return
        }

        restoreFinalizeFrameRef.current = requestAnimationFrame(finalizeWhenTaskRuntimeReady)
      }

      const currentManualTruckNode = getManualPascalTruckNodeFromCurrentScene()
      if (currentManualTruckNode && hasTaskModeSceneContent(taskModeSceneSnapshotRef.current)) {
        taskModeSceneSnapshotRef.current = mergePascalTruckNodeIntoSceneGraph(
          taskModeSceneSnapshotRef.current,
          currentManualTruckNode,
        )
      }

      const snapshot = taskModeSceneSnapshotRef.current
      if (!hasTaskModeSceneContent(snapshot)) {
        const currentScene = captureCurrentSceneGraph()
        taskModeSceneSnapshotRef.current = hasTaskModeSceneContent(currentScene)
          ? currentScene
          : null
        finalizeRestore()
        return false
      }

      const mode = options?.mode ?? 'task-loop'
      restorePendingRef.current = true
      setNavigationSceneRestorePending(true)
      if (
        typeof options?.settledToken === 'number' &&
        useNavigation.getState().taskLoopSettledToken === options.settledToken
      ) {
        useNavigation.getState().setTaskLoopSettledToken(Math.max(0, options.settledToken - 1))
      }
      resetViewerAndEditorState(mode)
      applyTaskModeSceneGraph(cloneSceneGraph(snapshot), mode)
      if (useNavigation.getState().robotMode === 'task') {
        ensurePascalTruckNodeInCurrentScene()
      }

      restoreFinalizeFrameRef.current = requestAnimationFrame(finalizeWhenTaskRuntimeReady)
      return true
    },
    [captureCurrentSceneGraph],
  )

  const restoreTaskLoopSceneSnapshot = useCallback(
    (settledToken: number) => {
      const restored = restoreTaskModeSceneSnapshot({ mode: 'task-loop', settledToken })
      if (restored) {
        restoredTaskLoopTokenRef.current = settledToken
      }
      return restored
    },
    [restoreTaskModeSceneSnapshot],
  )

  useLayoutEffect(() => {
    const controller: TaskModeSceneLifecycleController = {
      restoreTaskLoopSceneSnapshot,
    }
    taskModeSceneLifecycleController = controller

    return () => {
      if (taskModeSceneLifecycleController === controller) {
        taskModeSceneLifecycleController = null
      }
    }
  }, [restoreTaskLoopSceneSnapshot])

  useEffect(
    () => () => {
      if (restoreFinalizeFrameRef.current !== null) {
        cancelAnimationFrame(restoreFinalizeFrameRef.current)
        restoreFinalizeFrameRef.current = null
      }
      restorePendingRef.current = false
      setNavigationSceneRestorePending(false)
    },
    [],
  )

  useLayoutEffect(() => {
    const previousRobotMode = previousRobotModeRef.current
    if (previousRobotMode !== 'task' && robotMode === 'task') {
      const currentScene = captureCurrentSceneGraph()
      taskModeSceneSnapshotRef.current = hasTaskModeSceneContent(currentScene) ? currentScene : null
      ensurePascalTruckNodeInCurrentScene()
      useNavigation.getState().setTaskLoopSettledToken(useNavigation.getState().taskLoopToken)
    } else if (previousRobotMode === null && robotMode !== null) {
      ensurePascalTruckNodeInCurrentScene()
    } else if (previousRobotMode === 'task' && robotMode !== 'task') {
      restoreTaskModeSceneSnapshot({ clearSnapshot: true, mode: 'full' })
      if (robotMode === null) {
        removePascalTruckNodesFromCurrentScene()
      } else {
        ensurePascalTruckNodeInCurrentScene()
      }
    } else if (previousRobotMode !== null && robotMode === null) {
      removePascalTruckNodesFromCurrentScene()
    } else if (robotMode === null) {
      removePascalTruckNodesFromCurrentScene()
    }

    previousRobotModeRef.current = robotMode
  }, [captureCurrentSceneGraph, restoreTaskModeSceneSnapshot, robotMode])

  useLayoutEffect(() => {
    const previousTaskLoopToken = previousTaskLoopTokenRef.current
    if (previousTaskLoopToken === taskLoopToken) {
      return
    }

    previousTaskLoopTokenRef.current = taskLoopToken
    if (robotMode !== 'task') {
      return
    }

    if (restoredTaskLoopTokenRef.current === taskLoopToken) {
      return
    }

    restoreTaskLoopSceneSnapshot(taskLoopToken)
  }, [restoreTaskLoopSceneSnapshot, robotMode, taskLoopToken])

  return null
}
