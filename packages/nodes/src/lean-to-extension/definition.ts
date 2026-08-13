import type { NodeDefinition } from '@pascal-app/core'
import type { FloorplanNodeExtension } from '@pascal-app/editor'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { buildLeanToExtensionGeometry, leanToExtensionGeometryKey } from './geometry'
import { leanToExtensionParametrics } from './parametrics'
import { LeanToExtensionNode } from './schema'

export const leanToExtensionDefinition: NodeDefinition<typeof LeanToExtensionNode> = {
  kind: 'lean-to-extension',
  schemaVersion: 1,
  schema: LeanToExtensionNode,
  category: 'structure',
  snapProfile: 'structural',
  extensions: {
    'pascal:editor/floorplan': {
      tool: () => import('./floorplan-tool'),
    } satisfies FloorplanNodeExtension<LeanToExtensionNode>,
  },
  defaults: () => {
    const parsed = LeanToExtensionNode.parse({})
    const { id: _id, type: _type, ...defaults } = parsed
    return defaults
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },
  relations: {
    cascadeDelete: 'descendants',
    hosts: ['column', 'roof'],
  },
  parametrics: leanToExtensionParametrics,
  geometry: buildLeanToExtensionGeometry,
  geometryKey: leanToExtensionGeometryKey,
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  floorplan: buildLeanToExtensionFloorplan,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Attach lean-to extension to wall' },
    { key: 'Esc', label: 'Cancel' },
  ],
  presentation: {
    label: 'Lean-to Extension',
    description: 'An open mono-pitch roof attached to a wall and supported by a pillar row.',
    icon: { kind: 'url', src: '/icons/lean-to-extension.webp' },
    paletteSection: 'structure',
    paletteOrder: 105,
  },
  mcp: {
    description:
      'A wall-hosted open lean-to canopy composed from a standard shed roof segment, standard gutter and downspout accessories, editable column children, ledger, rafters, front beam, and flashing.',
  },
}
