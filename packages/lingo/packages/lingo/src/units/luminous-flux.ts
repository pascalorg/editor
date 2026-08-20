import { defineKind } from '../core/types'

export const luminousFlux = defineKind({
  kind: 'luminous_flux',
  baseUnit: 'lm',
  units: [
    {
      id: 'lm',
      symbol: 'lm',
      name: 'lumen',
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'klm',
      symbol: 'klm',
      name: 'kilolumen',
      factor: 1000,
      system: 'shared',
      best: 1,
    },
  ],
} as const)
