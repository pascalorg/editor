import { customAlphabet } from 'nanoid'
import { z } from 'zod'

const customId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const generateId = <T extends string>(prefix: T): `${T}_${string}` =>
  `${prefix}_${customId()}` as `${T}_${string}`
export const nodeId = <T extends string>(prefix: T) => {
  const schema = z.templateLiteral([`${prefix}_`, z.string()])

  return schema.default(() => generateId(prefix) as z.infer<typeof schema>)
}
export const nodeType = <T extends string>(type: T) => z.literal(type).default(type)

export const BaseNode = z.object({
  object: z.literal('node').default('node'),
  id: nodeId('node'),
  type: nodeType('node'),
  name: z.string().optional(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(100).default(100),
  metadata: z.json().default({}),
  editor: z
    .object({
      canPlace: z.boolean().optional(),
      preview: z.boolean().optional(),
      locked: z.boolean().optional(),
    })
    .optional(),
})

export type BaseNode = z.infer<typeof BaseNode>
