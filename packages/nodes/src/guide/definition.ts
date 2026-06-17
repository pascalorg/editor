import { GuideNode as GuideNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { guideParametrics } from './parametrics'
import { GuideNode } from './schema'

/**
 * Guide — Stage A. Measurement reference annotations placed by the
 * user (linear / area / arc). `GuideSystem` handles per-frame
 * positioning; the renderer mounts the visual marker + dimensioning
 * HUD via `<Html>`.
 */
export const guideDefinition: NodeDefinition<typeof GuideNode> = {
  kind: 'guide',
  schemaVersion: 1,
  schema: GuideNode,
  category: 'site',

  defaults: () => {
    const stub = GuideNodeSchema.parse({ id: 'guide_default' as never, type: 'guide' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    // Guides are scene-specific measurement annotations — saving them
    // as reusable catalog items has no meaning.
    presettable: false,
  },

  parametrics: guideParametrics,
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 5,
  },

  presentation: {
    label: 'Guide',
    description: 'A measurement / reference annotation (linear, area, or arc).',
    icon: { kind: 'url', src: '/icons/blueprint.webp' },
    paletteSection: 'site',
    paletteOrder: 30,
  },

  mcp: {
    description: 'A measurement reference guide annotation.',
  },
}
