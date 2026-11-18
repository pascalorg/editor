import { PlantingNode, plantingCurrentGen } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildPlantingFloorplan } from './floorplan'
import { buildPlantingGeometry } from './geometry'

export const plantingRenderDefinition: NodeRenderDefinition<typeof PlantingNode> & {
  kind: 'planting'
} = {
  kind: 'planting',
  extensions: { 'pascal:viewer': { family: 'site' } },
  schemaVersion: 1,
  schema: PlantingNode,
  category: 'site',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = PlantingNode.parse({
      id: 'planting_default',
      area: 12,
      gen: plantingCurrentGen(),
    })
    return defaults
  },
  capabilities: {
    exterior: true,
    revealOnEdit: ['outline', 'area', 'center', 'plants', 'pattern', 'ground', 'edging', 'seed'],
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    deletable: true,
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  geometry: buildPlantingGeometry,
  geometryChildTypes: [],
  floorplan: buildPlantingFloorplan,
  floorplanScope: 'site',
  sitePlan: true,
  system: { module: () => import('./system') },
  presentation: {
    label: 'Planting bed',
    description: 'An organic bed of layered plants, with soil or mulch and optional edging.',
    icon: { kind: 'iconify', name: 'lucide:flower-2' },
    paletteSection: 'structure',
    paletteOrder: 80,
  },
  mcp: {
    description:
      'A Site planting bed: an outline or area, one to eight plant species with habits and back/mid/edge layers, a seeded pattern, ground and edging. The seen side is +Z. Individual plants are generated, not scene nodes.',
  },
}
