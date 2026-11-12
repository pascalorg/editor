import type { NodeEditContribution } from '../definition-contributions'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { linesetParametrics } from './parametrics'
import type { LinesetNode } from './schema'

export const linesetEditContribution: NodeEditContribution<typeof LinesetNode> = {
  drafting: { cancelOnHistoryJump: true },
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',
  parametrics: linesetParametrics,
  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles. The builder emits an
  // `endpoint-handle` per path vertex; this drags the matching point.
  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('lineset'),
  },
  // Selection-time path-point handles (drag to edit a committed run).
  // Editor-only UI (reads gridSnapStep, renders DimensionPill), so it
  // mounts via the editor's SelectionAffordanceManager — not `def.system`,
  // which the viewer package mounts for the read-only route.
  affordanceTools: {
    selection: () => import('./selection'),
    // Ghost-preview duplicate / move (the refrigerant-loop sibling of
    // duct-segment's mover). Duplicate is pure drag-to-place: a translucent
    // copy of the run, wrapped in a footprint bounding box, follows the
    // cursor and only lands on the commit click — nothing is inserted into
    // the scene before that.
    move: () => import('./move-tool'),
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start lineset' },
    { key: 'Click again', label: 'Place it (locked to 45°)' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: 'Esc', label: 'Cancel start point' },
  ],
}
