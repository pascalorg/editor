import type { HvacEquipmentNode } from './schema'

export const HVAC_PRESETS = {
  furnace: { name: 'Furnace', width: 0.56, depth: 0.71, height: 1.1 },
  'air-handler': { name: 'Air handler', width: 0.6, depth: 0.65, height: 1.5 },
  condenser: { name: 'Condenser', width: 0.8, depth: 0.8, height: 0.9 },
} satisfies Record<
  HvacEquipmentNode['equipmentType'],
  { name: string; width: number; depth: number; height: number }
>
