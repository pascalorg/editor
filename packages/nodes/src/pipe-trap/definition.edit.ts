import type { NodeEditContribution } from '../definition-contributions'
import { buildPipeTrapFloorplan } from './floorplan'
import { pipeTrapParametrics } from './parametrics'
import type { PipeTrapNode } from './schema'

export const pipeTrapEditContribution: NodeEditContribution<typeof PipeTrapNode> = {
  snapProfile: 'item',
  parametrics: pipeTrapParametrics,
  floorplan: buildPipeTrapFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place trap' },
    { key: 'R / T', label: 'Rotate ±45°' },
    { key: 'Esc', label: 'Exit' },
  ],
}
