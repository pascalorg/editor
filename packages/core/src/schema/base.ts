import { customAlphabet } from 'nanoid'
import { z } from 'zod'
import { CameraSchema } from './camera'

const customId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)

/**
 * Material preset name reference
 * @example 'white', 'brick', 'wood', 'glass', 'preview-valid'
 */
export const Material = z.string().optional()
export const generateId = <T extends string>(prefix: T): `${T}_${string}` =>
  `${prefix}_${customId()}` as `${T}_${string}`
export const objectId = <T extends string>(prefix: T) => {
  const schema = z.templateLiteral([`${prefix}_`, z.string()])

  return schema.default(() => generateId(prefix) as z.infer<typeof schema>)
}
export const nodeType = <T extends string>(type: T) => z.literal(type).default(type)

export const BaseNode = z.object({
  object: z.literal('node').default('node'),
  id: z.string(), // objectId('node'), @Aymericr: Thing is if we specify objectId here, when using BaseNode.extend, TS complains that the id is not assignable to the more specific type in the extended node
  type: nodeType('node'),
  name: z.string().optional(),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().optional().default(true),
  camera: CameraSchema.optional(),
  // Deliberately a record, not `z.json()`. The recursive JSON schema is the
  // most expensive member of every node that embeds it (`WallNode.parse` runs
  // ~1.5x faster without it) and, being self-referential, it also denies the
  // whole node tree zod 4.5's compiled parser: measured on `WallNode`,
  // `z.compile()` bought 1.0x with `z.json()` and 2.2x with this record.
  // Metadata is a flat bag of per-node extras, so an open object with
  // unchecked values is the whole contract we need.
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

export type BaseNode = z.infer<typeof BaseNode>
