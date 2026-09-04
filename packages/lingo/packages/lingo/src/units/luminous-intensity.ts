import { defineKind } from '../core/types'

export const luminousIntensity = defineKind({
  kind: 'luminous_intensity',
  baseUnit: 'cd',
  units: [
    {
      id: 'mcd',
      symbol: 'mcd',
      name: 'millicandela',
      plural: 'millicandelas',
      factor: 1e-3,
      system: 'shared',
      best: 0,
    },
    {
      id: 'cd',
      symbol: 'cd',
      name: 'candela',
      plural: 'candelas',
      factor: 1,
      system: 'shared',
      best: 1,
    },
    {
      id: 'kcd',
      symbol: 'kcd',
      name: 'kilocandela',
      plural: 'kilocandelas',
      factor: 1000,
      system: 'shared',
      best: 2,
    },
  ],
} as const)
