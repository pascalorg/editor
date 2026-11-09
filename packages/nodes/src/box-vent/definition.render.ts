import { BoxVentNode as BoxVentNodeSchema, boxVentSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { BoxVentNode } from './schema'

export const boxVentRenderDefinition: NodeRenderDefinition<typeof BoxVentNode> & {
  kind: 'box-vent'
} = {
  kind: 'box-vent',
  schemaVersion: 3,
  schema: BoxVentNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = BoxVentNodeSchema.parse({ id: 'bvent_default' as never, type: 'box-vent' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    slots: boxVentSlots,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // slope — no `buildCut`, just the dirty cascade so the parent
    // roof's merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Box Vent',
    description: 'Small louvered exhaust vent that sits on a roof slope.',
    icon: { kind: 'url', src: '/icons/box-vent.webp' },
    paletteSection: 'structure',
    paletteOrder: 120,
  },
  mcp: {
    description:
      'A louvered box vent sitting on a roof segment. Style: standard / low-profile / dome. Width/depth/height/hoodOverhang parametric.',
  },
}
