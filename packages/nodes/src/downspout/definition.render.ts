import { DownspoutNode as DownspoutNodeSchema, downspoutSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { DownspoutNode } from './schema'

export const downspoutRenderDefinition: NodeRenderDefinition<typeof DownspoutNode> & {
  kind: 'downspout'
} = {
  kind: 'downspout',
  schemaVersion: 3,
  schema: DownspoutNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = DownspoutNodeSchema.parse({
      id: 'downspout_default' as never,
      type: 'downspout',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    slots: downspoutSlots,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Logically a roof accessory — registers under the segment, has
    // no buildCut, just the standard dirty cascade.
    roofAccessory: {},
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 2,
  },
  presentation: {
    label: 'Downspout',
    description: 'Vertical drop pipe from a gutter outlet to the ground.',
    icon: { kind: 'url', src: '/icons/downspout.webp' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },
  mcp: {
    description:
      'A downspout — drop pipe from a gutter outlet that elbows back to the wall, runs down the wall face, and kicks out at the bottom. length / diameter / standoff parametric.',
  },
}
