'use client'

import { create } from 'zustand'
import type { ItemNode } from '../schema/nodes/item'

// Runtime value for each control (matches discriminated union kinds)
export type ControlValue = boolean | number

export type ItemInteractiveState = {
  // Indexed by control position in asset.interactive.controls[]
  controlValues: ControlValue[]
}

type InteractiveStore = {
  items: Record<string, ItemInteractiveState>

  /** Initialize an item's interactive state from its asset definition (idempotent) */
  initItem: (node: ItemNode) => void

  /** Set a single control value */
  setControlValue: (itemId: string, index: number, value: ControlValue) => void

  /** Remove an item's state (e.g. on unmount) */
  removeItem: (itemId: string) => void
}

const defaultControlValue = (node: ItemNode, index: number): ControlValue => {
  const control = node.asset.interactive?.controls[index]
  if (!control) return false
  switch (control.kind) {
    case 'toggle':
      return false
    case 'slider':
      return control.min
    case 'temperature':
      return control.min
  }
}

export const useInteractive = create<InteractiveStore>((set, get) => ({
  items: {},

  initItem: (node) => {
    const controls = node.asset.interactive?.controls ?? []
    if (controls.length === 0) return

    // Don't overwrite existing state (idempotent)
    if (get().items[node.id]) return

    set((state) => ({
      items: {
        ...state.items,
        [node.id]: {
          controlValues: controls.map((_, i) => defaultControlValue(node, i)),
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
}))
