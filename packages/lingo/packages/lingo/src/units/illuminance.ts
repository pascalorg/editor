import { defineKind } from '../core/types'

export const illuminance = defineKind({
  kind: 'illuminance',
  baseUnit: 'lx',
  units: [
    {
      id: 'lx',
      symbol: 'lx',
      name: 'lux',
      plural: 'lux',
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'klx',
      symbol: 'klx',
      name: 'kilolux',
      plural: 'kilolux',
      factor: 1000,
      system: 'shared',
      best: 1,
    },
    {
      id: 'fc',
      symbol: 'fc',
      name: 'foot-candle',
      plural: 'foot-candles',
      aliases: ['foot candle', 'foot candles'],
      factor: 10.763_910_416_709_722,
      system: 'imperial',
    },
  ],
} as const)
