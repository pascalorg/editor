'use client'

import { create } from 'zustand'
import type { Interactive } from '../schema/nodes/item'
import type { AnyNodeId } from '../schema/types'

// Runtime value for each control (matches discriminated union kinds)
export type ControlValue = boolean | number

export type ItemInteractiveState = {
  // Indexed by control position in asset.interactive.controls[]
  controlValues: ControlValue[]
}

export type DoorInteractiveState = {
  operationState?: number
  swingAngle?: number
}

export type DoorAnimationState = {
  field: keyof DoorInteractiveState
  from: number
  to: number
  startedAt: number | null
  durationMs: number
  persist: boolean
}

export type WindowInteractiveState = {
  operationState?: number
}

export type WindowAnimationState = {
  field: keyof WindowInteractiveState
  from: number
  to: number
  startedAt: number | null
  durationMs: number
  persist: boolean
}

type InteractiveStore = {
  items: Record<AnyNodeId, ItemInteractiveState>
  doors: Record<AnyNodeId, DoorInteractiveState>
  doorAnimations: Record<AnyNodeId, DoorAnimationState>
  windows: Record<AnyNodeId, WindowInteractiveState>
  windowAnimations: Record<AnyNodeId, WindowAnimationState>

  /** Initialize a node's interactive state from its asset definition (idempotent) */
  initItem: (itemId: AnyNodeId, interactive: Interactive) => void

  /** Set a single control value */
  setControlValue: (itemId: AnyNodeId, index: number, value: ControlValue) => void

  /** Remove a node's state (e.g. on unmount) */
  removeItem: (itemId: AnyNodeId) => void

  /** Set transient door open state without committing it to the scene node */
  setDoorOpenState: (doorId: AnyNodeId, value: DoorInteractiveState) => void

  /** Clear transient door open state */
  removeDoorOpenState: (doorId: AnyNodeId) => void

  /** Queue a door animation for the viewer frame loop */
  startDoorAnimation: (doorId: AnyNodeId, value: DoorAnimationState) => void

  /** Cancel a queued door animation */
  cancelDoorAnimation: (doorId: AnyNodeId) => void

  /** Set transient window open state without committing it to the scene node */
  setWindowOpenState: (windowId: AnyNodeId, value: WindowInteractiveState) => void

  /** Clear transient window open state */
  removeWindowOpenState: (windowId: AnyNodeId) => void

  /** Queue a window animation for the viewer frame loop */
  startWindowAnimation: (windowId: AnyNodeId, value: WindowAnimationState) => void

  /** Cancel a queued window animation */
  cancelWindowAnimation: (windowId: AnyNodeId) => void
}

const defaultControlValue = (interactive: Interactive, index: number): ControlValue => {
  const control = interactive.controls[index]
  if (!control) return false
  switch (control.kind) {
    case 'toggle':
      return control.default ?? false
    case 'slider':
      return control.default ?? control.min
    case 'temperature':
      return control.default ?? control.min
  }
}

export const useInteractive = create<InteractiveStore>((set, get) => ({
  items: {},
  doors: {},
  doorAnimations: {},
  windows: {},
  windowAnimations: {},

  initItem: (itemId, interactive) => {
    const { controls } = interactive
    if (controls.length === 0) return

    // Don't overwrite existing state (idempotent)
    if (get().items[itemId]) return

    set((state) => ({
      items: {
        ...state.items,
        [itemId]: {
          controlValues: controls.map((_, i) => defaultControlValue(interactive, i)),
        },
      },
    }))
  },

  setControlValue: (itemId, index, value) => {
    set((state) => {
      const item = state.items[itemId]
      if (!item) return state
      const next = [...item.controlValues]
      next[index] = value
      return { items: { ...state.items, [itemId]: { controlValues: next } } }
    })
  },

  removeItem: (itemId) => {
    set((state) => {
      const { [itemId]: _, ...rest } = state.items
      return { items: rest }
    })
  },

  setDoorOpenState: (doorId, value) => {
    set((state) => ({
      doors: {
        ...state.doors,
        [doorId]: {
          ...state.doors[doorId],
          ...value,
        },
      },
    }))
  },

  removeDoorOpenState: (doorId) => {
    set((state) => {
      const { [doorId]: _, ...rest } = state.doors
      return { doors: rest }
    })
  },

  startDoorAnimation: (doorId, value) => {
    set((state) => ({
      doorAnimations: {
        ...state.doorAnimations,
        [doorId]: value,
      },
    }))
  },

  cancelDoorAnimation: (doorId) => {
    set((state) => {
      const { [doorId]: _, ...rest } = state.doorAnimations
      return { doorAnimations: rest }
    })
  },

  setWindowOpenState: (windowId, value) => {
    set((state) => ({
      windows: {
        ...state.windows,
        [windowId]: {
          ...state.windows[windowId],
          ...value,
        },
      },
    }))
  },

  removeWindowOpenState: (windowId) => {
    set((state) => {
      const { [windowId]: _, ...rest } = state.windows
      return { windows: rest }
    })
  },

  startWindowAnimation: (windowId, value) => {
    set((state) => ({
      windowAnimations: {
        ...state.windowAnimations,
        [windowId]: value,
      },
    }))
  },

  cancelWindowAnimation: (windowId) => {
    set((state) => {
      const { [windowId]: _, ...rest } = state.windowAnimations
      return { windowAnimations: rest }
    })
  },
}))
