import type { NodeDefinition } from '@pascal-app/core'
import { buildTreeGeometry } from './geometry'
import { treeParametrics } from './parametrics'
import { TreeNode } from './schema'

/**
 * The tree node definition. Three-checkbox composition like the built-ins:
 * `geometry` for 3D, `parametrics` for the inspector, `tool`/`preview` for
 * placement — all pure/lazy, no host dispatch code. The host renders, inspects,
 * moves, and persists trees purely from this descriptor.
 */
export const treeDefinition: NodeDefinition<typeof TreeNode> = {
  kind: 'trees:tree',
  schemaVersion: 1,
  schema: TreeNode,
  category: 'furnish',
  snapProfile: 'item',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    preset: 'oak',
    height: 5,
    seed: 1,
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    snappable: {},
    floorPlaced: {
      // `footprint` receives the host's `AnyNode`; cast to our schema type the
      // same way built-in kinds do (`node as ShelfNode`).
      footprint: (node) => {
        const tree = node as unknown as TreeNode
        const radius = Math.max(0.5, tree.height * 0.28)
        return {
          dimensions: [radius * 2, tree.height, radius * 2] as [number, number, number],
          rotation: tree.rotation,
        }
      },
      collides: false,
    },
  },

  parametrics: treeParametrics,

  // Pure builder + a cache key over only the geometry-relevant fields, so a
  // move or reparent never rebuilds the mesh.
  geometry: (node) => buildTreeGeometry(node),
  geometryKey: (n) => JSON.stringify([n.preset, n.height, n.seed]),

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Plant tree' },
    { key: 'Esc', label: 'Stop' },
  ],

  presentation: {
    label: 'Tree',
    description: 'A procedural low-poly tree. Oak, pine, birch, or palm.',
    icon: { kind: 'iconify', name: 'lucide:trees' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A procedural tree (example plugin node). Four presets — oak, pine, birch, palm — with adjustable height and a seed for canopy variation.',
  },
}
