import { TerrainBreakNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildTerrainBreakFloorplan } from './floorplan'
import { buildTerrainBreakGeometry } from './geometry'

export const terrainBreakRenderDefinition: NodeRenderDefinition<typeof TerrainBreakNode> & {
  kind: 'terrain-break'
} = {
  kind: 'terrain-break',
  schemaVersion: 1,
  schema: TerrainBreakNode,
  category: 'site',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = TerrainBreakNode.parse({
      id: 'terrain-break_default',
      line: [
        [0, 0],
        [10, 0],
      ],
      kind: 'cliff',
      left: 1,
      right: 'ground',
    })
    return defaults
  },
  capabilities: {
    revealOnEdit: ['line', 'kind', 'left', 'right'],
    drawTool: true,
    selectable: { hitVolume: 'mesh' },
    deletable: true,
    duplicable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  bakeGeometry: buildTerrainBreakGeometry,
  floorplan: buildTerrainBreakFloorplan,
  floorplanScope: 'site',
  presentation: {
    label: 'Terrain break',
    description:
      'An exact vertical cliff, retaining or soil boundary between two ground elevations.',
    icon: { kind: 'iconify', name: 'lucide:mountain' },
    paletteSection: 'structure',
    paletteOrder: 78,
  },
  mcp: {
    description:
      'Site-owned directed terrain boundary with exact side heights and a vertical face.',
  },
}
