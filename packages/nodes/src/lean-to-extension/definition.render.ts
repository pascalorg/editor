import { leanToSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildLeanToExtensionGeometry, leanToExtensionGeometryKey } from './geometry'
import { LeanToExtensionNode } from './schema'

export const leanToExtensionRenderDefinition: NodeRenderDefinition<typeof LeanToExtensionNode> & {
  kind: 'lean-to-extension'
} = {
  kind: 'lean-to-extension',
  schemaVersion: 13,
  schema: LeanToExtensionNode,
  category: 'structure',
  defaults: () => {
    const parsed = LeanToExtensionNode.parse({})
    const { id: _id, type: _type, ...defaults } = parsed
    return defaults
  },
  capabilities: {
    exterior: true,
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    slots: () => leanToSlots(),
  },
  relations: {
    cascadeDelete: 'descendants',
    hosts: ['column', 'roof'],
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  geometry: buildLeanToExtensionGeometry,
  geometryKey: leanToExtensionGeometryKey,
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  presentation: {
    label: 'Canopy',
    description:
      'An attached mono-pitch or freestanding mono, gable, or butterfly canopy with managed structure and drainage.',
    icon: { kind: 'url', src: '/icons/lean-to-extension.webp' },
    paletteSection: 'structure',
    paletteGroup: 'roof-features',
    paletteOrder: 105,
  },
  mcp: {
    description:
      'An open canopy that can attach to a wall or upper slab edge, stand freestanding with a mono, gable, or butterfly roof, or wrap around a conical roof base. It composes standard roof segments, gutters, downspouts, editable column children, framing, and beams.',
  },
}
