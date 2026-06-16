import { z } from 'zod'

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const materialSchema = z
  .object({
    type: z.string().optional(),
    preset: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const primitiveShapeIntentSchema = z
  .object({
    kind: z.string(),
    name: z.string().optional(),
    semanticRole: z.string().optional(),
    semanticGroup: z.string().optional(),
    sourcePartKind: z.string().optional(),
    sourcePartId: z.string().optional(),
    position: vec3Schema.optional(),
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    material: materialSchema.optional(),
    materialPreset: z.string().optional(),
  })
  .passthrough()

const revisionEdgeSchema = z.enum(['top', 'bottom', 'front', 'back', 'left', 'right', 'center'])

export const createIntentSchema = z.object({
  action: z.literal('create'),
  scope: z.enum(['whole_object', 'component', 'unknown']).default('unknown'),
  family: z.string().optional(),
  component: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  arrangement: z.enum(['single', 'pair', 'array', 'unknown']).default('unknown'),
  constraints: z.record(z.string(), z.unknown()).default({}),
})

export const revisionTargetSchema = z.object({
  kind: z.enum(['latest', 'selected', 'artifact_id']).default('latest'),
  artifactId: z.string().optional(),
})

export const revisionSubjectSchema = z.object({
  family: z.string().optional(),
  component: z.string().optional(),
  semanticRole: z.string().optional(),
  semanticGroup: z.string().optional(),
  sourcePartKind: z.string().optional(),
  sourcePartId: z.string().optional(),
})

export const revisionOperationIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['set_count', 'remove_duplicate']),
    desiredCount: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('remove_subject'),
  }),
  z.object({
    kind: z.literal('add_shapes'),
    shapes: z.array(primitiveShapeIntentSchema).min(1),
  }),
  z.object({
    kind: z.literal('replace_subject'),
    shapes: z.array(primitiveShapeIntentSchema).min(1),
  }),
  z.object({
    kind: z.literal('transform_subject'),
    position: vec3Schema.optional(),
    delta: vec3Schema.optional(),
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
  }),
  z.object({
    kind: z.literal('resize_subject'),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    depth: z.number().positive().optional(),
    thickness: z.number().positive().optional(),
    radius: z.number().positive().optional(),
    radiusTop: z.number().positive().optional(),
    radiusBottom: z.number().positive().optional(),
    majorRadius: z.number().positive().optional(),
    tubeRadius: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('set_material'),
    color: z.string().optional(),
    material: materialSchema.optional(),
    materialPreset: z.string().optional(),
  }),
  z.object({
    kind: z.enum(['scale_subject', 'scale_semantic']),
    dimension: z.string().optional(),
    factor: z.number().positive(),
  }),
  z.object({
    kind: z.literal('material_from'),
    from: revisionSubjectSchema,
  }),
  z.object({
    kind: z.literal('align_subject'),
    to: revisionSubjectSchema,
    edge: revisionEdgeSchema,
    toEdge: revisionEdgeSchema.optional(),
    offset: z.number().optional(),
  }),
])

export const revisionIntentSchema = z.object({
  action: z.literal('revise'),
  target: revisionTargetSchema.default({ kind: 'latest' }),
  subject: revisionSubjectSchema.optional(),
  operation: revisionOperationIntentSchema,
})

export const geometryIntentSchema = z.discriminatedUnion('action', [
  createIntentSchema,
  revisionIntentSchema,
])

export type CreateIntent = z.infer<typeof createIntentSchema>
export type RevisionIntent = z.infer<typeof revisionIntentSchema>
export type RevisionSubject = z.infer<typeof revisionSubjectSchema>
export type RevisionOperationIntent = z.infer<typeof revisionOperationIntentSchema>
export type GeometryIntent = z.infer<typeof geometryIntentSchema>

export function parseGeometryIntent(value: unknown): GeometryIntent | undefined {
  const parsed = geometryIntentSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
