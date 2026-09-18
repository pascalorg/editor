import type { PipeSegmentNode } from '@pascal-app/core'

export type PipePreset = {
  id: string
  label: string
  system: PipeSegmentNode['system']
  pipeMaterial: PipeSegmentNode['pipeMaterial']
  diameter: number
  sloped: boolean
}

export const PIPE_PRESETS: readonly PipePreset[] = [
  {
    id: 'pvc-waste',
    label: 'Waste · PVC · sloped',
    system: 'waste',
    pipeMaterial: 'pvc',
    diameter: 2,
    sloped: true,
  },
  {
    id: 'abs-waste',
    label: 'Waste · ABS · sloped',
    system: 'waste',
    pipeMaterial: 'abs',
    diameter: 2,
    sloped: true,
  },
  {
    id: 'cast-iron-waste',
    label: 'Waste · cast iron · sloped',
    system: 'waste',
    pipeMaterial: 'cast-iron',
    diameter: 3,
    sloped: true,
  },
  {
    id: 'pvc-vent',
    label: 'Vent · PVC · level',
    system: 'vent',
    pipeMaterial: 'pvc',
    diameter: 2,
    sloped: false,
  },
]
