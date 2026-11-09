// zod/mini: the same schemas as `zod` at a fraction of the bundle size.
import { z } from 'zod/mini'

/**
 * Pascal's public scene read contract, version 1: the body of
 * `GET {baseUrl}/api/projects/{id}/scene`.
 *
 * Fields a viewer needs are typed; everything else is kept loosely so a server
 * adding fields never breaks an existing viewer. A new `contractVersion` is the
 * signal for a breaking change.
 */

/** A scene graph node. Only the fields every node shares are typed; kind-specific
 *  fields (a zone's `polygon`, a level's `level`) are read through `graph.ts`. */
export const SceneNodeSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  name: z.optional(z.string()),
  parentId: z.optional(z.nullable(z.string())),
  children: z.optional(z.array(z.unknown())),
})
export type SceneNode = z.infer<typeof SceneNodeSchema>

export const SceneGraphSchema = z.looseObject({
  nodes: z.record(z.string(), SceneNodeSchema),
  rootNodeIds: z.array(z.string()),
  materials: z.optional(z.unknown()),
  installedPlugins: z.optional(z.unknown()),
})
export type SceneGraph = z.infer<typeof SceneGraphSchema>

const isoDate = z
  .string()
  .check(z.refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a date'))

/** One level of detail of the baked 3D file (GLB). `level` 0 is the most detailed. */
export const LodSchema = z.object({
  level: z.int().check(z.gte(0)),
  /** Short-lived signed URL. Fetch it before `expiresAt`, or read the scene again for a new one. */
  url: z.url(),
  bytes: z.nullable(z.number()),
  triangles: z.nullable(z.number()),
  expiresAt: isoDate,
})
export type Lod = z.infer<typeof LodSchema>

export const BakeStatusSchema = z.enum(['ready', 'baking', 'failed', 'none'])
export type BakeStatus = z.infer<typeof BakeStatusSchema>

export const BakeSchema = z.object({
  status: BakeStatusSchema,
  bakeVersion: z.nullable(z.number()),
  hash: z.nullable(z.string()),
  lods: z.array(LodSchema),
})
export type Bake = z.infer<typeof BakeSchema>

export const SceneResponseSchema = z.object({
  contractVersion: z.literal(1),
  project: z.object({
    id: z.string(),
    name: z.nullable(z.string()),
    owner: z.nullable(z.object({ displayName: z.string(), avatarUrl: z.nullable(z.string()) })),
    coverUrl: z.nullable(z.string()),
  }),
  revision: z.object({
    /** `'published'` in contract v1. */
    kind: z.string(),
    version: z.number(),
    modelId: z.string(),
    disclosurePolicyVersion: z.number(),
  }),
  graph: SceneGraphSchema,
  libraryMaterials: z.array(z.unknown()),
  bake: BakeSchema,
})
export type SceneResponse = z.infer<typeof SceneResponseSchema>

/** Error bodies are `{ error: code }`. */
export const ErrorBodySchema = z.object({ error: z.string() })
