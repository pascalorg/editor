import type { BaseNode, ItemMoveVisualState } from '@pascal-app/core'
import type {
  ViewerRuntimeItemDeleteActivation,
  ViewerRuntimeItemMovePreview,
  ViewerRuntimePostWarmupScope,
  ViewerRuntimeState,
} from '@pascal-app/viewer'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type ToolConeIsolatedOverlayPoint = {
  isApex: boolean
  worldPoint: [number, number, number]
}

export type ToolConeIsolatedOverlay = {
  apexWorldPoint?: [number, number, number] | null
  color?: string | null
  hullPoints: ToolConeIsolatedOverlayPoint[]
  supportWorldPoints?: Array<[number, number, number]>
  visible: boolean
}

export type ToolConeOverlayCamera = {
  position: [number, number, number]
  projectionMatrix: number[]
  projectionMatrixInverse: number[]
  quaternion: [number, number, number, number]
}

type NavigationVisualState = ViewerRuntimeState & {
  activateItemDelete: (id: BaseNode['id']) => void
  beginItemDeleteFade: (id: BaseNode['id'], startedAtMs?: number) => void
  clearItemDelete: (id?: BaseNode['id'] | null) => void
  registerTaskPreviewNode: (id: string) => void
  resetTaskQueueVisuals: () => void
  setItemMovePreview: (preview: ViewerRuntimeItemMovePreview | null) => void
  setItemMoveVisualState: (id: BaseNode['id'], state: ItemMoveVisualState | null) => void
  setNodeVisibilityOverride: (id: BaseNode['id'], visible: boolean | null) => void
  setToolConeIsolatedOverlay: (overlay: ToolConeIsolatedOverlay | null) => void
  setToolConeOverlayCamera: (camera: ToolConeOverlayCamera | null) => void
  setToolConeOverlayEnabled: (enabled: boolean) => void
  setToolConeOverlayWarmupReady: (ready: boolean) => void
  taskPreviewNodeIds: Record<string, true>
  toolConeIsolatedOverlay: ToolConeIsolatedOverlay | null
  toolConeOverlayCamera: ToolConeOverlayCamera | null
  toolConeOverlayEnabled: boolean
  toolConeOverlayWarmupReady: boolean
  unregisterTaskPreviewNode: (id?: string | null) => void
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const navigationVisualsStore = createStore<NavigationVisualState>()((set) => ({
  activateItemDelete: (id) =>
    set((state) => ({
      itemDeleteActivations: {
        ...state.itemDeleteActivations,
        [id]: {
          fadeStartedAtMs: null,
          startedAtMs: now(),
        },
      },
    })),
  beginItemDeleteFade: (id, startedAtMs) =>
    set((state) => {
      const activation = state.itemDeleteActivations[id]
      if (!activation || activation.fadeStartedAtMs !== null) {
        return state
      }

      return {
        itemDeleteActivations: {
          ...state.itemDeleteActivations,
          [id]: {
            ...activation,
            fadeStartedAtMs: startedAtMs ?? now(),
          },
        },
      }
    }),
  clearItemDelete: (id) =>
    set((state) => {
      if (!id) {
        return Object.keys(state.itemDeleteActivations).length === 0
          ? state
          : { itemDeleteActivations: {} }
      }

      if (!state.itemDeleteActivations[id]) {
        return state
      }

      const itemDeleteActivations = { ...state.itemDeleteActivations }
      delete itemDeleteActivations[id]
      return { itemDeleteActivations }
    }),
  registerTaskPreviewNode: (id) =>
    set((state) =>
      state.taskPreviewNodeIds[id]
        ? state
        : {
            taskPreviewNodeIds: {
              ...state.taskPreviewNodeIds,
              [id]: true,
            },
          },
    ),
  resetTaskQueueVisuals: () =>
    set((state) => {
      const nextItemMoveVisualStates: Partial<Record<BaseNode['id'], ItemMoveVisualState>> = {}
      let removedPendingMoveVisual = false

      for (const [itemId, visualState] of Object.entries(state.itemMoveVisualStates)) {
        if (visualState === 'copy-source-pending' || visualState === 'source-pending') {
          removedPendingMoveVisual = true
          continue
        }

        nextItemMoveVisualStates[itemId as BaseNode['id']] = visualState
      }

      const hasTaskQueueVisuals =
        state.itemMovePreview !== null ||
        Object.keys(state.itemDeleteActivations).length > 0 ||
        Object.keys(state.taskPreviewNodeIds).length > 0 ||
        removedPendingMoveVisual

      if (!hasTaskQueueVisuals) {
        return state
      }

      return {
        itemDeleteActivations: {},
        itemMovePreview: null,
        itemMoveVisualStates: nextItemMoveVisualStates,
        taskPreviewNodeIds: {},
      }
    }),
  completeNavigationPostWarmup: (token) =>
    set((state) =>
      token <= state.navigationPostWarmupCompletedToken
        ? state
        : { navigationPostWarmupCompletedToken: token },
    ),
  itemDeleteActivations: {} as Partial<Record<BaseNode['id'], ViewerRuntimeItemDeleteActivation>>,
  itemMovePreview: null,
  itemMoveVisualStates: {} as Partial<Record<BaseNode['id'], ItemMoveVisualState>>,
  navigationPostWarmupCompletedToken: 0,
  navigationPostWarmupRequestToken: 0,
  navigationPostWarmupScope: null as ViewerRuntimePostWarmupScope,
  nodeVisibilityOverrides: {} as Partial<Record<BaseNode['id'], boolean>>,
  requestNavigationPostWarmup: () => {
    let nextToken = 0
    set((state) => {
      nextToken = state.navigationPostWarmupRequestToken + 1
      return { navigationPostWarmupRequestToken: nextToken }
    })
    return nextToken
  },
  setItemMovePreview: (itemMovePreview) => set({ itemMovePreview }),
  setItemMoveVisualState: (id, state) =>
    set((currentState) => {
      const currentValue = currentState.itemMoveVisualStates[id]
      if ((currentValue ?? null) === state) {
        return currentState
      }

      const itemMoveVisualStates = { ...currentState.itemMoveVisualStates }
      if (state) {
        itemMoveVisualStates[id] = state
      } else {
        delete itemMoveVisualStates[id]
      }

      return { itemMoveVisualStates }
    }),
  setNavigationPostWarmupScope: (navigationPostWarmupScope) => set({ navigationPostWarmupScope }),
  setNodeVisibilityOverride: (id, visible) =>
    set((currentState) => {
      const currentValue = currentState.nodeVisibilityOverrides[id]
      if ((currentValue ?? null) === visible) {
        return currentState
      }

      const nodeVisibilityOverrides = { ...currentState.nodeVisibilityOverrides }
      if (visible === null) {
        delete nodeVisibilityOverrides[id]
      } else {
        nodeVisibilityOverrides[id] = visible
      }

      return { nodeVisibilityOverrides }
    }),
  setToolConeIsolatedOverlay: (toolConeIsolatedOverlay) => set({ toolConeIsolatedOverlay }),
  setToolConeOverlayCamera: (toolConeOverlayCamera) => set({ toolConeOverlayCamera }),
  setToolConeOverlayEnabled: (toolConeOverlayEnabled) => set({ toolConeOverlayEnabled }),
  setToolConeOverlayWarmupReady: (toolConeOverlayWarmupReady) =>
    set({ toolConeOverlayWarmupReady }),
  taskPreviewNodeIds: {},
  toolConeIsolatedOverlay: null,
  toolConeOverlayCamera: null,
  toolConeOverlayEnabled: false,
  toolConeOverlayWarmupReady: false,
  unregisterTaskPreviewNode: (id) =>
    set((state) => {
      if (!id || !state.taskPreviewNodeIds[id]) {
        return state
      }

      const taskPreviewNodeIds = { ...state.taskPreviewNodeIds }
      delete taskPreviewNodeIds[id]
      return { taskPreviewNodeIds }
    }),
}))

export function useNavigationVisuals<T>(selector: (state: NavigationVisualState) => T): T {
  return useStore(navigationVisualsStore, selector)
}

export default navigationVisualsStore
