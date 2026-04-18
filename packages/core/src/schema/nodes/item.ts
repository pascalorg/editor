import dedent from 'dedent'
import { z } from 'zod'
import { AssetUrl } from '../asset-url'
import { BaseNode, nodeType, objectId } from '../base'
import type { CollectionId } from '../collections'

// --- Control descriptors ---

const toggleControlSchema = z.object({
  kind: z.literal('toggle'),
  label: z.string().optional(),
  default: z.boolean().optional(),
})

const sliderControlSchema = z.object({
  kind: z.literal('slider'),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().default(1),
  unit: z.string().optional(),
  displayMode: z.enum(['slider', 'stepper', 'dial']).default('slider'),
  default: z.number().optional(),
})

const temperatureControlSchema = z.object({
  kind: z.literal('temperature'),
  label: z.string().default('Temperature'),
  min: z.number().default(16),
  max: z.number().default(30),
  unit: z.enum(['C', 'F']).default('C'),
  default: z.number().optional(),
})

const controlSchema = z.discriminatedUnion('kind', [
  toggleControlSchema,
  sliderControlSchema,
  temperatureControlSchema,
])

// --- Effect descriptors ---

const animationEffectSchema = z.object({
  kind: z.literal('animation'),
  clips: z.object({
    on: z.string().optional(),
    off: z.string().optional(),
    loop: z.string().optional(),
  }),
})

const lightEffectSchema = z.object({
  kind: z.literal('light'),
  color: z.string().default('#ffffff'),
  intensityRange: z.tuple([z.number(), z.number()]),
  distance: z.number().optional(),
  offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
})

const effectSchema = z.discriminatedUnion('kind', [animationEffectSchema, lightEffectSchema])

// --- Interactive descriptor ---

const interactiveSchema = z.object({
  controls: z.array(controlSchema).default([]),
  effects: z.array(effectSchema).default([]),
})

export type ToggleControl = z.infer<typeof toggleControlSchema>
export type SliderControl = z.infer<typeof sliderControlSchema>
export type TemperatureControl = z.infer<typeof temperatureControlSchema>
export type Control = z.infer<typeof controlSchema>
export type AnimationEffect = z.infer<typeof animationEffectSchema>
export type LightEffect = z.infer<typeof lightEffectSchema>
export type Effect = z.infer<typeof effectSchema>
export type Interactive = z.infer<typeof interactiveSchema>

const assetSchema = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string(),
  thumbnail: z.string(),
  src: AssetUrl,
  dimensions: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]), // [w, h, d]
  attachTo: z.enum(['wall', 'wall-side', 'ceiling']).optional(),
  tags: z.array(z.string()).optional(),
  // These are "Corrective" transforms to normalize the GLB
  offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  surface: z
    .object({
      height: z.number(), // where things rest
    })
    .optional(), // undefined = can't place things on it
  interactive: interactiveSchema.optional(),
})

export type AssetInput = z.input<typeof assetSchema>
export type Asset = z.infer<typeof assetSchema>

export const ItemNode = BaseNode.extend({
  id: objectId('item'),
  type: nodeType('item'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  side: z.enum(['front', 'back']).optional(),
  children: z.array(objectId('item')).default([]),

  // Wall attachment properties (only used when asset.attachTo is "wall" or "wall-side")
  wallId: z.string().optional(),
  wallT: z.number().optional(), // 0-1 parametric position along wall

  // Denormalized references to collections this node belongs to
  collectionIds: z.array(z.custom<CollectionId>()).optional(),

  asset: assetSchema,
}).describe(dedent`Item node - used to represent a item in the building
  - position: position in level coordinate system (or parent coordinate system if attached)
  - rotation: rotation in level coordinate system (or parent coordinate system if attached)
  - asset: asset data
    - category: category of the item
    - dimensions: size in level coordinate system
    - src: url of the model
    - attachTo: where to attach the item (wall, wall-side, ceiling)
    - offset: corrective position offset for the model
    - rotation: corrective rotation for the model
    - scale: corrective scale for the model
    - tags: tags associated with the item
`)

export type ItemNode = z.infer<typeof ItemNode>

/**
 * Returns the effective world-space dimensions of an item after applying its scale.
 * Use this everywhere item.asset.dimensions is used for spatial calculations.
 */
export function getScaledDimensions(item: ItemNode): [number, number, number] {
  const [w, h, d] = item.asset.dimensions
  const [sx, sy, sz] = item.scale
  return [w * sx, h * sy, d * sz]
}
