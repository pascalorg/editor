import type { AnyNodeId, Interactive, LightEffect, SliderControl } from '@pascal-app/core'
import { create } from 'zustand'

export type LightRegistration = {
  nodeId: AnyNodeId
  effect: LightEffect
  toggleIndex: number
  sliderIndex: number
  sliderMin: number
  sliderMax: number
  hasSlider: boolean
}

type ItemLightPoolStore = {
  registrations: Map<string, LightRegistration>
  register: (key: string, nodeId: AnyNodeId, effect: LightEffect, interactive: Interactive) => void
  unregister: (key: string) => void
}

export const useItemLightPool = create<ItemLightPoolStore>((set) => ({
  registrations: new Map(),

  register: (key, nodeId, effect, interactive) => {
    const toggleIndex = interactive.controls.findIndex((c) => c.kind === 'toggle')
    const sliderIndex = interactive.controls.findIndex((c) => c.kind === 'slider')
    const sliderControl =
      sliderIndex >= 0 ? (interactive.controls[sliderIndex] as SliderControl) : null

    const registration: LightRegistration = {
      nodeId,
      effect,
      toggleIndex,
      sliderIndex,
      hasSlider: sliderControl !== null,
      sliderMin: sliderControl?.min ?? 0,
      sliderMax: sliderControl?.max ?? 1,
    }

    set((s) => {
      const next = new Map(s.registrations)
      next.set(key, registration)
      return { registrations: next }
    })
  },

  unregister: (key) => {
    set((s) => {
      const next = new Map(s.registrations)
      next.delete(key)
      return { registrations: next }
    })
  },
}))
