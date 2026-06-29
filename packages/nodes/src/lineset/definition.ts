import type { NodeDefinition } from '@pascal-app/core'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { buildLinesetFloorplan } from './floorplan'
import { buildLinesetGeometry } from './geometry'
import { linesetParametrics } from './parametrics'
import { LinesetNode } from './schema'

/**
 * Refrigerant lineset — the copper suction + liquid pair joining a split
 * system's outdoor condenser to its indoor coil. The refrigerant-side
 * sibling of `duct-segment`: same polyline model and draw tool, but it
 * snaps onto refrigerant service ports instead of duct collars.
 *
 * Composition: `def.geometry` only, plus a selection-time path-handle
 * system shared in spirit with the duct segment. The framework's
 * `<ParametricNodeRenderer>` mounts an empty group; `<GeometrySystem>`
 * fills it via `buildLinesetGeometry` on dirty.
 */
export const linesetDefinition: NodeDefinition<typeof LinesetNode> = {
  kind: 'lineset',
  schemaVersion: 1,
  schema: LinesetNode,
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
      [2, 0, 0],
    ],
    suctionDiameter: 0.875,
    liquidDiameter: 0.375,
    insulated: true,
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: linesetParametrics,

  geometry: buildLinesetGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.suctionDiameter, n.liquidDiameter, n.insulated]),

  // Open run ends as typed refrigerant ports — directions point outward
  // along the path tangent so they mate flush onto a service valve. Path
  // coords are already level-local, so no transform is needed.
  ports: (n) => {
    if (n.path.length < 2) return []
    const diameter = n.suctionDiameter
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
        diameter,
        system: 'refrigerant',
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter,
        system: 'refrigerant',
      },
    ]
  },

  floorplan: buildLinesetFloorplan,

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

  presentation: {
    label: 'Lineset',
    description:
      'Refrigerant lineset — copper suction + liquid pair joining a condenser to the indoor coil.',
    icon: { kind: 'url', src: '/icons/lineset.webp' },
    paletteSection: 'structure',
    paletteOrder: 93,
  },

  mcp: {
    description:
      'A refrigerant lineset defined as a polyline: an insulated suction line plus a bare liquid line, joining an HVAC condenser to its indoor coil. Snaps onto refrigerant service ports.',
  },
}
