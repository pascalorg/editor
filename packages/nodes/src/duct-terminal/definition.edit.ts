import type { NodeEditContribution } from '../definition-contributions'
import { buildDuctTerminalFloorplan } from './floorplan'
import { ductTerminalParametrics } from './parametrics'
import type { DuctTerminalNode } from './schema'

export const ductTerminalEditContribution: NodeEditContribution<typeof DuctTerminalNode> = {
  snapProfile: 'item',
  parametrics: ductTerminalParametrics,
  floorplan: buildDuctTerminalFloorplan,
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Place register' },
    { key: 'M', label: 'Mount: floor / ceiling / wall' },
    { key: 'R / T', label: 'Rotate ±45° (floor / ceiling)' },
    { key: 'Esc', label: 'Exit' },
  ],
}
