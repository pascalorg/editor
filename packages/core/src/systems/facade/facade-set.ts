import { z } from 'zod'
import { FacadeUnitSchema } from './facade-unit'

/**
 * Where a unit goes in a building by default. `first` is the lowest storey,
 * `top` the highest, `middle` every storey between (and those two when the set
 * has no unit for them). A `free` unit has no storey of its own: it covers the
 * walls it is given, such as a recessed balcony stack.
 */
export const FacadeRoleSchema = z.enum(['first', 'middle', 'top', 'free'])
export type FacadeRole = z.infer<typeof FacadeRoleSchema>

/** A paint reference, as on any node slot: `library:<id>` or `scene:<id>`. */
const MaterialRef = z.string().regex(/^(library|scene):.+/)

/**
 * A corner chain (*chaîne d'angle*): the dressed vertical edge where two faces
 * meet, over every storey. Courses are phased on absolute height, so the chain
 * runs through storey lines without a seam, and a harpée's long and short
 * blocks alternate between its two faces. Built from panels on both faces.
 */
export const FacadeCornerSchema = z.object({
  /** harpée: alternating long and short blocks; droite: a straight band; bossage: rusticated blocks; brick: brick quoins; pilaster: a shaft and a capital. */
  kind: z.enum(['harpee', 'droite', 'bossage', 'brick', 'pilaster']).default('harpee'),
  material: MaterialRef,
  /** Course height (*hauteur d'assise*). */
  course: z.number().finite().min(0.15).max(0.6).default(0.3),
  /** Leg of the long block on a face, and of the short one; the chain reserves the long one. */
  long: z.number().finite().min(0.1).max(1.2).default(0.4),
  short: z.number().finite().min(0.05).max(1).default(0.25),
  /** How far the blocks stand proud of the face. */
  relief: z.number().finite().min(0).max(0.08).default(0.02),
  /** Joints between courses; V joints are drawn square, panels having no chamfer. */
  joint: z.enum(['none', 'v', 'square']).default('none'),
  /** Outside corners by default; inside corners opt in. */
  edges: z
    .array(z.enum(['outside', 'inside']))
    .min(1)
    .default(['outside']),
  /** From the ground or from the top of the base band; up to the top or to the cornice. */
  from: z.enum(['ground', 'base']).default('ground'),
  to: z.enum(['top', 'cornice']).default('top'),
})
export type FacadeCorner = z.infer<typeof FacadeCornerSchema>

/**
 * A horizontal band around the building: the base band (*soubassement*) at the
 * foot of the lowest storey, string courses (*bandeaux*) at storey lines, the
 * cornice at the top. Built from panels on every face of the outside loop.
 */
export const FacadeBandSchema = z.object({
  kind: z.enum(['base', 'course', 'cornice']),
  /** Where a string course runs: above the first storey, below the top one, or at every storey line. */
  at: z.enum(['above-first', 'below-top', 'every']).default('above-first'),
  material: MaterialRef,
  height: z.number().finite().min(0.05).max(3).default(0.3),
  /** How far it stands proud of the face. */
  depth: z.number().finite().min(0.005).max(1).default(0.05),
})
export type FacadeBand = z.infer<typeof FacadeBandSchema>

export const FacadeSetUnitSchema = z.object({
  /** Stable identity inside the set; areas and wall snapshots point at it. */
  key: z.string().min(1),
  role: FacadeRoleSchema.default('middle'),
  unit: FacadeUnitSchema,
})
export type FacadeSetUnit = z.infer<typeof FacadeSetUnitSchema>

/**
 * A building's facade identity: a few units, each with a role. It is plain
 * data with no scene ids, so it survives a catalog round trip and re-solves on
 * any building; where each unit lands in one project is the facade node's areas.
 */
export const FacadeSetSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1),
    /** The style generator and seed it was drawn from, when it was. */
    style: z.object({ id: z.string().min(1), seed: z.number().int() }).optional(),
    /** Words the catalog finds it by, beyond what the set itself says. */
    tags: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
    units: z.array(FacadeSetUnitSchema).default([]),
    /** At most one chain, applied at every corner of the kinds it names. */
    corners: z.array(FacadeCornerSchema).max(1).optional(),
    bands: z.array(FacadeBandSchema).max(8).optional(),
  })
  .refine((set) => new Set(set.units.map((u) => u.key)).size === set.units.length, {
    message: 'Each unit in a set needs its own key.',
  })
  .refine(
    (set) =>
      (['first', 'middle', 'top'] as const).every(
        (role) => set.units.filter((u) => u.role === role).length <= 1,
      ),
    { message: 'A set holds one unit per storey role; give the others the free role.' },
  )
export type FacadeSet = z.infer<typeof FacadeSetSchema>
