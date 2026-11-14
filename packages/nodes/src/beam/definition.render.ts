import type { NodeRenderDefinition } from '../definition-contributions'
import { buildBeamFloorplan } from './floorplan'
import { BeamNode } from './schema'

export const beamRenderDefinition: NodeRenderDefinition<typeof BeamNode> & { kind: 'beam' } = {
  kind: 'beam',
  schemaVersion: 1,
  schema: BeamNode,
  category: 'structure',
  defaults: () => {
    const { id: _id, type: _type, ...rest } = BeamNode.parse({ start: [0, 0], end: [3, 0] })
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { hosting: false },
    duplicable: true,
    deletable: true,
    drawTool: true,
  },
  // The renderer reads the scene and live overrides itself; nothing consumes a dirty mark.
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  floorplan: buildBeamFloorplan,
  presentation: {
    label: 'Beam',
    description: 'A framing beam drawn end to end: a porch header, a deck beam, a girder.',
    icon: { kind: 'url', src: '/icons/beam.svg' },
    paletteSection: 'structure',
    paletteOrder: 72,
  },
  mcp: {
    description:
      'A horizontal framing beam: start/end centreline (level-local), actual width/depth, nominal size and plies, material, dropped or flush placement, and a top elevation (absent = under the ceiling plane).',
  },
}
