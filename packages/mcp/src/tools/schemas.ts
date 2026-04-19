import { z } from 'zod'

/**
 * Shared Zod schemas used by multiple MCP tools. Keep DRY — if a shape is
 * referenced by more than one tool, define it here.
 */

/** A node identifier — non-empty string. The core uses `${prefix}_${nanoid}`. */
export const NodeIdSchema = z.string().min(1)

/** 2D point as [x, z] (floor plane). Matches core's tuple convention. */
export const Vec2Schema = z.tuple([z.number(), z.number()])

/** 3D point as [x, y, z]. */
export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

/**
 * A single patch operation. Union of create / update / delete.
 *
 * For `create`, the node object must include `type` so Zod can discriminate at
 * the bridge layer — we accept a plain object here and let the bridge's Zod
 * re-parse catch structural issues. For `update`, `data` is a partial merge.
 */
export const CreatePatchSchema = z.object({
  op: z.literal('create'),
  node: z.record(z.string(), z.unknown()),
  parentId: NodeIdSchema.optional(),
})

export const UpdatePatchSchema = z.object({
  op: z.literal('update'),
  id: NodeIdSchema,
  data: z.record(z.string(), z.unknown()),
})

export const DeletePatchSchema = z.object({
  op: z.literal('delete'),
  id: NodeIdSchema,
  cascade: z.boolean().optional(),
})

export const PatchSchema = z.discriminatedUnion('op', [
  CreatePatchSchema,
  UpdatePatchSchema,
  DeletePatchSchema,
])

export type Patch = z.infer<typeof PatchSchema>
