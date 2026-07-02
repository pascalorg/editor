import type { HandleDescriptor, NodeDefinition } from '@pascal-app/core'
import { buildTreeFloorplan, treeTrunkRadius } from './floorplan'
import { treeParametrics } from './parametrics'
import { TreeNode } from './schema'

const ROTATE_RING_OFFSET = 0.35
/** Ring hugs the ground like the item gizmo — high enough to clear the grass,
 * low enough to read as a floor affordance. */
const ROTATE_RING_Y = 0.25

/** Whole-tree Y-rotation gizmo (same rig as shelf/item): a ring around the
 * trunk near the ground — not the canopy, which would put the handle meters
 * from the trunk on a large oak. */
function treeRotateHandle(): HandleDescriptor<TreeNode> {
  const ringRadius = (n: TreeNode) => treeTrunkRadius(n) + ROTATE_RING_OFFSET
  const ringY = () => ROTATE_RING_Y
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => {
      const r = initial.rotation ?? [0, 0, 0]
      // Negate to match three.js Y-rotation handedness (same as shelf).
      return { rotation: [r[0], (r[1] ?? 0) - delta, r[2]] as [number, number, number] }
    },
    placement: {
      position: (n) => {
        const r = ringRadius(n)
        return [r * Math.SQRT1_2, ringY(), r * Math.SQRT1_2]
      },
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: ringRadius,
      y: ringY,
    },
  }
}

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
    rotatable: {
      axes: ['y'],
      snapAngles: Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4),
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    snappable: {},
    // The auto-measured drag box would wrap the whole canopy (the proxy shows
    // the real geometry while selected) — declare trunk-sized bounds instead.
    dragBounds: (node) => {
      const tree = node as unknown as TreeNode
      const radius = treeTrunkRadius(tree)
      return { size: [radius * 2, tree.height ?? 7, radius * 2] }
    },
    floorPlaced: {
      // `footprint` receives the host's `AnyNode`; cast to our schema type the
      // same way built-in kinds do (`node as ShelfNode`). Trunk-sized, not
      // canopy-sized — the drag/placement box should hug where the tree
      // actually plants, not span the whole crown.
      footprint: (node) => {
        const tree = node as unknown as TreeNode
        const radius = treeTrunkRadius(tree)
        return {
          dimensions: [radius * 2, tree.height, radius * 2] as [number, number, number],
          rotation: tree.rotation,
        }
      },
      collides: false,
    },
  },

  parametrics: treeParametrics,
  // 2D plan symbol: dashed canopy ring + trunk dot (see floorplan.ts).
  floorplan: buildTreeFloorplan,
  handles: [treeRotateHandle()],

  // Instanced rendering: an invisible per-node proxy for selection/outline...
  renderer: { kind: 'parametric', module: () => import('./proxy-renderer') },
  // ...and a collective system that batches every tree into InstancedMeshes.
  system: { module: () => import('./system'), priority: 3 },
  // Baked `/viewer` re-render for `bake: 'replace'` — collective, instanced.
  bakeReplaceRenderer: { module: () => import('./static-renderer') },

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
