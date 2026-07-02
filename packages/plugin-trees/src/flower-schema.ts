import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/** Flower silhouettes the plugin can place. The string persists in scene JSON. */
export const FlowerPreset = z.enum(['daisy', 'tulip', 'lavender'])
export type FlowerPreset = z.infer<typeof FlowerPreset>

/** A placed flower — a sibling instanced kind to the tree, sharing the same
 * instanced renderer + selection proxy via the generic `instanced` core. */
export const FlowerNode = BaseNode.extend({
  id: objectId('flower'),
  type: nodeType('trees:flower'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: FlowerPreset.default('daisy'),
  height: z.number().positive().default(0.5),
  seed: z.number().int().default(1),
  /** Petal colour (hex). Baked from the preset at placement; recolour per-flower
   * in the inspector (the flower analog of the tree's leaf tint). */
  petalColor: z.string().default('#fcfcf2'),
})

export type FlowerNode = z.infer<typeof FlowerNode>
