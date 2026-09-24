import {
  type AnyNodeId,
  type Interactive,
  type LightEffect,
  type SliderControl,
  sceneRegistry,
  useInteractive,
} from '@pascal-app/core'
import type { Vector3 } from 'three'
import { create } from 'zustand'

export type LightSource = {
  key: string
  nodeId: AnyNodeId
  color: string
  distance: number
  getWorldPosition: (out: Vector3) => boolean
  getIntensity: () => number
  isEligible: () => boolean
}

export function catalogLightSource(
  key: string,
  nodeId: AnyNodeId,
  effect: LightEffect,
  interactive: Interactive,
): LightSource {
  const toggleIndex = interactive.controls.findIndex((control) => control.kind === 'toggle')
  const sliderIndex = interactive.controls.findIndex((control) => control.kind === 'slider')
  const slider = sliderIndex >= 0 ? (interactive.controls[sliderIndex] as SliderControl) : null
  return {
    key,
    nodeId,
    color: effect.color,
    distance: effect.distance ?? 0,
    getWorldPosition: (out) => {
      const object = sceneRegistry.nodes.get(nodeId)
      if (!object) return false
      object.getWorldPosition(out)
      out.set(out.x + effect.offset[0], out.y + effect.offset[1], out.z + effect.offset[2])
      return true
    },
    getIntensity: () => {
      const values = useInteractive.getState().items[nodeId]?.controlValues
      if (toggleIndex >= 0 && !values?.[toggleIndex]) return effect.intensityRange[0]
      const raw = slider ? ((values?.[sliderIndex] as number) ?? slider.min) : 1
      const fraction =
        slider && slider.max > slider.min ? (raw - slider.min) / (slider.max - slider.min) : 1
      return (
        effect.intensityRange[0] + (effect.intensityRange[1] - effect.intensityRange[0]) * fraction
      )
    },
    isEligible: () => {
      const values = useInteractive.getState().items[nodeId]?.controlValues
      return toggleIndex < 0 || Boolean(values?.[toggleIndex])
    },
  }
}

type ItemLightPoolStore = {
  registrations: Map<string, LightSource>
  register: (source: LightSource) => void
  unregister: (key: string) => void
}

export const useItemLightPool = create<ItemLightPoolStore>((set) => ({
  registrations: new Map(),
  register: (source) =>
    set((state) => ({ registrations: new Map(state.registrations).set(source.key, source) })),
  unregister: (key) =>
    set((state) => {
      const registrations = new Map(state.registrations)
      registrations.delete(key)
      return { registrations }
    }),
}))
