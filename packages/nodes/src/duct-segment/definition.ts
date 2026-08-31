import { type AnyNode, type NodeDefinition, useScene } from '@pascal-app/core'
import { ductBodyPaint, ductBodySlots } from '../shared/duct-body-paint'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { createSegmentMoveAffordance } from '../shared/path-segment-affordance'
import { buildDuctSegmentFloorplan } from './floorplan'
import { buildDuctSegmentGeometry, ductPortDiameterIn } from './geometry'
import { ductSegmentParametrics } from './parametrics'
import { DuctSegmentNode } from './schema'

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

export const ductSegmentDefinition: NodeDefinition<typeof DuctSegmentNode> = {
  kind: 'duct-segment',
  schemaVersion: 1,
  schema: DuctSegmentNode,
  category: 'utility',
  distributionRole: 'run',
  // Directional run: like a wall, drafting sets a direction, so it takes the
  // structural snapping context (grid / lines / angles / off) with a 45° angle
  // lock available as a cyclable mode.
  snapProfile: 'structural',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    path: [
      [0, 0, 0],
      [3, 0, 0],
    ],
    shape: 'rect',
    diameter: 6,
    width: 14,
    height: 8,
    ductMaterial: 'flex',
    seamDetail: false,
    insulated: false,
    insulationR: 0.5,
    system: 'supply',
    roll: 0,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    slots: () => ductBodySlots(),
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

  geometry: buildDuctSegmentGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.path,
      n.shape,
      n.diameter,
      n.width,
      n.height,
      n.roll,
      n.ductMaterial,
      n.seamDetail,
      n.insulated,
      n.insulationR,
      n.system,
      n.slots,
    ]),

  // Open run ends as typed ports — directions point outward along the
  // path tangent so fittings mate flush. Path coords are already
  // level-local, so no transform is needed.
  ports: (n) => {
    if (n.path.length < 2) return []
    const unit = (
      a: readonly [number, number, number],
      b: readonly [number, number, number],
    ): [number, number, number] => {
      const d: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const len = Math.hypot(d[0], d[1], d[2])
      return len < 1e-9 ? [1, 0, 0] : [d[0] / len, d[1] / len, d[2] / len]
    }
    const first = n.path[0]!
    const second = n.path[1]!
    const last = n.path[n.path.length - 1]!
    const prev = n.path[n.path.length - 2]!
    return [
      {
        id: 'start',
        position: first,
        direction: unit(first, second),
        diameter: ductPortDiameterIn(n),
        system: n.system,
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter: ductPortDiameterIn(n),
        system: n.system,
      },
    ]
  },

  floorplan: buildDuctSegmentFloorplan,

  // 2D selection-time path-point handles — the floor-plan twin of the 3D
  // `affordanceTools.selection` handles. The builder emits an
  // `endpoint-handle` per path vertex; this drags the matching point.
  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('duct-segment'),
    // 2D twin of the 3D side-move arrows: slide a segment perpendicular to
    // itself. (Length editing stays on the per-vertex hex handles.)
    'move-segment': createSegmentMoveAffordance('duct-segment'),
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
  toolHints: [
    { key: 'Click', label: 'Start segment' },
    { key: 'Click again', label: 'Place and continue' },
    { key: 'Alt + drag', label: 'Go vertical ↕, click to place' },
    { key: '[ / ]', label: 'Duct diameter down / up' },
    { key: 'Q', label: 'Round / rect trunk' },
    { key: 'C', label: 'Ceiling / floor height' },
    { key: 'Esc', label: 'Cancel start point' },
  ],

  presentation: {
    label: 'Duct',
    description: 'HVAC duct run — polyline of round, rect, or flat-oval sections.',
    icon: { kind: 'url', src: '/icons/duct.webp' },
    paletteSection: 'structure',
    paletteOrder: 90,
  },

  mcp: {
    description:
      'An HVAC duct run defined as a polyline — round (branches), rect (trunks/plenums), or flat-oval (tight joist bays). Supply or return, with configurable size, material (incl. spiral seam), and external insulation.',
  },
}
