import { FacadeNode, type NodeDefinition } from '@pascal-app/core'

/**
 * Facade — a building's facade set and where each unit goes. Data only: the
 * walls hold what it generates, and the facade tool edits it. Not selectable
 * or placeable: no tool of its own, no palette tile.
 */
export const facadeDefinition: NodeDefinition<typeof FacadeNode> = {
  kind: 'facade',
  schemaVersion: 1,
  schema: FacadeNode,
  category: 'structure',

  defaults: () => {
    const stub = FacadeNode.parse({
      id: 'facade_default' as never,
      type: 'facade',
      set: { name: 'Facade' },
    })
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
    label: 'Facade',
    description: "A building's facade set: units with storey roles, applied as areas.",
    icon: { kind: 'url', src: '/icons/facade.svg' },
    paletteSection: 'structure',
    hidden: true,
  },

  mcp: {
    description:
      "A building's facade set: a few units with storey roles (first / middle / top / free), applied as areas over storey ranges; each wall keeps a snapshot of the unit it carries.",
  },
}
