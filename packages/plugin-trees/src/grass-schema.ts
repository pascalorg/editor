import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/** Grass tufts the plugin can place. The string persists in scene JSON. */
export const GrassPreset = z.enum(['meadow', 'fescue', 'reed'])
export type GrassPreset = z.infer<typeof GrassPreset>

/** A placed grass tuft — a third instanced kind alongside trees & flowers,
 * sharing the same instanced renderer + selection proxy via `instanced`. */
export const GrassNode = BaseNode.extend({
  id: objectId('grass'),
  type: nodeType('trees:grass'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: GrassPreset.default('meadow'),
  height: z.number().positive().default(0.4),
  seed: z.number().int().default(1),
  /** Blade colour (hex). Baked from the preset at placement; recolour per-tuft
   * in the inspector. */
  bladeColor: z.string().default('#5a8f3c'),
})

export type GrassNode = z.infer<typeof GrassNode>
