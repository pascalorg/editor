import type { NodeDefinition } from '@pascal-app/core'
import { treeParametrics } from './parametrics'
import { TreeNode } from './schema'

/**
 * The tree node definition. Rendering uses the instanced path rather than the
 * per-node `def.geometry`: a collective `def.system` batches every tree into
 * `InstancedMesh`es (forest-scale draw calls), while a featherweight
 * `def.renderer` mounts an invisible per-node proxy so the host's selection /
 * outline / zone machinery works unchanged. `parametrics` gives the inspector
 * for free; `tool`/`preview` drive placement. No host dispatch code per kind.
 */
export const treeDefinition: NodeDefinition<typeof TreeNode> = {
  kind: 'trees:tree',
  // Static in the bake for portability; our viewer removes the baked meshes and
  // re-renders live (wind, LODs) via this def's own path. See plans → Part D.
  bake: 'replace',
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
    size: 'medium',
    treeType: 'deciduous',
    height: 7,
    seed: 1,
    foliageDensity: 1,
    trunkThickness: 1,
    leafless: false,
    leafColor: '#ffffff',
    branchColor: '#ffffff',
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

  // Instanced rendering: an invisible per-node proxy for selection/outline...
  renderer: { kind: 'parametric', module: () => import('./proxy-renderer') },
  // ...and a collective system that batches every tree into InstancedMeshes.
  system: { module: () => import('./system'), priority: 3 },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Plant tree' },
    { key: 'Esc', label: 'Stop' },
  ],

  presentation: {
    label: 'Tree',
    description: 'A procedural ez-tree. Oak, pine, aspen, ash, bush, or trellis.',
    icon: { kind: 'iconify', name: 'lucide:trees' },
    paletteSection: 'furnish',
    hidden: true,
  },

  mcp: {
    description:
      'A procedural ez-tree (example plugin node). Species presets (oak/pine/aspen/ash/bush/trellis) × size, deciduous/evergreen type, adjustable height, foliage/trunk, leaf & branch tint, and a seed for variation.',
  },
}
