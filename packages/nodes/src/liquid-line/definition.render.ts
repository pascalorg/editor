import type { NodeRenderDefinition } from '../definition-contributions'
import { buildLiquidLineFloorplan } from './floorplan'
import { buildLiquidLineGeometry } from './geometry'
import { LiquidLineNode } from './schema'

export const liquidLineRenderDefinition: NodeRenderDefinition<typeof LiquidLineNode> & {
  kind: 'liquid-line'
} = {
  kind: 'liquid-line',
  schemaVersion: 1,
  schema: LiquidLineNode,
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
    diameter: 0.375,
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },
  geometry: buildLiquidLineGeometry,
  geometryKey: (n) => JSON.stringify([n.path, n.diameter]),
  // Open run ends as typed refrigerant ports — directions point outward along
  // the path tangent so they mate flush onto a service valve. Path coords are
  // already level-local, so no transform is needed.
  ports: (n) => {
    if (n.path.length < 2) return []
    const diameter = n.diameter
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
  floorplan: buildLiquidLineFloorplan,
  presentation: {
    label: 'Liquid Line',
    description:
      'Standalone refrigerant liquid line — a thin bare-copper run; Follow mode traces an existing lineset.',
    icon: { kind: 'url', src: '/icons/lineset.webp' },
    paletteSection: 'structure',
    paletteOrder: 94,
  },
  mcp: {
    description:
      'A standalone refrigerant liquid line defined as a polyline of thin bare copper. Snaps onto refrigerant service ports; can be traced alongside an existing lineset.',
  },
}
