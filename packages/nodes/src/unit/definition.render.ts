import { UnitNode as UnitNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { UnitNode } from './schema'

export const unitRenderDefinition: NodeRenderDefinition<typeof UnitNode> & { kind: 'unit' } = {
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
