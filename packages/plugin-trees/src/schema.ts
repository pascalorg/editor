import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/** Tree species the plugin can place, each backed by an ez-tree preset family.
 * The string persists in scene JSON. */
export const TreePreset = z.enum(['oak', 'pine', 'aspen', 'ash', 'bush', 'trellis'])
export type TreePreset = z.infer<typeof TreePreset>

/** Preset size variant. Maps to ez-tree's Small/Medium/Large presets (and
 * Bush 1/2/3); ignored for `trellis`, which has a single preset. */
export const TreeSize = z.enum(['small', 'medium', 'large'])
export type TreeSize = z.infer<typeof TreeSize>

/** ez-tree's two growth models — deciduous (spreading) vs evergreen (conical). */
export const TreeType = z.enum(['deciduous', 'evergreen'])
export type TreeType = z.infer<typeof TreeType>

/**
 * Schema for a placed tree. Composed from the public `BaseNode` exactly the way
 * built-in node kinds are — `objectId`/`nodeType` come from `@pascal-app/core`,
 * so a plugin needs no private host internals to mint a persistable node.
 *
 * `type` is the namespaced kind `trees:tree`. Every geometry-relevant field
 * (preset/size/treeType/seed/foliage/trunk/leafless/leafColor/branchColor) is
 * folded into the instancing variant key; `height`/`position`/`rotation` are
 * cheap per-instance transforms.
 */
export const TreeNode = BaseNode.extend({
  id: objectId('tree'),
  type: nodeType('trees:tree'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: TreePreset.default('oak'),
  size: TreeSize.default('medium'),
  treeType: TreeType.default('deciduous'),
  height: z.number().positive().default(7),
  seed: z.number().int().default(1),
  // Curated geometry params (folded into the instancing variant key):
  /** Leaf-count multiplier vs the preset (1 = preset default). */
  foliageDensity: z.number().min(0).max(1.5).default(1),
  /** Branch-radius multiplier (1 = preset default). */
  trunkThickness: z.number().min(0.3).max(2.5).default(1),
  /** Strip all leaves — a bare winter silhouette. */
  leafless: z.boolean().default(false),
  /** Leaf tint (hex). `#ffffff` = neutral — shows the ez-tree texture as-is. */
  leafColor: z.string().default('#ffffff'),
  /** Bark/branch tint (hex). `#ffffff` = neutral. */
  branchColor: z.string().default('#ffffff'),
})

export type TreeNode = z.infer<typeof TreeNode>
