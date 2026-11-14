import { BuildingNode as BuildingNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { BuildingNode } from './schema'

export const buildingRenderDefinition: NodeRenderDefinition<typeof BuildingNode> & {
  kind: 'building'
} = {
  kind: 'building',
  schemaVersion: 3,
  schema: BuildingNode,
  category: 'site',
  defaults: () => {
    const stub = BuildingNodeSchema.parse({ id: 'building_default' as never, type: 'building' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: false,
    // Building is a container — sidebar / building switcher drive
    // selection, never 3D click. Same reasoning as `level` / `site`.
    duplicable: false,
    deletable: false,
    floorplanLevelContainer: true,
    presettable: false,
  },
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Building',
    description: 'A building container holding one or more levels.',
    icon: { kind: 'url', src: '/icons/building.webp' },
    paletteSection: 'site',
    paletteOrder: 6,
  },
  mcp: {
    description: 'A building container that groups levels.',
  },
}
