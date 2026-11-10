import { DEFAULT_LEVEL_HEIGHT, LevelNode as LevelNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { LevelNode } from './schema'

export const levelRenderDefinition: NodeRenderDefinition<typeof LevelNode> & { kind: 'level' } = {
  kind: 'level',
  schemaVersion: 2,
  schema: LevelNode,
  category: 'site',
  defaults: () => {
    const stub = LevelNodeSchema.parse({
      id: 'level_default' as never,
      type: 'level',
      height: DEFAULT_LEVEL_HEIGHT,
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: false,
    // Level is a container — selection happens via the sidebar tree
    // and the floating level switcher, never via 3D click. Declaring
    // `selectable` here would make `getSelectableKinds()` add the
    // kind to `SelectionManager`'s subscription list, and the event
    // would fire on every wall/slab/ceiling click that bubbled to the
    // level group — selecting the level instead of the actual node
    // hit. Legacy `allTypes` deliberately omitted containers; we
    // mirror that.
    duplicable: false,
    deletable: true,
    // Container kind — saving a level as a standalone preset has no
    // meaning (its contents make sense only inside a building).
    presettable: false,
  },
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  presentation: {
    label: 'Level',
    description: 'A single floor of a building, holding walls / slabs / ceilings / items.',
    icon: { kind: 'url', src: '/icons/level.webp' },
    paletteSection: 'site',
    paletteOrder: 7,
  },
  mcp: {
    description: 'A level (floor) container under a building.',
  },
}
