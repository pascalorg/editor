import { defineKind } from '../core/types'

export const frequency = defineKind({
  kind: 'frequency',
  baseUnit: 'Hz',
  units: [
    {
      // Exact-case so `mHz` resolves to millihertz, not megahertz (MHz): a
      // bare case-fold would silently misread it by 10^9. Sloppy all-lowercase
      // `mhz` still reads as megahertz via the case-insensitive MHz alias.
      // No `best` rank — parse-only, never emitted by best-fit formatting.
      id: 'mHz',
      symbol: 'mHz',
      name: 'millihertz',
      plural: 'millihertz',
      caseExact: ['mHz'],
      factor: 1e-3,
      system: 'shared',
    },
    {
      id: 'Hz',
      symbol: 'Hz',
      name: 'hertz',
      plural: 'hertz',
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'kHz',
      symbol: 'kHz',
      name: 'kilohertz',
      plural: 'kilohertz',
      factor: 1000,
      system: 'shared',
      best: 1,
    },
    {
      id: 'MHz',
      symbol: 'MHz',
      name: 'megahertz',
      plural: 'megahertz',
      factor: 1e6,
      system: 'shared',
      best: 2,
    },
    {
      id: 'GHz',
      symbol: 'GHz',
      name: 'gigahertz',
      plural: 'gigahertz',
      factor: 1e9,
      system: 'shared',
      best: 3,
    },
    {
      id: 'THz',
      symbol: 'THz',
      name: 'terahertz',
      plural: 'terahertz',
      factor: 1e12,
      system: 'shared',
      best: 4,
    },
    {
      id: 'rpm',
      symbol: 'rpm',
      name: 'revolution per minute',
      plural: 'revolutions per minute',
      aliases: ['rev/min', 'r/min'],
      factor: 1 / 60,
      system: 'shared',
    },
  ],
} as const)
