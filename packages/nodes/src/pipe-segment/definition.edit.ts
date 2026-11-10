import type { NodeEditContribution } from '../definition-contributions'
import { createRunHangerToolHint } from '../shared/run-hanger-mode'
import { pipeRunToolOptions } from '../shared/run-tool-options'
import { pipeBranchAffordance, pipeContinuationAffordance } from './continuation'
import { buildPipeSegmentFloorplan } from './floorplan'
import { pipeGradePointAffordance } from './grade-affordance'
import { pipeSegmentParametrics } from './parametrics'
import type { PipeSegmentNode } from './schema'

export const pipeSegmentEditContribution: NodeEditContribution<typeof PipeSegmentNode> = {
  drafting: { surfaceQuery: true, cancelOnHistoryJump: true },
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',
  parametrics: pipeSegmentParametrics,
  floorplanDependsOnSiblings: true,
  floorplan: buildPipeSegmentFloorplan,
  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles. The builder emits an
  // `endpoint-handle` per path vertex; this drags the matching point.
  floorplanAffordances: {
    'move-path-point': pipeGradePointAffordance,
    'continue-run': pipeContinuationAffordance,
    'branch-run': pipeBranchAffordance,
  },
  // Selection-time path-point handles (drag to edit a committed run).
  // Editor-only UI (reads gridSnapStep, renders DimensionPill), so it
  // mounts via the editor's SelectionAffordanceManager — not `def.system`,
  // which the viewer package mounts for the read-only route.
  affordanceTools: {
    selection: () => import('./selection'),
    // Ghost-preview duplicate / move (the plumbing sibling of duct-segment's
    // mover). Duplicate is pure drag-to-place: a translucent copy of the run,
    // wrapped in a footprint bounding box, follows the cursor and only lands
    // on the commit click — nothing is inserted into the scene before that.
    move: () => import('./move-tool'),
  },
  tool: () => import('./tool'),
  toolOptions: pipeRunToolOptions,
  toolHints: [
    { key: 'Click', label: 'Start run' },
    { key: 'Click again', label: 'Place and continue' },
    { key: 'Q', label: 'Waste / vent' },
    { key: 'S', label: 'Slope / level' },
    createRunHangerToolHint('pipe-segment'),
    { key: '[ / ]', label: 'Pipe size down / up' },
    { key: 'Alt + drag', label: 'Vertical stack ↕, click to place' },
    { key: 'Esc', label: 'Exit drawing' },
  ],
}
