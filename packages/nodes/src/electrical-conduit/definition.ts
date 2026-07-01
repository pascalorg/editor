import type { NodeDefinition } from '@pascal-app/core'
import { createPathPointMoveAffordance } from '../shared/path-point-affordance'
import { buildElectricalConduitFloorplan } from './floorplan'
import { buildElectricalConduitGeometry } from './geometry'
import { electricalConduitParametrics } from './parametrics'
import { ElectricalConduitNode } from './schema'

/**
 * Electrical conduit run — EMT, PVC, or flex conduit as a polyline.
 * Phase 1: run geometry and floor plan only. Conduit bodies (LBs, sweeps)
 * and circuit connectivity come in a later slice.
 */
export const electricalConduitDefinition: NodeDefinition<typeof ElectricalConduitNode> = {
  kind: 'electrical-conduit',
  schemaVersion: 1,
  schema: ElectricalConduitNode,
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
    conduitMaterial: 'emt',
    system: 'power',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: electricalConduitParametrics,

  geometry: buildElectricalConduitGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.diameter, n.conduitMaterial, n.system]),

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

  floorplan: buildElectricalConduitFloorplan,

  floorplanAffordances: {
    'move-path-point': createPathPointMoveAffordance('electrical-conduit'),
  },

  tool: () => import('./tool'),
  toolHints: [
    { key: 'Click', label: 'Start run' },
    { key: 'Click again', label: 'Place segment' },
    { key: 'E', label: 'Power / lighting / data' },
    { key: '[ / ]', label: 'Conduit size down / up' },
    { key: 'Esc', label: 'Cancel start point' },
  ],

  presentation: {
    label: 'Conduit',
    description: 'Electrical conduit run — EMT, PVC, or flexible.',
    icon: { kind: 'iconify', name: 'lucide:zap' },
    paletteSection: 'structure',
    paletteOrder: 105,
  },

  mcp: {
    description:
      'An electrical conduit run defined as a polyline. Conduit trade size in inches; system is power, lighting, or data. Path coordinates are level-local meters.',
  },
}
