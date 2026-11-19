import { LawnNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildLawnBakeGeometry } from './bake-geometry'
import { buildLawnFloorplan } from './floorplan'
import { buildLawnGeometry } from './geometry'

export const lawnRenderDefinition: NodeRenderDefinition<typeof LawnNode> & { kind: 'lawn' } = {
  kind: 'lawn',
  extensions: { 'pascal:viewer': { family: 'site' } },
  schemaVersion: 1,
  schema: LawnNode,
  category: 'site',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = LawnNode.parse({
      id: 'lawn_default',
      outline: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })
    return defaults
  },
  capabilities: {
    exterior: true,
    revealOnEdit: [
      'outline',
      'height',
      'bladeWidth',
      'density',
      'roughness',
      'color',
      'edgeFade',
      'wind',
      'seed',
      'flowers',
      'flowerDensity',
      'season',
      'strokes',
    ],
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    selectionHighlight: false,
    deletable: true,
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  geometry: buildLawnGeometry,
  bake: 'replace',
  bakeGeometry: buildLawnBakeGeometry,
  bakeReplaceRenderer: { module: () => import('./static-renderer') },
  geometryChildTypes: [],
  floorplan: buildLawnFloorplan,
  floorplanScope: 'site',
  sitePlan: true,
  system: { module: () => import('./system') },
  presentation: {
    label: 'Lawn',
    description: 'An editable lawn on Site ground, with mown or rough grass and optional flowers.',
    icon: { kind: 'url', src: '/icons/garden-lawn.webp' },
    paletteSection: 'structure',
    paletteOrder: 81,
  },
  mcp: {
    description:
      'A seeded Site lawn with an exact outline, ground-following blades, optional daisy, clover and yarrow flowers, and ordered vector brush strokes. Keeps buildings, paving and planting beds clear. Geometry is derived; no Environment plugin is required.',
  },
}
