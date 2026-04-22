import type { BaseNode, ItemMoveVisualState } from '@pascal-app/core'
import type {
  ViewerRuntimeItemDeleteActivation,
  ViewerRuntimeItemMovePreview,
  ViewerRuntimePostWarmupScope,
  ViewerRuntimeRepairShieldActivation,
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
  activateRepairShield: (id: BaseNode['id']) => void
  actionShieldKinds: Partial<Record<BaseNode['id'], 'copy' | 'delete' | 'move' | 'repair'>>
  actionShieldOpacities: Partial<Record<BaseNode['id'], number>>
  beginItemDeleteFade: (id: BaseNode['id'], startedAtMs?: number) => void
  clearItemDelete: (id?: BaseNode['id'] | null) => void
  clearRepairShield: (id?: BaseNode['id'] | null) => void
  resetTaskQueueVisuals: () => void
  setActionShieldKind: (
    id: BaseNode['id'],
    kind: 'copy' | 'delete' | 'move' | 'repair' | null,
  ) => void
  setActionShieldOpacity: (id: BaseNode['id'], opacity: number | null) => void
  setItemMovePreview: (preview: ViewerRuntimeItemMovePreview | null) => void
  setItemMoveVisualState: (id: BaseNode['id'], state: ItemMoveVisualState | null) => void
  setNodeVisibilityOverride: (id: BaseNode['id'], visible: boolean | null) => void
  setShowActionShields: (showActionShields: boolean) => void
  setToolConeIsolatedOverlay: (overlay: ToolConeIsolatedOverlay | null) => void
  setToolConeOverlayCamera: (camera: ToolConeOverlayCamera | null) => void
  setToolConeOverlayEnabled: (enabled: boolean) => void
  setToolConeOverlayWarmupReady: (ready: boolean) => void
  toolConeIsolatedOverlay: ToolConeIsolatedOverlay | null
  toolConeOverlayCamera: ToolConeOverlayCamera | null
  toolConeOverlayEnabled: boolean
  toolConeOverlayWarmupReady: boolean
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
  activateRepairShield: (id) =>
    set((state) => ({
      repairShieldActivations: {
        ...state.repairShieldActivations,
        [id]: {
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
  clearRepairShield: (id) =>
    set((state) => {
      if (!id) {
        return Object.keys(state.repairShieldActivations).length === 0
          ? state
          : { repairShieldActivations: {} }
      }

      if (!state.repairShieldActivations[id]) {
        return state
      }

      const repairShieldActivations = { ...state.repairShieldActivations }
      delete repairShieldActivations[id]
      return { repairShieldActivations }
    }),
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
        Object.keys(state.repairShieldActivations).length > 0 ||
        Object.keys(state.actionShieldKinds).length > 0 ||
        Object.keys(state.actionShieldOpacities).length > 0 ||
        removedPendingMoveVisual

      if (!hasTaskQueueVisuals) {
        return state
      }

      return {
        actionShieldKinds: {},
        actionShieldOpacities: {},
        itemDeleteActivations: {},
        itemMovePreview: null,
        itemMoveVisualStates: nextItemMoveVisualStates,
        repairShieldActivations: {},
      }
    }),
  actionShieldKinds: {},
  actionShieldOpacities: {},
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
  repairShieldActivations: {} as Partial<
    Record<BaseNode['id'], ViewerRuntimeRepairShieldActivation>
  >,
  requestNavigationPostWarmup: () => {
    let nextToken = 0
    set((state) => {
      nextToken = state.navigationPostWarmupRequestToken + 1
      return { navigationPostWarmupRequestToken: nextToken }
    })
    return nextToken
  },
  setActionShieldKind: (id, kind) =>
    set((currentState) => {
      const currentValue = currentState.actionShieldKinds[id]
      if ((currentValue ?? null) === kind) {
        return currentState
      }

      const actionShieldKinds = { ...currentState.actionShieldKinds }
      if (kind === null) {
        delete actionShieldKinds[id]
      } else {
        actionShieldKinds[id] = kind
      }

      return { actionShieldKinds }
    }),
  setActionShieldOpacity: (id, opacity) =>
    set((currentState) => {
      const currentValue = currentState.actionShieldOpacities[id]
      if ((currentValue ?? null) === opacity) {
        return currentState
      }

      const actionShieldOpacities = { ...currentState.actionShieldOpacities }
      if (opacity === null) {
        delete actionShieldOpacities[id]
      } else {
        actionShieldOpacities[id] = opacity
      }

      return { actionShieldOpacities }
    }),
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
  setShowActionShields: (showActionShields) => set({ showActionShields }),
  setToolConeIsolatedOverlay: (toolConeIsolatedOverlay) => set({ toolConeIsolatedOverlay }),
  setToolConeOverlayCamera: (toolConeOverlayCamera) => set({ toolConeOverlayCamera }),
  setToolConeOverlayEnabled: (toolConeOverlayEnabled) => set({ toolConeOverlayEnabled }),
  setToolConeOverlayWarmupReady: (toolConeOverlayWarmupReady) =>
    set({ toolConeOverlayWarmupReady }),
  showActionShields: false,
  toolConeIsolatedOverlay: null,
  toolConeOverlayCamera: null,
  toolConeOverlayEnabled: false,
  toolConeOverlayWarmupReady: false,
}))

export function useNavigationVisuals<T>(selector: (state: NavigationVisualState) => T): T {
  return useStore(navigationVisualsStore, selector)
}

export default navigationVisualsStore
