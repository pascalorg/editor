import { defineKind } from '../core/types'

export const torque = defineKind({
  kind: 'torque',
  baseUnit: 'N*m',
  units: [
    {
      id: 'N*m',
      symbol: 'N⋅m',
      name: 'newton meter',
      aliases: ['N m', 'N*m', 'N·m', 'newton metre', 'newton metres'],
      caseExact: ['Nm'],
      factor: 1,
      system: 'shared',
      best: 1,
    },
    {
      id: 'kN*m',
      symbol: 'kN⋅m',
      name: 'kilonewton meter',
      aliases: ['kN m', 'kN*m', 'kN·m', 'kilonewton metre', 'kilonewton metres'],
      caseExact: ['kNm'],
      factor: 1000,
      system: 'shared',
      best: 2,
    },
    {
      id: 'lbf*ft',
      symbol: 'lbf⋅ft',
      name: 'pound-force foot',
      plural: 'pounds-force foot',
      aliases: ['lbf ft', 'lbf*ft', 'lbf·ft', 'lb-ft', 'pound force foot', 'pounds force foot'],
      factor: 4.448_221_615_260_5 * 0.3048,
      system: 'imperial',
      best: 0,
    },
  ],
} as const)
