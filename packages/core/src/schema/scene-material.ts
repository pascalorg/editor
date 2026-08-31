import { z } from 'zod'
import { generateId } from './base'
import { MaterialSchema } from './material'

export type SceneMaterialId = `mat_${string}`
export const generateSceneMaterialId = (): SceneMaterialId => generateId('mat')

export const SceneMaterial = z.object({
  id: z.string(),
  name: z.string(),
  material: MaterialSchema,
})
export type SceneMaterial = z.infer<typeof SceneMaterial>
