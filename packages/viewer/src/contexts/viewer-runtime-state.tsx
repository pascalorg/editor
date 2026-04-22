import type { BaseNode, ItemMoveVisualState, ItemNode } from '@pascal-app/core'
import { createContext, type ReactNode, useContext } from 'react'
import { type StoreApi, useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type ViewerRuntimeItemMovePreview = {
  id: ItemNode['id']
  sourceItemId: ItemNode['id']
}

export type ViewerRuntimeRepairShieldActivation = {
  startedAtMs: number
}

export type ViewerRuntimeItemDeleteActivation = {
  fadeStartedAtMs: number | null
  startedAtMs: number
}

export type ViewerRuntimePostWarmupScope =
  | ((run: () => void | Promise<void>) => boolean | Promise<boolean>)
  | null

export type ViewerRuntimeState = {
  actionShieldKinds: Partial<Record<BaseNode['id'], 'copy' | 'delete' | 'move' | 'repair'>>
  actionShieldOpacities: Partial<Record<BaseNode['id'], number>>
  completeNavigationPostWarmup: (token: number) => void
  itemDeleteActivations: Partial<Record<BaseNode['id'], ViewerRuntimeItemDeleteActivation>>
  itemMovePreview: ViewerRuntimeItemMovePreview | null
  itemMoveVisualStates: Partial<Record<BaseNode['id'], ItemMoveVisualState>>
  navigationPostWarmupCompletedToken: number
  navigationPostWarmupRequestToken: number
  navigationPostWarmupScope: ViewerRuntimePostWarmupScope
  nodeVisibilityOverrides: Partial<Record<BaseNode['id'], boolean>>
  repairShieldActivations: Partial<Record<BaseNode['id'], ViewerRuntimeRepairShieldActivation>>
  requestNavigationPostWarmup: () => number
  setNavigationPostWarmupScope: (scope: ViewerRuntimePostWarmupScope) => void
  showActionShields: boolean
}

const EMPTY_VIEWER_RUNTIME_STATE: ViewerRuntimeState = {
  actionShieldKinds: {},
  actionShieldOpacities: {},
  completeNavigationPostWarmup: () => {},
  itemDeleteActivations: {},
  itemMovePreview: null,
  itemMoveVisualStates: {},
  navigationPostWarmupCompletedToken: 0,
  navigationPostWarmupRequestToken: 0,
  navigationPostWarmupScope: null,
  nodeVisibilityOverrides: {},
  repairShieldActivations: {},
  requestNavigationPostWarmup: () => 0,
  setNavigationPostWarmupScope: () => {},
  showActionShields: false,
}

const emptyViewerRuntimeStateStore = createStore<ViewerRuntimeState>(
  () => EMPTY_VIEWER_RUNTIME_STATE,
)

const ViewerRuntimeStateContext = createContext<StoreApi<ViewerRuntimeState> | null>(null)

export function ViewerRuntimeStateProvider({
  children,
  store,
}: {
  children: ReactNode
  store: StoreApi<ViewerRuntimeState>
}) {
  return (
    <ViewerRuntimeStateContext.Provider value={store}>
      {children}
    </ViewerRuntimeStateContext.Provider>
  )
}

export function useViewerRuntimeState<T>(selector: (state: ViewerRuntimeState) => T): T {
  const store = useContext(ViewerRuntimeStateContext)
  return useStore(store ?? emptyViewerRuntimeStateStore, selector)
}
