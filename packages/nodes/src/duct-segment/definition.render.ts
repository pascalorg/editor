import { ductBodySlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildDuctSegmentFloorplan } from './floorplan'
import { buildDuctSegmentGeometry } from './geometry'
import { ductPortDiameterIn } from './profile'
import { DuctSegmentNode } from './schema'

export const ductSegmentRenderDefinition: NodeRenderDefinition<typeof DuctSegmentNode> & {
  kind: 'duct-segment'
} = {
  kind: 'duct-segment',
  schemaVersion: 2,
  schema: DuctSegmentNode,
  category: 'utility',
  distributionRole: 'run',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    autoHangers: false,
    hangerStyle: 'single',
    hangerSpacing: 1.5,
    hangerMaxReach: 2,
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
  },
  system: {
    module: async () => ({
      default: (await import('../shared/run-hanger-system')).DuctHangerSystem,
    }),
  },
  geometry: buildDuctSegmentGeometry,
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
