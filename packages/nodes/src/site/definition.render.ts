import { SiteNode as SiteNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { polygonMeasurementFeatures } from '../shared/polygon-measurement'
import { SiteNode } from './schema'

export const siteRenderDefinition: NodeRenderDefinition<typeof SiteNode> & { kind: 'site' } = {
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
    exterior: true,
    // Site is the root container — sidebar / property-line tool drive
    // selection, never 3D click (event bubbling from descendants would
    // override their selection). Same reasoning as `level`.
    duplicable: false,
    deletable: false,
    presettable: false,
  },
  measurement: {
    features: (node) =>
      polygonMeasurementFeatures({
        featurePrefix: 'site',
        height: 0,
        label: 'Property',
        polygon: node.polygon.points,
      }),
  },
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
