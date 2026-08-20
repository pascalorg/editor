import { defineKind } from '../core/types'

export const energy = defineKind({
  kind: 'energy',
  baseUnit: 'J',
  units: [
    {
      // Exact-case so `mJ` resolves to millijoule, not megajoule (MJ): a bare
      // case-fold would silently misread it by 10^9. No `best` rank —
      // parse-only, never emitted by best-fit formatting.
      id: 'mJ',
      symbol: 'mJ',
      name: 'millijoule',
      caseExact: ['mJ'],
      factor: 1e-3,
      system: 'shared',
    },
    {
      id: 'J',
      symbol: 'J',
      name: 'joule',
      factor: 1,
      system: 'shared',
      best: 0,
    },
    {
      id: 'kJ',
      symbol: 'kJ',
      name: 'kilojoule',
      factor: 1000,
      system: 'shared',
      best: 1,
    },
    {
      id: 'MJ',
      symbol: 'MJ',
      name: 'megajoule',
      factor: 1e6,
      system: 'shared',
    },
    {
      id: 'cal',
      symbol: 'cal',
      name: 'calorie',
      factor: 4.184,
      system: 'shared',
    },
    {
      id: 'kcal',
      symbol: 'kcal',
      name: 'kilocalorie',
      factor: 4184,
      system: 'shared',
      // Food Calories: capital C means kcal (lowercase 'calories' stays the
      // small thermochemical calorie).
      caseExact: ['Cal', 'Cals', 'Calorie', 'Calories'],
    },
    {
      id: 'BTU',
      symbol: 'BTU',
      name: 'British thermal unit',
      aliases: ['btu', 'british thermal units'],
      factor: 1055.055_852_62,
      system: 'imperial',
    },
    {
      id: 'eV',
      symbol: 'eV',
      name: 'electronvolt',
      aliases: ['electron volt', 'electron volts'],
      factor: 1.602_176_634e-19,
      system: 'shared',
    },
    {
      // Exact-case so `mWh` resolves to milliwatt-hour, not megawatt-hour
      // (MWh): a bare case-fold would silently misread small energy-harvesting
      // budgets by 10^9. No `best` rank — parse-only.
      id: 'mWh',
      symbol: 'mWh',
      name: 'milliwatt hour',
      aliases: ['milliwatt-hour', 'milliwatt hours', 'milliwatt-hours'],
      caseExact: ['mWh'],
      factor: 3.6,
      system: 'shared',
    },
    {
      id: 'Wh',
      symbol: 'Wh',
      name: 'watt hour',
      aliases: ['watt-hour', 'watt hours', 'watt-hours'],
      factor: 3600,
      system: 'shared',
    },
    {
      id: 'kWh',
      symbol: 'kWh',
      name: 'kilowatt hour',
      aliases: ['kilowatt-hour', 'kilowatt hours', 'kilowatt-hours'],
      factor: 3.6e6,
      system: 'shared',
      best: 2,
    },
    {
      id: 'MWh',
      symbol: 'MWh',
      name: 'megawatt hour',
      aliases: ['megawatt-hour', 'megawatt hours', 'megawatt-hours'],
      factor: 3.6e9,
      system: 'shared',
    },
  ],
} as const)
