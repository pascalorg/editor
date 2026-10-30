import { z } from 'zod'

/**
 * How a stair is actually built, apart from the body it is drawn with (`construction`):
 * 'wood-stringers' — sawn 2x stringers carrying wood treads (the house and deck standard);
 * 'concrete' — a solid poured flight on a footing (a porch stoop); 'steel-stringers' — steel
 * channel stringers with treads between them. A stair without one keeps its original body.
 */
export const StairStructureType = z.enum(['wood-stringers', 'concrete', 'steel-stringers'])
export type StairStructureType = z.infer<typeof StairStructureType>

/** Stringer stock: a 2x12 (the standard, DCA 6) or a 2x10 for a short flight. */
export const StairStringerStock = z.enum(['2x12', '2x10'])
export type StairStringerStock = z.infer<typeof StairStringerStock>

/**
 * 'cut' — sawtooth carriages notched for every tread and riser; 'housed' — solid outer
 * stringers with the treads and risers housed (dadoed) into their faces, cut carriages between.
 */
export const StairStringerType = z.enum(['cut', 'housed'])
export type StairStringerType = z.infer<typeof StairStringerType>

/**
 * Tread stock: two 2x6s (the deck standard), two 5/4x6 deck boards, one 2x12, or a 3/4 in
 * plywood subtread under a 3/4 in finish tread (carpet or hardwood inside the house).
 */
export const StairTreadStock = z.enum(['2x6-pair', '5/4x6-pair', '2x12', 'plywood-finish'])
export type StairTreadStock = z.infer<typeof StairTreadStock>

/** The maximum stringer spacings offered, in inches on centre. */
export const STAIR_STRINGER_SPACINGS_IN = [12, 16, 18, 24] as const

export const StairStructure = z.object({
  type: StairStructureType.default('wood-stringers'),
  stringerStock: StairStringerStock.default('2x12'),
  stringerType: StairStringerType.default('cut'),
  /** The most the stringers may stand apart on centre (m) — 16 in; drives the automatic count. */
  stringerSpacing: z.number().positive().default(0.4064),
  /** A stringer count chosen by hand; absent = as many as keep every bay within `stringerSpacing`. */
  stringerCount: z.number().int().min(2).max(12).optional(),
  /** Absent = two 2x6s on an exterior stair, one 2x12 inside the house. */
  treadStock: StairTreadStock.optional(),
  /** Riser boards; absent = closed once the stair rises more than 30 in (IRC R311.7.5.1). */
  closedRisers: z.boolean().optional(),
  /** Pressure-treated lumber; absent = treated on an exterior stair. */
  treated: z.boolean().optional(),
  /** Nosing projection (m); absent = 1 in on wood and steel treads, none on concrete. */
  nosing: z.number().nonnegative().optional(),
})
export type StairStructure = z.infer<typeof StairStructure>
