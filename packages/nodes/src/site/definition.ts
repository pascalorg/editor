import { type NodeDefinition, SiteNode as SiteNodeSchema } from '@pascal-app/core'
import { siteParametrics } from './parametrics'
import { SiteNode } from './schema'

/**
 * Site — Stage A. Top-level container under the scene root; holds
 * buildings + property-line polygon + zones. No system (sites don't
 * have per-frame work). Not movable / deletable — they're the scene
 * root.
 */
export const siteDefinition: NodeDefinition<typeof SiteNode> = {
  kind: 'site',
  schemaVersion: 1,
  schema: SiteNode,
  category: 'site',

  defaults: () => {
    const stub = SiteNodeSchema.parse({ id: 'site_default' as never, type: 'site' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    // Site is the root container — sidebar / property-line tool drive
    // selection, never 3D click (event bubbling from descendants would
    // override their selection). Same reasoning as `level`.
    duplicable: false,
    deletable: false,
    presettable: false,
  },

  parametrics: siteParametrics,
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Site',
    description: 'The top-level container holding buildings, zones, and the property boundary.',
    icon: { kind: 'url', src: '/icons/site-flag.webp' },
    paletteSection: 'site',
    paletteOrder: 5,
  },

  mcp: {
    description: 'Top-level site container.',
  },
}
