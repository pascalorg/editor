import type { NodeEditContribution } from '../definition-contributions'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { buildLiquidLineFloorplan } from './floorplan'
import { liquidLineParametrics } from './parametrics'
import type { LiquidLineNode } from './schema'

export const liquidLineEditContribution: NodeEditContribution<typeof LiquidLineNode> = {
  drafting: { cancelOnHistoryJump: true },
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',
  parametrics: liquidLineParametrics,
  floorplan: buildLiquidLineFloorplan,
  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles.
  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('liquid-line'),
  },
  // Selection-time path-point handles (drag to edit a committed run) and the
  // ghost-preview duplicate / move tool (drag-to-place a translucent copy).
  affordanceTools: {
    selection: () => import('./selection'),
    move: () => import('./move-tool'),
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start liquid line' },
    { key: 'Click again', label: 'Place it (locked to 45°)' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: 'F', label: 'Follow: trace a lineset' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
