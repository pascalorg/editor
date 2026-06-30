import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/** Tree silhouettes the plugin can place, each backed by an ez-tree preset.
 * The string persists in scene JSON. */
export const TreePreset = z.enum(['oak', 'pine', 'aspen', 'ash', 'bush'])
export type TreePreset = z.infer<typeof TreePreset>

/**
 * Schema for a placed tree. Composed from the public `BaseNode` exactly the way
 * built-in node kinds are — `objectId`/`nodeType` come from `@pascal-app/core`,
 * so a plugin needs no private host internals to mint a persistable node.
 *
 * `type` is the namespaced kind `trees:tree` — the same string the registry,
 * the tool id, and the scene JSON all key on. `height`/`seed`/`preset` are the
 * only geometry-relevant fields, so the definition's `geometryKey` is built
 * from them.
 */
export const TreeNode = BaseNode.extend({
  id: objectId('tree'),
  type: nodeType('trees:tree'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: TreePreset.default('oak'),
  height: z.number().positive().default(7),
  seed: z.number().int().default(1),
  // Curated geometry params (folded into the instancing variant key):
  /** Leaf-count multiplier vs the preset (1 = preset default). */
  foliageDensity: z.number().min(0).max(1.5).default(1),
  /** Branch-radius multiplier (1 = preset default). */
  trunkThickness: z.number().min(0.3).max(2.5).default(1),
  /** Strip all leaves — a bare winter silhouette. */
  leafless: z.boolean().default(false),
})

export type TreeNode = z.infer<typeof TreeNode>
