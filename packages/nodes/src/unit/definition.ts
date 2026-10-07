import { type NodeDefinition, UnitNode as UnitNodeSchema } from '@pascal-app/core'
import { unitParametrics } from './parametrics'
import { UnitNode } from './schema'

/**
 * Unit — a referencing overlay, not a container. It lists member zone ids
 * and owns no geometry: member zones carry its tint, and the site panel
 * drives selection (declaring `selectable` would subscribe the kind to 3D
 * clicks that have nothing to hit). Not placeable: no tool, no palette tile.
 */
export const unitDefinition: NodeDefinition<typeof UnitNode> = {
  kind: 'unit',
  schemaVersion: 1,
  schema: UnitNode,
  category: 'site',

  defaults: () => {
    const stub = UnitNodeSchema.parse({ id: 'unit_default' as never, type: 'unit' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    duplicable: false,
    deletable: true,
    presettable: false,
  },

  parametrics: unitParametrics,
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  presentation: {
    label: 'Unit',
    description: 'A named group of zones forming one apartment, hotel room or commercial lot.',
    icon: { kind: 'url', src: '/icons/zone.webp' },
    paletteSection: 'site',
    hidden: true,
  },

  mcp: {
    description:
      'A named occupancy unit (apartment, hotel room, commercial lot, common area) under a building, referencing member zones that may span levels.',
  },
}
