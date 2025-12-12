import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'

const Vector3Schema = z.tuple([z.number(), z.number(), z.number()])

export const CameraSchema = z.object({
  position: Vector3Schema,
  target: Vector3Schema,
  mode: z.enum(['perspective', 'orthographic']).default('perspective'),
  fov: z.number().optional(), // For perspective
  zoom: z.number().optional(), // For orthographic
})

export const SceneStateOverrideSchema = z.object({
  selectedLevelId: z.string().nullable().optional(),
  levelMode: z.enum(['stacked', 'exploded', 'single-floor']).optional(),
  visibleCollectionIds: z.array(z.string()).optional(),
  timePreset: z.enum(['dawn', 'day', 'dusk', 'night', 'now', 'custom']).optional(),
  staticTime: z.number().optional(),
})

export const ViewSchema = z
  .object({
    id: objectId('view'),
    object: z.literal('view').default('view'),
    name: z.string(),
    description: z.string().optional(),
    camera: CameraSchema,
    sceneState: SceneStateOverrideSchema.optional(),
    thumbnail: z.string().optional(), // Data URL or path
    metadata: z.json().optional().default({}),
  })
  .describe(
    dedent`
  View schema - used to represent a saved camera view and scene state
  - object: "view"
  - name: view name
  - camera: camera configuration (position, target, mode)
  - sceneState: optional overrides for scene state (level, collections, time)
  `,
  )

export type View = z.infer<typeof ViewSchema>
export type Camera = z.infer<typeof CameraSchema>
export type SceneStateOverride = z.infer<typeof SceneStateOverrideSchema>
