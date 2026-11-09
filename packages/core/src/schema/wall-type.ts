import { z } from 'zod'
import { Assembly } from './assembly'
import { generateId } from './base'

/** Every project wall type's id starts with this, so a pick can never collide with a preset id. */
export const CUSTOM_WALL_TYPE_PREFIX = 'custom-'

export const WallTypeDefinitionId = z.string().regex(/^custom-[A-Za-z0-9_-]{1,40}$/)

/** A fresh project wall type id: `custom-` and 16 random characters. */
export function newWallTypeId(): string {
  return generateId('custom').replace('_', '-')
}

/**
 * A wall type of the project's own: a name and the
 * layers it builds from the exterior face inward around one framing core (an `Assembly` with
 * `face: 'exterior'`). Saved on the site (`SiteNode.wallTypes`), so it travels with the project
 * when it is reloaded or shared. A wall drawn with one copies its stack (`wallAssemblyPatch`): the
 * definition is the library entry, not a live link, so editing it changes the walls drawn next.
 */
export const WallTypeDefinition = z
  .object({
    id: WallTypeDefinitionId,
    label: z.string().trim().min(1).max(60),
    assembly: Assembly,
  })
  .superRefine((type, ctx) => {
    if (!type.assembly.layers.some((layer) => layer.core)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A wall type is built around one core layer',
        path: ['assembly', 'layers'],
      })
    }
  })
export type WallTypeDefinition = z.infer<typeof WallTypeDefinition>
