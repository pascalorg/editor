import type { NodeDefinition } from '@pascal-app/core'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { buildWaterLineFloorplan } from './floorplan'
import { buildWaterLineGeometry } from './geometry'
import { waterLineParametrics } from './parametrics'
import { WaterLineNode } from './schema'

/**
 * Pressurized water supply line — cold or hot. The plumbing sibling of
 * `pipe-segment` but without slope (pressurized supply runs horizontally
 * or vertically at any angle). Phase 1: run geometry and floor-plan only.
 */
export const waterLineDefinition: NodeDefinition<typeof WaterLineNode> = {
  kind: 'water-line',
  schemaVersion: 1,
  schema: WaterLineNode,
  category: 'utility',
  distributionRole: 'run',
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
    diameter: 0.75,
    pipeMaterial: 'pex',
    system: 'cold-water',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: waterLineParametrics,

  geometry: buildWaterLineGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.diameter, n.pipeMaterial, n.system]),

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
      { id: 'start', position: first, direction: unit(first, second), diameter: n.diameter, system: n.system },
      { id: 'end', position: last, direction: unit(last, prev), diameter: n.diameter, system: n.system },
    ]
  },

  floorplan: buildWaterLineFloorplan,

  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('water-line'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start run' },
    { key: 'Click again', label: 'Place segment' },
    { key: 'H', label: 'Cold / hot water' },
    { key: '[ / ]', label: 'Pipe size down / up' },
    { key: 'Esc', label: 'Cancel start point' },
  ],

  presentation: {
    label: 'Water Line',
    description: 'Pressurized water supply line — cold or hot water run.',
    icon: { kind: 'iconify', name: 'lucide:droplets' },
    paletteSection: 'structure',
    paletteOrder: 100,
  },

  mcp: {
    description:
      'A pressurized water supply run defined as a polyline. Path coordinates are level-local meters. System is cold-water or hot-water; diameter in nominal inches.',
  },
}
