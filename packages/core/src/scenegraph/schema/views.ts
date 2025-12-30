import dedent from 'dedent'
import { z } from 'zod'
import { objectId } from './base'
import { CameraSchema } from './camera'

export const SceneStateOverrideSchema = z.object({
  selectedLevelId: z.string().nullable().optional(),
  levelMode: z.enum(['stacked', 'exploded', 'single-floor']).optional(),
  visibleZoneIds: z.array(z.string()).optional(),
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
  - sceneState: optional overrides for scene state (level, zones, time)
  `,
  )

export type View = z.infer<typeof ViewSchema>
export type { Camera } from './camera'
export type SceneStateOverride = z.infer<typeof SceneStateOverrideSchema>
