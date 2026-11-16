import { RampNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildRampFloorplan } from './floorplan'
import { buildRampGeometry } from './geometry'

export const rampRenderDefinition: NodeRenderDefinition<typeof RampNode> & { kind: 'ramp' } = {
  kind: 'ramp',
  schemaVersion: 1,
  schema: RampNode,
  category: 'site',
  surfaceRole: 'floor',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = RampNode.parse({
      id: 'ramp_default',
      start: [0, 0],
      segments: [{ type: 'line', end: [10, 0] }],
      endHeight: -1.5,
    })
    return defaults
  },
  capabilities: {
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    deletable: true, // Copies would share an excavated corridor. Author another centreline instead.
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
    slots: () => [
      { slotId: 'surface', label: 'Surface', default: '#aaa69c' },
      { slotId: 'edge', label: 'Solid edges', default: '#88857e' },
      { slotId: 'retaining', label: 'Retaining sides', default: '#88857e' },
    ],
  },
  geometry: buildRampGeometry,
  geometryChildTypes: [],
  floorplan: buildRampFloorplan,
  floorplanScope: 'site',
  presentation: {
    label: 'Ramp',
    description: 'A line-and-arc ramp with explicit endpoint heights and terrain cut and fill.',
    icon: { kind: 'iconify', name: 'lucide:waypoints' },
    paletteSection: 'structure',
    paletteOrder: 76,
  },
  mcp: {
    description:
      'Site-owned centreline ramp with an exact endpoint-height profile, transitions and optional retaining sides.',
  },
}
