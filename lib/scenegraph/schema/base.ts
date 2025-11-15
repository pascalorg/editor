import { customAlphabet } from 'nanoid'
import { z } from 'zod'

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const generateId = <T extends string>(prefix: T): `${T}_${string}` =>
  `${prefix}_${nanoid()}` as `${T}_${string}`
export const id = (prefix: string) =>
  z.templateLiteral([`${prefix}_`, z.string()]).default(() => generateId(prefix))
export const nodeType = <T extends string>(type: T) => z.literal(type).default(type)

export const BaseNode = z.object({
  id: id('base'),
  type: z.string(),
  name: z.string().optional(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(100).default(100),
  metadata: z.json().default({}),
})

export type BaseNode = z.infer<typeof BaseNode>
