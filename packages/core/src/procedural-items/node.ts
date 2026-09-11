import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../schema/base'
import { validateProceduralRelations } from './query'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

const recipe = z.custom<Recipe>().transform((value, ctx) => {
  try {
    return parseRecipe(value)
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid recipe',
    })
    return z.NEVER
  }
})
export const ProceduralItemNode = BaseNode.extend({
  id: objectId('procedural-item'),
  type: nodeType('procedural-item'),
  recipe,
  parameters: z.record(z.string(), z.number().finite()).default({}),
  slots: z
    .record(z.string(), z.string().regex(/^(#[0-9a-fA-F]{6}|(?:scene|library):[^\s]+)$/))
    .default({}),
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
  rotation: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
  wallId: z.string().optional(),
  side: z.enum(['front', 'back']).optional(),
  supportSlabId: z.string().optional(),
  children: z.array(z.string()).default([]),
  attachments: z.record(z.string(), z.string()).default({}),
})
  .superRefine((node, ctx) => {
    try {
      const result = evaluateRecipe(node.recipe, node.parameters)
      for (const slot of Object.keys(node.slots))
        if (!node.recipe.slots.some((s) => s.id === slot)) throw new Error(`Unknown slot ${slot}`)
      for (const [childId, surfaceId] of Object.entries(node.attachments)) {
        if (node.children.includes(childId) && !result.surfaces.some((s) => s.id === surfaceId))
          throw new Error('Remove the hosted item before removing its support surface')
      }
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid parameters',
      })
    }
  })
  .meta({ strictMutations: true, validateRelations: validateProceduralRelations })
export type ProceduralItemNode = z.infer<typeof ProceduralItemNode>
export function parameterPatch(node: ProceduralItemNode, id: string, value: number) {
  const parameters = { ...node.parameters, [id]: value }
  const parsed = ProceduralItemNode.safeParse({ ...node, parameters })
  return parsed.success ? { parameters } : null
}

export function snapParameters(recipe: Recipe, values: Record<string, number>) {
  const result = { ...values }
  for (const p of recipe.parameters) {
    const value = values[p.id]
    if (value === undefined) continue
    const snapped = p.min + Math.round((value - p.min) / p.step) * p.step
    result[p.id] = Number(Math.max(p.min, Math.min(p.max, snapped)).toFixed(10))
  }
  return result
}
