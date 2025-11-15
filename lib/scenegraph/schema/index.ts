import { z } from 'zod'
import { BuildingNode } from './nodes/building'
import { RootNode } from './nodes/root'

export const SceneSchema = z.object({
  root: RootNode.default(RootNode.parse({})),
  metadata: z.json().default({}),
})

export type Scene = z.infer<typeof SceneSchema>

export const initScene = (): Scene =>
  SceneSchema.parse({
    root: RootNode.parse({
      buildings: [BuildingNode.parse({})],
    }),
  })

export function validateScene(scene: unknown) {
  const result = SceneSchema.safeParse(scene)
  if (!result.success) {
    throw new Error(`Invalid scene: ${result.error.message}`)
  }
  return result.data as Scene
}
