import { defineKind } from '../core/types'

export const percent = defineKind({
  kind: 'percent',
  baseUnit: '%',
  units: [
    {
      id: '%',
      symbol: '%',
      name: 'percent',
      plural: 'percent',
      aliases: ['pct', 'per cent', 'percentage point', 'percentage points'],
      factor: 1,
      system: 'shared',
      intl: 'percent',
    },
    {
      id: '‰',
      symbol: '‰',
      name: 'permille',
      aliases: ['per mille'],
      factor: 0.1,
      system: 'shared',
    },
    {
      id: 'bps',
      symbol: 'bps',
      name: 'basis point',
      plural: 'basis points',
      aliases: ['bp'],
      factor: 0.01,
      system: 'shared',
    },
  ],
} as const)

// "percentage points" and basis points added 2026-07-04 (owner directive; finance
// tools speak in pct/pp/bps). No unit elsewhere claims "bps" — bits-per-second
// lives under data/speed vocabularies, which never registered it. Bare "no."
// remains excluded: it is not a percent unit.
