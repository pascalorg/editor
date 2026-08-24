import { z } from 'zod'

export const SurfaceHoleMetadata = z.object({
  /**
   * Who owns this hole, so the opening sync can replace only its own and leave
   * everything else — above all the user's manual cutouts — untouched.
   *
   * `verticalOpening` is the general case: any kind declaring the
   * `verticalOpening` capability, identified by `ownerId`. `stair` and
   * `elevator` predate it and are kept because they are written into saved
   * scenes; nothing new should use them.
   */
  source: z.enum(['manual', 'stair', 'elevator', 'verticalOpening']).default('manual'),
  stairId: z.string().optional(),
  elevatorId: z.string().optional(),
  /** The node that owns a `verticalOpening` hole. */
  ownerId: z.string().optional(),
})

export type SurfaceHoleMetadata = z.infer<typeof SurfaceHoleMetadata>

/**
 * Whether a hole was cut by the opening sync rather than drawn by the user.
 *
 * The three automatic sources are spelled out in one place so a caller cannot
 * preserve two of them and silently drop the third — which is what an
 * open-coded `source !== 'elevator'` did when `verticalOpening` was added.
 */
export function isAutoHoleSource(source: SurfaceHoleMetadata['source']): boolean {
  return source === 'stair' || source === 'elevator' || source === 'verticalOpening'
}
