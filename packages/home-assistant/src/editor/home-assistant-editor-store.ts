'use client'

import type { AnyNodeId } from '@pascal-app/core'
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
  type SmartHomeOverlayVisibility,
} from '../types'

type HomeAssistantEditorState = {
  controlItemId: string | null
  isPanelOpen: boolean
  overlayVisibility: SmartHomeOverlayVisibility
  pairingResourceId: string | null
  pairingTargetItemId: AnyNodeId | null
}

type HomeAssistantEditorStore = HomeAssistantEditorState & {
  setControlItemId: (id: string | null) => void
  setOverlaySectionVisible: (
    section: keyof SmartHomeOverlayVisibility,
    visible: boolean,
  ) => void
  setPairingResourceId: (id: string | null) => void
  setPairingTargetItemId: (id: AnyNodeId | null) => void
  setPanelOpen: (open: boolean) => void
  subscribe: (listener: () => void) => () => void
}

let state: HomeAssistantEditorState = {
  controlItemId: null,
  isPanelOpen: false,
  overlayVisibility: DEFAULT_SMART_HOME_OVERLAY_VISIBILITY,
  pairingResourceId: null,
  pairingTargetItemId: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function setState(patch: Partial<HomeAssistantEditorState>) {
  state = { ...state, ...patch }
  emit()
}

export const homeAssistantEditorStore: HomeAssistantEditorStore = {
  get controlItemId() {
    return state.controlItemId
  },
  get isPanelOpen() {
    return state.isPanelOpen
  },
  get overlayVisibility() {
    return state.overlayVisibility
  },
  get pairingResourceId() {
    return state.pairingResourceId
  },
  get pairingTargetItemId() {
    return state.pairingTargetItemId
  },
  setControlItemId: (controlItemId) => setState({ controlItemId }),
  setOverlaySectionVisible: (section, visible) => {
    if (state.overlayVisibility[section] === visible) {
      return
    }
    setState({
      overlayVisibility: {
        ...state.overlayVisibility,
        [section]: visible,
      },
    })
  },
  setPairingResourceId: (pairingResourceId) => setState({ pairingResourceId }),
  setPairingTargetItemId: (pairingTargetItemId) => setState({ pairingTargetItemId }),
  setPanelOpen: (isPanelOpen) => setState({ isPanelOpen }),
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useHomeAssistantEditorStore<T>(
  selector: (store: HomeAssistantEditorStore) => T,
) {
  return useSyncExternalStore(
    homeAssistantEditorStore.subscribe,
    () => selector(homeAssistantEditorStore),
    () => selector(homeAssistantEditorStore),
  )
}
