import type { NodeEditContribution } from '../definition-contributions'
import { buildHvacEquipmentFloorplan } from './floorplan'
import { hvacEquipmentParametrics } from './parametrics'
import type { HvacEquipmentNode } from './schema'

export const hvacEquipmentEditContribution: NodeEditContribution<typeof HvacEquipmentNode> = {
  snapProfile: 'item',
  parametrics: hvacEquipmentParametrics,
  floorplan: buildHvacEquipmentFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place unit' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],
}
