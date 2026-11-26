import { HedgeNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildHedgeFloorplan } from './floorplan'
import { buildHedgeGeometry } from './geometry'

/**
 * Hedge: a planted run along a line on the Site's ground. Its form is derived from its line, its
 * few numbers and its seed; nothing of it is stored as a mesh.
 */
export const hedgeRenderDefinition: NodeRenderDefinition<typeof HedgeNode> & { kind: 'hedge' } = {
  kind: 'hedge',
  extensions: { 'pascal:viewer': { family: 'site' } },
  schemaVersion: 1,
  schema: HedgeNode,
  category: 'site',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = HedgeNode.parse({
      id: 'hedge_default',
      path: [
        [-2, 0],
        [2, 0],
      ],
    })
    return defaults
  },
  capabilities: {
    exterior: true,
    revealOnEdit: ['path', 'closed', 'curve', 'height', 'width', 'clip', 'gaps'],
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    deletable: true,
    // A copy would stand exactly where the hedge does: draw another.
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  geometry: buildHedgeGeometry,
  geometryChildTypes: [],
  floorplan: buildHedgeFloorplan,
  floorplanScope: 'site',
  sitePlan: true,
  system: { module: () => import('./system') },
  presentation: {
    label: 'Hedge',
    description: 'A planted hedge along a line, freshly clipped or left to grow.',
    icon: { kind: 'url', src: '/icons/garden-hedge.webp' },
    cursorIcon: true,
    paletteSection: 'structure',
    paletteOrder: 79,
  },
  mcp: {
    description:
      'A hedge planted along a line on the Site ground: a path, a height and a width, clip from loose to clipped, a leaf size and colour, openings along the line, and a seed for its form.',
  },
}
