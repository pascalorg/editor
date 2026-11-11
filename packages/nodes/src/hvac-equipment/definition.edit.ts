import type { NodeEditContribution } from '../definition-contributions'
import { hvacEquipmentParametrics } from './parametrics'
import type { HvacEquipmentNode } from './schema'

export const hvacEquipmentEditContribution: NodeEditContribution<typeof HvacEquipmentNode> = {
  snapProfile: 'item',
  parametrics: hvacEquipmentParametrics,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place unit' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],
}
