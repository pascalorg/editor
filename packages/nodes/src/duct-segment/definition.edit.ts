import { type AnyNode, useScene } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { ductBodyPaint } from '../shared/duct-body-paint'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { createSegmentMoveAffordance } from '../shared/path-segment-affordance'
import { createRunHangerToolHint } from '../shared/run-hanger-mode'
import { ductRunToolOptions } from '../shared/run-tool-options'
import { ductBranchAffordance, ductContinuationAffordance } from './continuation'
import { buildDuctSegmentFloorplan } from './floorplan'
import { ductSegmentParametrics } from './parametrics'
import type { DuctSegmentNode } from './schema'

/**
 * Phase 1 of the HVAC node system — round duct segment as a polyline.
 *
 * Composition: `def.geometry` only. No custom renderer, no per-frame
 * system. The framework's `<ParametricNodeRenderer>` mounts an empty
 * group; `<GeometrySystem>` calls `buildDuctSegmentGeometry` whenever
 * the node is dirty and swaps in the cylinder+sphere meshes.
 *
 * Deferred to later slices:
 *   - Placement tool (polyline draw UX).
 *   - Fittings (elbow / tee / reducer) — needs typed ports first.
 *   - Terminals (registers / diffusers) — needs surface-snapping.
 *   - Equipment (furnace / air-handler / condenser).
 *   - Floor-plan rendering.
 *   - Move / endpoint handles.
 *
 * The node can be created programmatically today via
 * `DuctSegmentNode.parse({ path: [...] })` + `useScene.createNode(...)`.
 */
/** R / T roll step (radians) — 45°, matching the fitting rotate. */
const ROLL_STEP_RAD = Math.PI / 4

/**
 * R / T roll a selected rect / oval run's cross-section ±45° around its
 * drawn line, so a rectangular trunk can be turned on its side after
 * placement. Round runs look identical at any roll, so the action gates
 * itself off for them (`appliesTo`) and the editor's default rotation —
 * a no-op for a node with no `rotation` field — takes over harmlessly.
 */
function rollDuctSegment(node: AnyNode, steps: 1 | -1): void {
  const duct = node as DuctSegmentNode
  useScene.getState().updateNode(duct.id, { roll: duct.roll + steps * ROLL_STEP_RAD })
}

export const ductSegmentEditContribution: NodeEditContribution<typeof DuctSegmentNode> = {
  drafting: { surfaceQuery: true, cancelOnHistoryJump: true },
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',
  capabilities: {
    paint: ductBodyPaint,
  },
  parametrics: ductSegmentParametrics,
  // R / T roll a selected rect / oval run ±45° around its drawn line.
  // `appliesTo` lets round runs fall through to the editor's default
  // (harmless — duct-segment has no `rotation` field).
  keyboardActions: {
    r: {
      appliesTo: (node) => node.type === 'duct-segment' && node.shape !== 'round',
      run: (node) => rollDuctSegment(node, 1),
    },
    t: {
      appliesTo: (node) => node.type === 'duct-segment' && node.shape !== 'round',
      run: (node) => rollDuctSegment(node, -1),
    },
  },
  floorplanDependsOnSiblings: true,
  floorplan: buildDuctSegmentFloorplan,
  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles. The builder emits an
  // `endpoint-handle` per path vertex; this drags the matching point.
  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('duct-segment'),
    // 2D twin of the 3D side-move arrows: slide a segment perpendicular to
    // itself. (Length editing stays on the per-vertex hex handles.)
    'move-segment': createSegmentMoveAffordance('duct-segment'),
    'continue-run': ductContinuationAffordance,
    'branch-run': ductBranchAffordance,
  },
  // Selection-time path-point handles (drag to edit a committed run).
  // Editor-only UI (reads gridSnapStep, renders DimensionPill), so it
  // mounts via the editor's SelectionAffordanceManager — not `def.system`,
  // which the viewer package mounts for the read-only route.
  affordanceTools: {
    selection: () => import('./selection'),
    // Ghost-preview duplicate / move. Duplicate is pure drag-to-place: a
    // translucent copy of the run follows the cursor and only lands on the
    // commit click — nothing is inserted into the scene before that.
    move: () => import('./move-tool'),
  },
  tool: () => import('./tool'),
  toolOptions: ductRunToolOptions,
  toolHints: [
    { key: 'Click', label: 'Start segment' },
    { key: 'Click again', label: 'Place and continue' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: '[ / ]', label: 'Duct diameter down / up' },
    { key: 'Q', label: 'Round / rectangular / oval' },
    createRunHangerToolHint('duct-segment'),
    { key: 'Esc', label: 'Exit drawing' },
  ],
}
