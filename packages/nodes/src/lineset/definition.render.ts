import type { NodeRenderDefinition } from '../definition-contributions'
import { buildLinesetFloorplan } from './floorplan'
import { buildLinesetGeometry } from './geometry'
import { LinesetNode } from './schema'

export const linesetRenderDefinition: NodeRenderDefinition<typeof LinesetNode> & {
  kind: 'lineset'
} = {
  kind: 'lineset',
  schemaVersion: 1,
  schema: LinesetNode,
  category: 'utility',
  distributionRole: 'run',
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
