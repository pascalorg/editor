import { z } from 'zod'
import { CollectionSchema } from './collections'
import { RootNode } from './root'
import { AnyNode, type NodeCreateSchemas, type NodeSchemas } from './types'
import { ViewSchema } from './views'
import { ZoneSchema } from './zones'

export * from '../common-types'
export * from './base'
export * from './collections'
export * from './environment'
// Export all specific node types
export * from './nodes/building'
export * from './nodes/ceiling'
export * from './nodes/column'
export * from './nodes/door'
export * from './nodes/group'
export * from './nodes/image'
export * from './nodes/item'
export * from './nodes/level'
export * from './nodes/roof'
export * from './nodes/scan'
export * from './nodes/site'
export * from './nodes/slab'
export * from './nodes/stair'
export * from './nodes/wall'
export * from './nodes/window'
export * from './root'
export * from './types'
export * from './views'
export * from './zones'

export const SceneSchema = z.object({
  root: RootNode.default(RootNode.parse({})),
  zones: z.array(ZoneSchema).default([]),
  collections: z.array(CollectionSchema).default([]),
  views: z.array(ViewSchema).default([]),
  metadata: z.json().default({}),
})

export type Scene = z.infer<typeof SceneSchema>

export function initScene(): Scene {
  return SceneSchema.parse({
    root: RootNode.parse({}),
    zones: [],
    collections: [],
    views: [],
    metadata: {},
  })
}

export function loadScene(scene: unknown) {
  const result = SceneSchema.safeParse(scene)
  if (!result.success) {
    throw new Error(`Failed to load scene: ${result.error.message}`)
  }
  return result.data as Scene
}

// Type mapping for extracting specific node types
export type NodeTypeMap = {
  [K in keyof typeof NodeSchemas]: z.infer<(typeof NodeSchemas)[K]>
}

export type NodeCreateTypeMap = {
  [K in keyof typeof NodeCreateSchemas]: z.infer<(typeof NodeCreateSchemas)[K]>
}

export const loadNode = (node: unknown): AnyNode => {
  const result = AnyNode.safeParse(node)
  if (!result.success) {
    throw new Error(`Failed to load node: ${result.error.message}`)
  }
  return result.data as AnyNode
}
