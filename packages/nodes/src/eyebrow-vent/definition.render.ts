import { EyebrowVentNode as EyebrowVentNodeSchema, eyebrowVentSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { EyebrowVentNode } from './schema'

export const eyebrowVentRenderDefinition: NodeRenderDefinition<typeof EyebrowVentNode> & {
  kind: 'eyebrow-vent'
} = {
  kind: 'eyebrow-vent',
  schemaVersion: 3,
  schema: EyebrowVentNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = EyebrowVentNodeSchema.parse({
      id: 'eyebrow-vent_default' as never,
      type: 'eyebrow-vent',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    slots: eyebrowVentSlots,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the slope —
    // no `buildCut`, just the dirty cascade so the parent roof's merged shell
    // rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Eyebrow Vent',
    description: 'Low curved lens-shaped roof vent with a louvered front.',
    icon: { kind: 'url', src: '/icons/eyebrow-vent.webp' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },
  mcp: {
    description:
      'A low curved eyebrow vent on a roof segment — a lens-shaped hood with an optional louvered front. Parametric width (span) / depth / height.',
  },
}
