import type { NodeRenderDefinition } from '../definition-contributions'
import { buildPipeSegmentFloorplan } from './floorplan'
import { buildPipeSegmentGeometry } from './geometry'
import { PipeSegmentNode } from './schema'

export const pipeSegmentRenderDefinition: NodeRenderDefinition<typeof PipeSegmentNode> & {
  kind: 'pipe-segment'
} = {
  kind: 'pipe-segment',
  schemaVersion: 2,
  schema: PipeSegmentNode,
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
      [0, 0.0254, 0],
      [3, 0.0254, 0],
    ],
    diameter: 2,
    pipeMaterial: 'pvc',
    system: 'waste',
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },
  system: {
    module: async () => ({
      default: (await import('../shared/run-hanger-system')).PipeHangerSystem,
    }),
  },
  geometry: buildPipeSegmentGeometry,
  // Open run ends as typed ports — system 'waste'/'vent' keeps the DWV
  // network invisible to duct / refrigerant tools and vice versa.
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
        diameter: n.diameter,
        system: n.system,
      },
      {
        id: 'end',
        position: last,
        direction: unit(last, prev),
        diameter: n.diameter,
        system: n.system,
      },
    ]
  },
  floorplan: buildPipeSegmentFloorplan,
  presentation: {
    label: 'DWV Pipe',
    description:
      'Drain / waste / vent pipe run — draw level or choose grade and downhill direction.',
    icon: { kind: 'url', src: '/icons/dwv-pipes.webp' },
    paletteSection: 'structure',
    paletteOrder: 95,
  },
  mcp: {
    description:
      'A DWV (drain-waste-vent) pipe run defined as a polyline. Waste runs slope downward (slope lives in the path Y coordinates); vents run level or vertical. Sized in nominal inches.',
  },
}
