'use client'

import { type AnyNodeId, getScaledDimensions, type ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import mitt from 'mitt'
import { create } from 'zustand'
import useEditor from './use-editor'
import navigationVisualsStore from './use-navigation-visuals'

type NavigationEvents = {
  'navigation:actor-transform': {
    moving: boolean
    position: [number, number, number] | null
    rotationY: number
  }
  'navigation:look-at': {
    position: [number, number, number]
    target: [number, number, number]
  }
}

export const navigationEmitter = mitt<NavigationEvents>()

export type WallOverlayFilters = {
  carveDoorPortals: boolean
  excludeObstacleItems: boolean
  expandByClearance: boolean
  requireSupportingSurface: boolean
}

export const DEFAULT_WALL_OVERLAY_FILTERS: WallOverlayFilters = {
  carveDoorPortals: true,
  excludeObstacleItems: true,
  expandByClearance: true,
  requireSupportingSurface: true,
}

export type NavigationItemMoveController = {
  beginCarry: () => void
  cancel: () => void
  commit: (
    finalUpdate: Partial<ItemNode>,
    finalCarryTransform?: { position: [number, number, number]; rotation: number },
  ) => void
  itemId: ItemNode['id']
  updateCarryTransform: (position: [number, number, number], rotationY: number) => void
}

export type NavigationItemMoveRequest = {
  finalUpdate: Partial<ItemNode>
  itemDimensions: [number, number, number]
  itemId: ItemNode['id']
  levelId: string | null
  sourcePosition: [number, number, number]
  sourceRotation: [number, number, number]
  targetPreviewItemId?: ItemNode['id'] | null
  visualItemId?: ItemNode['id'] | null
}

export type NavigationItemDeleteRequest = {
  itemDimensions: [number, number, number]
  itemId: ItemNode['id']
  levelId: string | null
  sourcePosition: [number, number, number]
  sourceRotation: [number, number, number]
}

export type NavigationItemRepairRequest = {
  itemDimensions: [number, number, number]
  itemId: ItemNode['id']
  levelId: string | null
  sourcePosition: [number, number, number]
  sourceRotation: [number, number, number]
}

export type NavigationTaskKind = 'delete' | 'move' | 'repair'
export type NavigationRobotMode = 'normal' | 'task'

export type NavigationQueuedTask =
  | {
      kind: 'delete'
      request: NavigationItemDeleteRequest
      taskId: string
    }
  | {
      kind: 'move'
      request: NavigationItemMoveRequest
      taskId: string
    }
  | {
      kind: 'repair'
      request: NavigationItemRepairRequest
      taskId: string
    }

export type NavigationTaskAdvanceResult = {
  hasQueuedTask: boolean
  wrappedToStart: boolean
}

let navigationTaskSequence = 0

function createNavigationTaskId(kind: NavigationTaskKind) {
  navigationTaskSequence += 1
  return `${kind}-${navigationTaskSequence}`
}

function cloneNavigationItemDeleteRequest(
  request: NavigationItemDeleteRequest,
): NavigationItemDeleteRequest {
  return {
    ...request,
    itemDimensions: [...request.itemDimensions] as [number, number, number],
    sourcePosition: [...request.sourcePosition] as [number, number, number],
    sourceRotation: [...request.sourceRotation] as [number, number, number],
  }
}

function cloneNavigationItemMoveRequest(
  request: NavigationItemMoveRequest,
): NavigationItemMoveRequest {
  return {
    ...request,
    finalUpdate: {
      ...request.finalUpdate,
      position: request.finalUpdate.position
        ? ([...request.finalUpdate.position] as [number, number, number])
        : request.finalUpdate.position,
      rotation: request.finalUpdate.rotation
        ? ([...request.finalUpdate.rotation] as [number, number, number])
        : request.finalUpdate.rotation,
    },
    itemDimensions: [...request.itemDimensions] as [number, number, number],
    sourcePosition: [...request.sourcePosition] as [number, number, number],
    sourceRotation: [...request.sourceRotation] as [number, number, number],
  }
}

function cloneNavigationItemRepairRequest(
  request: NavigationItemRepairRequest,
): NavigationItemRepairRequest {
  return {
    ...request,
    itemDimensions: [...request.itemDimensions] as [number, number, number],
    sourcePosition: [...request.sourcePosition] as [number, number, number],
    sourceRotation: [...request.sourceRotation] as [number, number, number],
  }
}

function getNormalizedTaskIndex(taskQueue: NavigationQueuedTask[], activeTaskIndex: number) {
  if (taskQueue.length === 0) {
    return 0
  }

  return Math.min(Math.max(activeTaskIndex, 0), taskQueue.length - 1)
}

function deriveActiveRequests(taskQueue: NavigationQueuedTask[], activeTaskIndex: number) {
  const normalizedTaskIndex = getNormalizedTaskIndex(taskQueue, activeTaskIndex)
  const activeTask = taskQueue[normalizedTaskIndex] ?? null
  return {
    activeTaskId: activeTask?.taskId ?? null,
    activeTaskIndex: activeTask ? normalizedTaskIndex : 0,
    itemDeleteRequest:
      activeTask?.kind === 'delete' ? cloneNavigationItemDeleteRequest(activeTask.request) : null,
    itemMoveRequest:
      activeTask?.kind === 'move' ? cloneNavigationItemMoveRequest(activeTask.request) : null,
    itemRepairRequest:
      activeTask?.kind === 'repair' ? cloneNavigationItemRepairRequest(activeTask.request) : null,
    taskQueue,
  }
}

function deriveRestartedActiveRequests(
  taskQueue: NavigationQueuedTask[],
  queueRestartToken: number,
) {
  return {
    ...deriveActiveRequests(taskQueue, 0),
    queueRestartToken: queueRestartToken + 1,
  }
}

function moveTaskToIndex(
  taskQueue: NavigationQueuedTask[],
  taskId: string,
  targetIndex: number,
): NavigationQueuedTask[] | null {
  const sourceIndex = taskQueue.findIndex((task) => task.taskId === taskId)
  if (sourceIndex < 0) {
    return null
  }

  const normalizedTargetIndex = Math.min(
    Math.max(targetIndex, 0),
    Math.max(0, taskQueue.length - 1),
  )
  if (sourceIndex === normalizedTargetIndex) {
    return null
  }

  const nextTaskQueue = [...taskQueue]
  const [movedTask] = nextTaskQueue.splice(sourceIndex, 1)
  if (!movedTask) {
    return null
  }

  nextTaskQueue.splice(normalizedTargetIndex, 0, movedTask)
  return nextTaskQueue
}

function removeActiveTaskOfKind(
  taskQueue: NavigationQueuedTask[],
  activeTaskIndex: number,
  kind: NavigationTaskKind,
) {
  const normalizedTaskIndex = getNormalizedTaskIndex(taskQueue, activeTaskIndex)
  const activeTask = taskQueue[normalizedTaskIndex] ?? null
  if (!activeTask || activeTask.kind !== kind) {
    return null
  }

  const nextTaskQueue = taskQueue.filter((task) => task.taskId !== activeTask.taskId)
  if (nextTaskQueue.length === 0) {
    return deriveActiveRequests([], 0)
  }

  const nextTaskIndex = normalizedTaskIndex % nextTaskQueue.length
  return deriveActiveRequests(nextTaskQueue, nextTaskIndex)
}

function deriveAdvancedActiveRequests(taskQueue: NavigationQueuedTask[], activeTaskIndex: number) {
  if (taskQueue.length === 0) {
    return deriveActiveRequests([], 0)
  }

  const normalizedTaskIndex = getNormalizedTaskIndex(taskQueue, activeTaskIndex)
  const nextTaskIndex = (normalizedTaskIndex + 1) % taskQueue.length
  return deriveActiveRequests(taskQueue, nextTaskIndex)
}

type NavigationState = {
  activeTaskId: string | null
  activeTaskIndex: number
  advanceTaskQueue: () => NavigationTaskAdvanceResult
  actorAvailable: boolean
  actorWorldPosition: [number, number, number] | null
  enabled: boolean
  followRobotEnabled: boolean
  itemDeleteRequest: NavigationItemDeleteRequest | null
  itemMoveControllers: Partial<Record<ItemNode['id'], NavigationItemMoveController>>
  itemMoveLocked: boolean
  itemMoveRequest: NavigationItemMoveRequest | null
  itemRepairRequest: NavigationItemRepairRequest | null
  moveItemsEnabled: boolean
  moveQueuedTask: (taskId: string, targetIndex: number) => void
  navigationClickSuppressedUntil: number
  queueRestartToken: number
  removeQueuedTask: (taskId: string) => void
  robotMode: NavigationRobotMode | null
  registerItemMoveController: (
    itemId: ItemNode['id'],
    controller: NavigationItemMoveController | null,
  ) => void
  removeQueuedTasksForItem: (kind: NavigationTaskKind, itemId: ItemNode['id']) => void
  reorderQueuedTask: (taskId: string, targetTaskId: string) => void
  requestItemDelete: (request: NavigationItemDeleteRequest | null) => void
  requestItemMove: (request: NavigationItemMoveRequest | null) => void
  requestItemRepair: (request: NavigationItemRepairRequest | null) => void
  setActiveTask: (taskId: string) => void
  setActorAvailable: (actorAvailable: boolean) => void
  setActorWorldPosition: (actorWorldPosition: [number, number, number] | null) => void
  setEnabled: (enabled: boolean) => void
  setRobotMode: (mode: NavigationRobotMode | null) => void
  setWallOverlayFilter: <K extends keyof WallOverlayFilters>(
    key: K,
    value: WallOverlayFilters[K],
  ) => void
  wallOverlayFilters: WallOverlayFilters
  setFollowRobotEnabled: (followRobotEnabled: boolean) => void
  setItemMoveLocked: (locked: boolean) => void
  setMoveItemsEnabled: (enabled: boolean) => void
  setTaskLoopSettledToken: (token: number) => void
  setWalkableOverlayVisible: (walkableOverlayVisible: boolean) => void
  suppressNavigationClick: (durationMs?: number) => void
  taskQueue: NavigationQueuedTask[]
  taskLoopSettledToken: number
  taskLoopToken: number
  walkableOverlayVisible: boolean
}

const useNavigation = create<NavigationState>((set) => ({
  activeTaskId: null,
  activeTaskIndex: 0,
  advanceTaskQueue: () => {
    const result: NavigationTaskAdvanceResult = {
      hasQueuedTask: false,
      wrappedToStart: false,
    }

    set((state) => {
      if (state.taskQueue.length === 0) {
        return state
      }

      const normalizedTaskIndex = getNormalizedTaskIndex(state.taskQueue, state.activeTaskIndex)
      const nextTaskIndex = (normalizedTaskIndex + 1) % state.taskQueue.length
      const wrappedToStart = nextTaskIndex === 0
      const nextState = deriveAdvancedActiveRequests(state.taskQueue, normalizedTaskIndex)
      result.hasQueuedTask = nextState.taskQueue.length > 0
      result.wrappedToStart = wrappedToStart
      return {
        ...nextState,
        taskLoopToken: wrappedToStart ? state.taskLoopToken + 1 : state.taskLoopToken,
      }
    })

    return result
  },
  actorAvailable: false,
  actorWorldPosition: null,
  enabled: false,
  followRobotEnabled: false,
  itemDeleteRequest: null,
  itemMoveControllers: {},
  itemMoveLocked: false,
  itemMoveRequest: null,
  itemRepairRequest: null,
  moveItemsEnabled: false,
  moveQueuedTask: (taskId, targetIndex) =>
    set((state) => {
      const nextTaskQueue = moveTaskToIndex(state.taskQueue, taskId, targetIndex)
      if (!nextTaskQueue) {
        return state
      }

      return deriveRestartedActiveRequests(
        nextTaskQueue,
        state.queueRestartToken,
      )
    }),
  navigationClickSuppressedUntil: 0,
  queueRestartToken: 0,
  removeQueuedTask: (taskId) =>
    set((state) => {
      const nextTaskQueue = state.taskQueue.filter((task) => task.taskId !== taskId)
      if (nextTaskQueue.length === state.taskQueue.length) {
        return state
      }

      return deriveRestartedActiveRequests(
        nextTaskQueue,
        state.queueRestartToken,
      )
    }),
  robotMode: null,
  registerItemMoveController: (itemId, controller) =>
    set((state) => {
      const currentController = state.itemMoveControllers[itemId] ?? null
      if (currentController === controller) {
        return state
      }

      const itemMoveControllers = { ...state.itemMoveControllers }
      if (controller) {
        itemMoveControllers[itemId] = controller
      } else {
        delete itemMoveControllers[itemId]
      }

      return { itemMoveControllers }
    }),
  removeQueuedTasksForItem: (kind, itemId) =>
    set((state) => {
      const nextTaskQueue = state.taskQueue.filter(
        (task) => !(task.kind === kind && task.request.itemId === itemId),
      )
      if (nextTaskQueue.length === state.taskQueue.length) {
        return state
      }

      return deriveRestartedActiveRequests(
        nextTaskQueue,
        state.queueRestartToken,
      )
    }),
  reorderQueuedTask: (taskId, targetTaskId) =>
    set((state) => {
      const targetTaskIndex = state.taskQueue.findIndex((task) => task.taskId === targetTaskId)
      if (taskId === targetTaskId || targetTaskIndex < 0) {
        return state
      }

      const nextTaskQueue = moveTaskToIndex(state.taskQueue, taskId, targetTaskIndex)
      if (!nextTaskQueue) {
        return state
      }

      return deriveRestartedActiveRequests(
        nextTaskQueue,
        state.queueRestartToken,
      )
    }),
  requestItemDelete: (itemDeleteRequest) =>
    set((state) => {
      if (itemDeleteRequest === null) {
        return removeActiveTaskOfKind(state.taskQueue, state.activeTaskIndex, 'delete') ?? state
      }

      const existingTaskIndex = state.taskQueue.findIndex(
        (task) => task.kind === 'delete' && task.request.itemId === itemDeleteRequest.itemId,
      )
      if (existingTaskIndex >= 0) {
        const nextTaskQueue = [...state.taskQueue]
        const existingTask = nextTaskQueue[existingTaskIndex]
        if (!existingTask || existingTask.kind !== 'delete') {
          return state
        }

        nextTaskQueue[existingTaskIndex] = {
          ...existingTask,
          request: cloneNavigationItemDeleteRequest(itemDeleteRequest),
        }
        return deriveRestartedActiveRequests(
          nextTaskQueue,
          state.queueRestartToken,
        )
      }

      return deriveRestartedActiveRequests(
        [
          ...state.taskQueue,
          {
            kind: 'delete',
            request: cloneNavigationItemDeleteRequest(itemDeleteRequest),
            taskId: createNavigationTaskId('delete'),
          },
        ],
        state.queueRestartToken,
      )
    }),
  requestItemMove: (itemMoveRequest) =>
    set((state) => {
      if (itemMoveRequest === null) {
        return removeActiveTaskOfKind(state.taskQueue, state.activeTaskIndex, 'move') ?? state
      }

      const existingTaskIndex = state.taskQueue.findIndex(
        (task) => task.kind === 'move' && task.request.itemId === itemMoveRequest.itemId,
      )
      if (existingTaskIndex >= 0) {
        const nextTaskQueue = [...state.taskQueue]
        const existingTask = nextTaskQueue[existingTaskIndex]
        if (!existingTask || existingTask.kind !== 'move') {
          return state
        }

        nextTaskQueue[existingTaskIndex] = {
          ...existingTask,
          request: cloneNavigationItemMoveRequest(itemMoveRequest),
        }
        return deriveRestartedActiveRequests(
          nextTaskQueue,
          state.queueRestartToken,
        )
      }

      return deriveRestartedActiveRequests(
        [
          ...state.taskQueue,
          {
            kind: 'move',
            request: cloneNavigationItemMoveRequest(itemMoveRequest),
            taskId: createNavigationTaskId('move'),
          },
        ],
        state.queueRestartToken,
      )
    }),
  requestItemRepair: (itemRepairRequest) =>
    set((state) => {
      if (itemRepairRequest === null) {
        return removeActiveTaskOfKind(state.taskQueue, state.activeTaskIndex, 'repair') ?? state
      }

      const existingTaskIndex = state.taskQueue.findIndex(
        (task) => task.kind === 'repair' && task.request.itemId === itemRepairRequest.itemId,
      )
      if (existingTaskIndex >= 0) {
        const nextTaskQueue = [...state.taskQueue]
        const existingTask = nextTaskQueue[existingTaskIndex]
        if (!existingTask || existingTask.kind !== 'repair') {
          return state
        }

        nextTaskQueue[existingTaskIndex] = {
          ...existingTask,
          request: cloneNavigationItemRepairRequest(itemRepairRequest),
        }
        return deriveRestartedActiveRequests(
          nextTaskQueue,
          state.queueRestartToken,
        )
      }

      return deriveRestartedActiveRequests(
        [
          ...state.taskQueue,
          {
            kind: 'repair',
            request: cloneNavigationItemRepairRequest(itemRepairRequest),
            taskId: createNavigationTaskId('repair'),
          },
        ],
        state.queueRestartToken,
      )
    }),
  setActiveTask: (taskId) =>
    set((state) => {
      const nextTaskIndex = state.taskQueue.findIndex((task) => task.taskId === taskId)
      if (nextTaskIndex < 0) {
        return state
      }

      return deriveActiveRequests(state.taskQueue, nextTaskIndex)
    }),
  setActorAvailable: (actorAvailable) => set({ actorAvailable }),
  setActorWorldPosition: (actorWorldPosition) => set({ actorWorldPosition }),
  setEnabled: (enabled) =>
    set((state) => {
      const nextRobotMode = enabled ? (state.robotMode ?? 'task') : null
      navigationVisualsStore.getState().setShowActionShields(false)
      return {
        enabled,
        followRobotEnabled: enabled ? state.followRobotEnabled : false,
        moveItemsEnabled: enabled,
        robotMode: nextRobotMode,
      }
    }),
  setRobotMode: (robotMode) =>
    set((state) => {
      if (state.robotMode === robotMode) {
        return state
      }

      navigationVisualsStore.getState().setShowActionShields(false)
      return {
        enabled: robotMode !== null,
        followRobotEnabled: robotMode !== null ? state.followRobotEnabled : false,
        moveItemsEnabled: robotMode !== null,
        robotMode,
      }
    }),
  setWallOverlayFilter: (key, value) =>
    set((state) => ({
      wallOverlayFilters: {
        ...state.wallOverlayFilters,
        [key]: value,
      },
    })),
  wallOverlayFilters: DEFAULT_WALL_OVERLAY_FILTERS,
  setFollowRobotEnabled: (followRobotEnabled) => set({ followRobotEnabled }),
  setItemMoveLocked: (itemMoveLocked) => set({ itemMoveLocked }),
  setMoveItemsEnabled: (moveItemsEnabled) => set({ moveItemsEnabled }),
  setTaskLoopSettledToken: (taskLoopSettledToken) => set({ taskLoopSettledToken }),
  setWalkableOverlayVisible: (walkableOverlayVisible) => set({ walkableOverlayVisible }),
  suppressNavigationClick: (durationMs = 250) =>
    set({ navigationClickSuppressedUntil: performance.now() + durationMs }),
  taskQueue: [],
  taskLoopSettledToken: 0,
  taskLoopToken: 0,
  walkableOverlayVisible: false,
}))

function canUseRobotItemTask(node: ItemNode) {
  const { enabled, moveItemsEnabled } = useNavigation.getState()
  if (!enabled || !moveItemsEnabled || node.asset.attachTo) {
    return false
  }

  const parentNode = node.parentId ? useScene.getState().nodes[node.parentId as AnyNodeId] : null
  return parentNode?.type !== 'item'
}

export function requestNavigationItemDelete(node: ItemNode) {
  if (!canUseRobotItemTask(node)) {
    return false
  }

  const navigationState = useNavigation.getState()
  const viewerState = useViewer.getState()
  const editorState = useEditor.getState()
  const taskAlreadyAssigned =
    Boolean(navigationVisualsStore.getState().itemDeleteActivations[node.id]) ||
    Boolean(navigationVisualsStore.getState().repairShieldActivations[node.id]) ||
    navigationState.taskQueue.some((task) => task.request.itemId === node.id)

  if (taskAlreadyAssigned) {
    viewerState.setHoveredId(null)
    viewerState.setSelection({ selectedIds: [] })
    return true
  }

  if (editorState.movingNode) {
    return true
  }

  navigationVisualsStore.getState().activateItemDelete(node.id)
  viewerState.setHoveredId(null)
  viewerState.setSelection({ selectedIds: [] })
  navigationState.requestItemDelete({
    itemDimensions: getScaledDimensions(node),
    itemId: node.id,
    levelId: node.parentId,
    sourcePosition: [...node.position] as [number, number, number],
    sourceRotation: [...node.rotation] as [number, number, number],
  })
  return true
}

export function requestNavigationItemRepair(node: ItemNode) {
  if (!canUseRobotItemTask(node)) {
    return false
  }

  const navigationState = useNavigation.getState()
  const viewerState = useViewer.getState()
  const editorState = useEditor.getState()
  const taskAlreadyAssigned =
    Boolean(navigationVisualsStore.getState().repairShieldActivations[node.id]) ||
    Boolean(navigationVisualsStore.getState().itemDeleteActivations[node.id]) ||
    navigationState.taskQueue.some((task) => task.request.itemId === node.id)

  if (taskAlreadyAssigned) {
    viewerState.setHoveredId(null)
    viewerState.setSelection({ selectedIds: [] })
    return true
  }

  if (editorState.movingNode) {
    return true
  }

  navigationVisualsStore.getState().activateRepairShield(node.id)
  viewerState.setHoveredId(null)
  viewerState.setSelection({ selectedIds: [] })
  navigationState.requestItemRepair({
    itemDimensions: getScaledDimensions(node),
    itemId: node.id,
    levelId: node.parentId,
    sourcePosition: [...node.position] as [number, number, number],
    sourceRotation: [...node.rotation] as [number, number, number],
  })
  return true
}

export default useNavigation
