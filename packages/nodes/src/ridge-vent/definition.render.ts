import { RidgeVentNode as RidgeVentNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { RidgeVentNode } from './schema'

export const ridgeVentRenderDefinition: NodeRenderDefinition<typeof RidgeVentNode> & {
  kind: 'ridge-vent'
} = {
  kind: 'ridge-vent',
  schemaVersion: 1,
  schema: RidgeVentNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = RidgeVentNodeSchema.parse({
      id: 'rvent_default' as never,
      type: 'ridge-vent',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // ridge — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Ridge Vent',
    description: 'Ventilation strip running along the ridge of a roof segment.',
    icon: { kind: 'url', src: '/icons/ridge-vent.webp' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },
  mcp: {
    description:
      'A ridge vent — three styles (standard curved cap / shingled / metal), optional end caps, length / width / height parametric.',
  },
}
