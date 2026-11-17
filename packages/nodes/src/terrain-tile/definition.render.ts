import { createTerrainField, encodeTerrainField, TerrainTileNode } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'

export const terrainTileRenderDefinition: NodeRenderDefinition<typeof TerrainTileNode> & {
  kind: 'terrain-tile'
} = {
  kind: 'terrain-tile',
  schemaVersion: 1,
  schema: TerrainTileNode,
  category: 'site',
  defaults: () => {
    const {
      id: _id,
      type: _type,
      ...defaults
    } = TerrainTileNode.parse({
      id: 'terrain-tile_default',
      ix: 0,
      iz: 0,
      heights: encodeTerrainField(createTerrainField()).heights,
    })
    return defaults
  },
  capabilities: {
    // New ground rises in from the datum, and ground that is graded grows to its new relief.
    reveal: { phase: 'foundation', style: 'rise' },
    revealOnEdit: ['heights', 'step'],
    duplicable: false,
    deletable: false,
    presettable: false,
    hostable: { parents: ['site'] },
    surfaces: { hosting: false },
  },
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: {
    label: 'Terrain tile',
    description: 'An authored 32 m patch of the continuous site ground.',
    icon: { kind: 'iconify', name: 'lucide:mountain' },
  },
}
